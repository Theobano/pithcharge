"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import {
  useOrganization,
  useOrganizationAudit,
  useOrganizationInvitations,
  useOrganizationMembers,
  useOrganizationMutation,
  useOrganizationSessions,
} from "@/api/organizationApi";
import type { Row } from "@/api/adminApi";
import {
  DataTable,
  Field,
  Modal,
  NativeSelect,
  Pager,
  StatCard,
  formatDate,
  runWithToast,
} from "@/components/admin/admin-ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { toast } from "@/components/ui/toast";

type Confirm =
  | { kind: "remove"; member: Row }
  | { kind: "transfer"; member: Row }
  | { kind: "leave" }
  | { kind: "cancelInvite"; invitation: Row }
  | null;

export default function OrganizationAccess() {
  const { data: activeOrganization } = authClient.useActiveOrganization();
  const organizationId = activeOrganization?.id;
  const details = useOrganization(organizationId);
  const [auditPage, setAuditPage] = useState(1);
  const [sessionPage, setSessionPage] = useState(1);

  const info = details.data?.data;
  const canManage = Boolean(info?.canManage);
  const isOwner = Boolean(info?.isOwner);
  const canViewAll = canManage || info?.myRole === "auditor";
  const members = useOrganizationMembers(
    canViewAll ? organizationId : undefined,
  );
  const sessions = useOrganizationSessions(
    canViewAll ? organizationId : undefined,
    sessionPage,
  );
  const audit = useOrganizationAudit(
    canViewAll ? organizationId : undefined,
    auditPage,
  );

  const patch = useOrganizationMutation(organizationId, "PATCH");
  const post = useOrganizationMutation(organizationId, "POST");
  const del = useOrganizationMutation(organizationId, "DELETE");

  const [form, setForm] = useState({ name: "", slug: "", logo: "" });
  useEffect(() => {
    if (info)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({
        name: info.organization.name,
        slug: info.organization.slug,
        logo: info.organization.logo ?? "",
      });
  }, [info]);

  const [adding, setAdding] = useState(false);
  const [inviteResult, setInviteResult] = useState<{
    link: string;
    emailed: boolean;
  } | null>(null);
  const [invitePage, setInvitePage] = useState(1);
  const invitations = useOrganizationInvitations(
    canViewAll ? organizationId : undefined,
    invitePage,
  );
  const [add, setAdd] = useState({ email: "", role: "user" });
  const [confirm, setConfirm] = useState<Confirm>(null);

  if (!organizationId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
          <CardDescription>
            Select an organization from the switcher to manage it.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (details.isLoading)
    return (
      <p className="text-sm text-muted-foreground">Loading organization…</p>
    );
  if (details.error || !info) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {(details.error as Error | null)?.message ??
          "Unable to load organization."}
      </p>
    );
  }

  const restricted = Boolean(info.restricted);

  const dirty =
    form.name !== info.organization.name ||
    form.slug !== info.organization.slug ||
    form.logo !== (info.organization.logo ?? "");

  const saveDetails = () =>
    runWithToast(
      () =>
        patch.mutateAsync({
          body: {
            name: form.name.trim(),
            slug: form.slug.trim(),
            logo: form.logo.trim() || null,
          },
        }),
      "Organization updated.",
    );

  const submitAdd = async () => {
    let created: Row | undefined;
    const ok = await runWithToast(async () => {
      created = await post.mutateAsync({ path: "/invitations", body: add });
      return created;
    }, "Invitation created.");
    if (ok && created) {
      setInviteResult({
        link: created.data.link,
        emailed: Boolean(created.data.emailed),
      });
      setAdd({ email: "", role: "user" });
    }
  };

  const closeInvite = () => {
    setAdding(false);
    setInviteResult(null);
  };

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast.add({ type: "success", description: "Invitation link copied." });
    } catch {
      toast.add({
        type: "error",
        description: "Unable to copy the link. Select and copy it manually.",
      });
    }
  };

  const changeRole = (member: Row, role: string) =>
    runWithToast(
      () =>
        patch.mutateAsync({ path: `/members/${member.id}`, body: { role } }),
      "Role updated.",
    );

  const runConfirm = async () => {
    if (!confirm) return;
    const action =
      confirm.kind === "remove"
        ? () => del.mutateAsync({ path: `/members/${confirm.member.id}` })
        : confirm.kind === "cancelInvite"
          ? () =>
              del.mutateAsync({ path: `/invitations/${confirm.invitation.id}` })
          : confirm.kind === "transfer"
            ? () =>
                post.mutateAsync({
                  path: "/transfer-ownership",
                  body: { memberId: confirm.member.id },
                })
            : () => post.mutateAsync({ path: "/leave" });
    const message = {
      remove: "Member removed.",
      transfer: "Ownership transferred.",
      leave: "You left the organization.",
      cancelInvite: "Invitation canceled.",
    }[confirm.kind];
    if (await runWithToast(action, message)) {
      setConfirm(null);
      if (confirm.kind === "leave") {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/dashboard");
      }
    }
  };

  const memberName =
    confirm && "member" in confirm ? confirm.member.user.name : "";
  const confirmCopy = {
    remove: {
      title: "Remove member?",
      body: `${memberName} will lose access to the organization.`,
      label: "Remove",
    },
    transfer: {
      title: "Transfer ownership?",
      body: `${memberName} becomes the owner and you become an administrator.`,
      label: "Transfer",
    },
    leave: {
      title: "Leave organization?",
      body: "You will lose access to its stations, wallets and billing.",
      label: "Leave",
    },
    cancelInvite: {
      title: "Cancel invitation?",
      body: "The invitation link will stop working.",
      label: "Cancel invitation",
    },
  } as const;

  return (
    <div className="space-y-4">
      {restricted && (
        <Card>
          <CardHeader>
            <CardTitle>{info.organization.name}</CardTitle>
            <CardDescription>
              {info.policy
                ? `${info.policy.billingMode} billing · ${info.policy.walletSharingMode.toLowerCase()} wallets`
                : "You are a member of this organization."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Your role is <span className="capitalize">{info.myRole}</span>.
              Organization usage, members and billing details are visible to
              organization admins only.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirm({ kind: "leave" })}
            >
              Leave organization
            </Button>
          </CardContent>
        </Card>
      )}
      {!restricted && (
      <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Your role"
          value={<span className="text-lg capitalize">{info.myRole}</span>}
        />
        <StatCard label="Members" value={info.memberCount} />
        <StatCard
          label="Sessions (this billing period)"
          value={info.currentPeriod.sessions}
          hint={`${Number(info.currentPeriod.kwh).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWh`}
        />
        <StatCard
          label="Spend (this billing period)"
          value={Number(info.currentPeriod.spend).toLocaleString(undefined, {
            style: "currency",
            currency: info.policy?.currency ?? "",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            {info.policy
              ? `${info.policy.billingMode} billing · ${info.policy.walletSharingMode.toLowerCase()} wallets (set by platform admins)`
              : "Organization profile."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input
                value={form.name}
                disabled={!canManage}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="URL slug">
              <Input
                value={form.slug}
                disabled={!canManage}
                onChange={(e) =>
                  setForm({ ...form, slug: e.target.value.toLowerCase() })
                }
              />
            </Field>
            <Field label="Logo URL">
              <Input
                value={form.logo}
                disabled={!canManage}
                placeholder="https://…"
                onChange={(e) => setForm({ ...form, logo: e.target.value })}
              />
            </Field>
          </div>
          {canManage && (
            <Button
              onClick={saveDetails}
              disabled={
                !dirty || form.name.trim().length < 2 || patch.isPending
              }
            >
              Save changes
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              Admins manage members, users can charge, and auditors have
              view-only access.
            </CardDescription>
          </div>
          {canManage && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Invite
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <DataTable
            head={["Member", "Role", ""]}
            empty={!members.data?.data.length}
          >
            {members.data?.data.map((m: Row) => (
              <tr key={m.id}>
                <td className="px-3 py-2">
                  <div className="font-medium">
                    {m.user.name || m.user.email}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {m.user.email}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {canManage && m.role !== "owner" ? (
                    <NativeSelect
                      value={m.role}
                      onChange={(e) => changeRole(m, e.target.value)}
                      className="h-8 w-28"
                      aria-label={`Role for ${m.user.name}`}
                    >
                      <option value="admin">Admin</option>
                      <option value="user">User</option>
                      <option value="auditor">Auditor</option>
                    </NativeSelect>
                  ) : (
                    <Badge
                      variant={m.role === "owner" ? "default" : "secondary"}
                      className="capitalize"
                    >
                      {m.role}
                    </Badge>
                  )}
                </td>
                <td className="space-x-1 whitespace-nowrap px-3 py-2 text-right">
                  {isOwner && m.role !== "owner" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setConfirm({ kind: "transfer", member: m })
                      }
                    >
                      Make owner
                    </Button>
                  )}
                  {canManage &&
                    m.role !== "owner" &&
                    m.user.id !== info.currentUserId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setConfirm({ kind: "remove", member: m })
                        }
                      >
                        Remove
                      </Button>
                    )}
                </td>
              </tr>
            ))}
          </DataTable>
          {!isOwner && (
            <div className="mt-3 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirm({ kind: "leave" })}
              >
                Leave organization
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {canViewAll && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Invitations</CardTitle>
              <CardDescription>
                People without an account are asked to register and join
                automatically. Links expire after 7 days.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <DataTable
                head={["Email", "Role", "Status", "Expires", ""]}
                empty={!invitations.data?.data.length}
              >
                {invitations.data?.data.map((inv: Row) => (
                  <tr key={inv.id}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{inv.email}</div>
                      {inv.invitedBy && (
                        <div className="text-xs text-muted-foreground">
                          by {inv.invitedBy}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 capitalize">
                      {inv.role === "member" ? "user" : inv.role}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={
                          inv.status === "pending" ? "default" : "secondary"
                        }
                        className="capitalize"
                      >
                        {inv.status}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {formatDate(inv.expiresAt)}
                    </td>
                    <td className="space-x-1 whitespace-nowrap px-3 py-2 text-right">
                      {inv.link && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => copyLink(inv.link)}
                        >
                          Copy link
                        </Button>
                      )}
                      {canManage && inv.status === "pending" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setConfirm({
                              kind: "cancelInvite",
                              invitation: inv,
                            })
                          }
                        >
                          Cancel
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </DataTable>
              {invitations.data && (
                <Pager
                  page={invitations.data.page}
                  pageSize={invitations.data.pageSize}
                  total={invitations.data.total}
                  onChange={setInvitePage}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Charging activity</CardTitle>
              <CardDescription>
                Sessions started by anyone in the organization.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <DataTable
                head={["Member", "Station", "Status", "Started", "kWh", "Cost"]}
                empty={!sessions.data?.data.length}
              >
                {sessions.data?.data.map((s: Row) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2">{s.user?.name ?? "—"}</td>
                    <td className="px-3 py-2">{s.stationId}</td>
                    <td className="px-3 py-2">{s.status}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {formatDate(s.startTime)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {Number(s.totalKwh).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {s.totalCost} {s.currency}
                    </td>
                  </tr>
                ))}
              </DataTable>
              {sessions.data && (
                <Pager
                  page={sessions.data.page}
                  pageSize={sessions.data.pageSize}
                  total={sessions.data.total}
                  onChange={setSessionPage}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity log</CardTitle>
              <CardDescription>
                Membership, billing and settings changes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <DataTable
                head={["When", "Action", "By"]}
                empty={!audit.data?.data.length}
              >
                {audit.data?.data.map((log: Row) => (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {formatDate(log.createdAt)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {log.action}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {log.actor?.name ?? "System"}
                    </td>
                  </tr>
                ))}
              </DataTable>
              {audit.data && (
                <Pager
                  page={audit.data.page}
                  pageSize={audit.data.pageSize}
                  total={audit.data.total}
                  onChange={setAuditPage}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}
      </>
      )}

      <Modal
        open={adding}
        title={inviteResult ? "Invitation ready" : "Invite member"}
        onClose={closeInvite}
        footer={
          inviteResult ? (
            <Button onClick={closeInvite}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={closeInvite}>
                Cancel
              </Button>
              <Button
                onClick={submitAdd}
                disabled={!add.email.includes("@") || post.isPending}
              >
                Send invitation
              </Button>
            </>
          )
        }
      >
        {inviteResult ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {inviteResult.emailed
                ? "We emailed the invitation. You can also share this link directly:"
                : "Email delivery is not configured, so share this link with the invitee:"}
            </p>
            <div className="flex gap-2">
              <Input
                readOnly
                value={inviteResult.link}
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                variant="outline"
                onClick={() => copyLink(inviteResult.link)}
              >
                Copy
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Field
              label="Email"
              hint="Works for new and existing users. New users register and join automatically."
            >
              <Input
                type="email"
                value={add.email}
                onChange={(e) => setAdd({ ...add, email: e.target.value })}
              />
            </Field>
            <Field label="Role">
              <NativeSelect
                value={add.role}
                onChange={(e) => setAdd({ ...add, role: e.target.value })}
              >
                <option value="admin">Admin</option>
                <option value="user">User</option>
                <option value="auditor">Auditor (view only)</option>
              </NativeSelect>
            </Field>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? confirmCopy[confirm.kind].title : ""}
        description={confirm ? confirmCopy[confirm.kind].body : ""}
        confirmLabel={confirm ? confirmCopy[confirm.kind].label : ""}
        destructive={confirm?.kind !== "transfer"}
        pending={post.isPending || del.isPending}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
