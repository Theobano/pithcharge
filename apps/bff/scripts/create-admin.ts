/**
 * Creates (or promotes) a platform admin / superadmin.
 *
 * Usage (from apps/bff):
 *   ADMIN_EMAIL=ops@example.com ADMIN_PASSWORD='S3cret-pass!' ADMIN_NAME='Ops' npm run create-admin
 *   npm run create-admin -- --email ops@example.com --password 'S3cret-pass!' --name Ops
 *
 * Prefer environment variables so the password stays out of shell history/process lists.
 * If the user already exists it is promoted to admin; the password is only reset with --reset-password.
 */
import { auth } from '@pithcharge/auth';
import { db } from '@pithcharge/db';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const email = (arg('email') ?? process.env.ADMIN_EMAIL)?.trim().toLowerCase();
  const password = arg('password') ?? process.env.ADMIN_PASSWORD;
  const name = (arg('name') ?? process.env.ADMIN_NAME ?? 'Platform Admin').trim();
  const resetPassword = process.argv.includes('--reset-password');

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error('A valid --email (or ADMIN_EMAIL) is required.');
  }
  if (!password || password.length < 8) {
    throw new Error('A password of at least 8 characters is required (--password or ADMIN_PASSWORD).');
  }

  const ctx = await auth.$context;
  const existing = await ctx.internalAdapter.findUserByEmail(email, { includeAccounts: true });

  if (existing) {
    await ctx.internalAdapter.updateUser(existing.user.id, { role: 'admin', banned: false });
    const credential = existing.accounts.find((account) => account.providerId === 'credential');
    if (!credential) {
      await ctx.internalAdapter.linkAccount({
        userId: existing.user.id,
        providerId: 'credential',
        issuer: 'local:credential',
        accountId: existing.user.id,
        password: await ctx.password.hash(password),
      });
    } else if (resetPassword) {
      await ctx.internalAdapter.updatePassword(existing.user.id, await ctx.password.hash(password));
    }
    console.log(`Promoted existing user ${email} to platform admin.`);
    return;
  }

  const created = await auth.api.signUpEmail({ body: { email, password, name } });
  await ctx.internalAdapter.updateUser(created.user.id, { role: 'admin', emailVerified: true });
  console.log(`Created platform admin ${email}.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
