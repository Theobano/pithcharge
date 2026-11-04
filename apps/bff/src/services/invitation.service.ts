import { db, Prisma } from '@pithcharge/db';
import { isEmailConfigured, renderEmail, sendEmail } from '@pithcharge/notifications';
import { recordAuditEvent } from './financial.service';

export const INVITATION_TTL_MS = 7 * 86_400_000;
export type InvitationRole = 'admin' | 'user' | 'auditor';

export class InvitationError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new InvitationError(404, 'INVITATION_NOT_FOUND', 'Invitation not found.');

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function buildInviteLink(invitationId: string) {
  const base = (process.env.WEB_APP_URL || 'http://localhost:3100').replace(/\/+$/, '');
  return `${base}/invite/${invitationId}`;
}

/** Best-effort email through the configured email relay; the link is always returned to the inviter as well. */
async function sendInvitationEmail(input: {
  email: string;
  organizationName: string;
  inviterName: string;
  role: string;
  link: string;
}) {
  if (!isEmailConfigured()) return false;
  try {
    const subject = `${input.inviterName} invited you to ${input.organizationName}`;
    const { html, text } = renderEmail({
      heading: subject,
      body: `You have been invited to join ${input.organizationName} as ${input.role}. The invitation expires in 7 days.`,
      action: { label: 'Accept invitation', url: input.link },
    });
    await sendEmail({ to: input.email, subject, text, html });
    return true;
  } catch {
    return false;
  }
}
export function invitationState(invitation: { status: string; expiresAt: Date }) {
  if (invitation.status === 'pending' && invitation.expiresAt.getTime() <= Date.now()) return 'expired';
  return invitation.status;
}

export async function createInvitation(input: {
  organizationId: string;
  inviter: { id: string; name: string };
  email: string;
  role: InvitationRole;
}) {
  const email = normalizeEmail(input.email);

  const existingUser = await db.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, isAnonymous: { not: true } },
    select: { id: true },
  });
  if (
    existingUser &&
    (await db.member.findFirst({
      where: { organizationId: input.organizationId, userId: existingUser.id },
      select: { id: true },
    }))
  ) {
    throw new InvitationError(409, 'ALREADY_MEMBER', 'This user is already a member.');
  }

  const now = new Date();
  const pending = await db.invitation.findFirst({
    where: {
      organizationId: input.organizationId,
      email: { equals: email, mode: 'insensitive' },
      status: 'pending',
      expiresAt: { gt: now },
    },
    select: { id: true },
  });
  if (pending) {
    throw new InvitationError(409, 'INVITATION_PENDING', 'A pending invitation already exists for this email.');
  }

  const organization = await db.organization.findUniqueOrThrow({
    where: { id: input.organizationId },
    select: { name: true },
  });
  const invitation = await db.invitation.create({
    data: {
      organizationId: input.organizationId,
      email,
      role: input.role,
      status: 'pending',
      inviterId: input.inviter.id,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
    },
    select: { id: true, email: true, role: true, status: true, expiresAt: true, createdAt: true },
  });

  const link = buildInviteLink(invitation.id);
  const emailed = await sendInvitationEmail({
    email,
    organizationName: organization.name,
    inviterName: input.inviter.name,
    role: input.role,
    link,
  });
  await recordAuditEvent({
    actorId: input.inviter.id,
    organizationId: input.organizationId,
    action: 'organization.invitation.created',
    targetType: 'Invitation',
    targetId: invitation.id,
    metadata: { email, role: input.role, emailed },
  });
  return { invitation, link, emailed };
}

export async function getInvitationPreview(id: string) {
  if (!UUID.test(id)) throw notFound();
  const invitation = await db.invitation.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      organization: { select: { id: true, name: true, logo: true } },
      user: { select: { name: true } },
    },
  });
  if (!invitation) throw notFound();
  const accountExists = Boolean(
    await db.user.findFirst({
      where: { email: { equals: invitation.email, mode: 'insensitive' }, isAnonymous: { not: true } },
      select: { id: true },
    }),
  );
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role === 'member' ? 'user' : invitation.role,
    status: invitationState(invitation),
    expiresAt: invitation.expiresAt,
    organization: invitation.organization,
    invitedBy: invitation.user?.name ?? null,
    accountExists,
  };
}

export async function acceptInvitation(id: string, user: { id: string; email: string }) {
  if (!UUID.test(id)) throw notFound();
  const invitation = await db.invitation.findUnique({ where: { id } });
  if (!invitation) throw notFound();
  const state = invitationState(invitation);
  if (state === 'expired') throw new InvitationError(410, 'INVITATION_EXPIRED', 'This invitation has expired.');
  if (state !== 'pending') {
    throw new InvitationError(409, 'INVITATION_NOT_PENDING', `This invitation was ${state}.`);
  }
  if (normalizeEmail(invitation.email) !== normalizeEmail(user.email)) {
    throw new InvitationError(
      403,
      'INVITATION_EMAIL_MISMATCH',
      `This invitation was sent to ${invitation.email}. Sign in with that email to accept it.`,
    );
  }

  const role = invitation.role && invitation.role !== 'owner' ? invitation.role : 'user';
  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const claimed = await tx.invitation.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'accepted' },
    });
    if (claimed.count !== 1) {
      throw new InvitationError(409, 'INVITATION_NOT_PENDING', 'This invitation was already used.');
    }
    const existing = await tx.member.findFirst({
      where: { organizationId: invitation.organizationId, userId: user.id },
      select: { id: true },
    });
    if (!existing) {
      await tx.member.create({
        data: { organizationId: invitation.organizationId, userId: user.id, role, createdAt: new Date() },
      });
    }
    await tx.user.update({
      where: { id: user.id },
      data: { lastActiveOrganizationId: invitation.organizationId },
    });
  });

  await recordAuditEvent({
    actorId: user.id,
    organizationId: invitation.organizationId,
    action: 'organization.invitation.accepted',
    targetType: 'Invitation',
    targetId: id,
    metadata: { role },
  });
  return { organizationId: invitation.organizationId, role };
}
