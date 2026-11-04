import { db } from '@pithcharge/db';

export const PUBLIC_NETWORK_SLUG = 'public-network';

let cachedOrganizationId: string | null = null;

/**
 * Users without an active organization hold personal prepaid wallets under one system organization.
 * This reuses the organization wallet, ledger and settlement code without a second money model.
 */
export async function getPublicNetworkOrganizationId(): Promise<string> {
  if (cachedOrganizationId) return cachedOrganizationId;
  const organization = await db.organization.upsert({
    where: { slug: PUBLIC_NETWORK_SLUG },
    create: {
      name: 'Public network',
      slug: PUBLIC_NETWORK_SLUG,
      createdAt: new Date(),
      metadata: JSON.stringify({ system: true }),
    },
    update: {},
    select: { id: true },
  });
  await db.billingPolicy.upsert({
    where: { organizationId: organization.id },
    create: {
      organizationId: organization.id,
      billingMode: 'PREPAID',
      walletSharingMode: 'INDIVIDUAL',
      autoInvoice: false,
    },
    update: {},
  });
  cachedOrganizationId = organization.id;
  return organization.id;
}

export async function isPublicNetworkOrganization(organizationId: string): Promise<boolean> {
  return organizationId === (await getPublicNetworkOrganizationId());
}
