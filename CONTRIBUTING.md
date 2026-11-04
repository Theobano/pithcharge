# Contributing to Pithcharge

Thanks for helping. Pithcharge is licensed under [Apache-2.0](./LICENSE); by submitting a contribution you agree it is licensed under the same terms.

## Setup

Requirements: Node.js 24+, pnpm 11, PostgreSQL 16+.

```sh
pnpm install
cp apps/bff/.env.example apps/bff/.env       # then edit
cp apps/web/.env.example apps/web/.env.local
cp apps/worker/.env.example apps/worker/.env
pnpm --filter @pithcharge/db exec prisma generate --config prisma7.config.ts
pnpm --filter @pithcharge/db exec prisma migrate deploy --config prisma7.config.ts
pnpm --filter @pithcharge/bff dev
pnpm --filter @pithcharge/web dev
pnpm --filter @pithcharge/worker dev
```

The mock CMS and mock payment provider let you develop without a CitrineOS instance. Or run everything with `docker compose up --build`.

## Repository layout

- `apps/web` Next.js UI, `apps/bff` Fastify API, `apps/worker` pg-boss worker, `apps/docs` docs site.
- `packages/*` shared code: `db` (Prisma), `auth`, `cms-adapters`, `payment-adapters`, `billing-core`, `notifications`, `jobs`, `ui`.
- Add new CMS or payment providers as adapters in the matching package rather than inside the apps.

## Before opening a pull request

```sh
pnpm check-types
pnpm lint
pnpm --filter @pithcharge/bff test
pnpm --filter @pithcharge/worker test
pnpm --filter @pithcharge/web build
```

CI runs the same checks. Also:

- Keep changes focused; unrelated refactors belong in their own PR.
- Add or update tests for behavior changes, especially anything touching money, wallets or the ledger.
- Schema changes need a new Prisma migration. Never edit an existing migration.
- Update `.env.example` and docs when you add or remove configuration.
- Never commit secrets or `.env` files.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/), for example `feat(billing): add flutterwave top-ups` or `fix(bff): scope ledger query to wallet id`.

## Reporting bugs and security issues

Open an issue with reproduction steps. For vulnerabilities, follow [SECURITY.md](./SECURITY.md) instead of filing a public issue.
