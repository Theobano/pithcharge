# Pithcharge

Open source EV charging platform for drivers and organizations, built on [CitrineOS](https://github.com/citrineos/citrineos-core). *Pith* is the core of a citrus fruit; Pithcharge is the layer around CitrineOS that people actually use.

> **Status: pre-release (`0.1.0-alpha.1`).** APIs and the database schema may still change. See [CHANGELOG.md](./CHANGELOG.md).

## Architecture

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js UI for drivers, organizations and platform admins |
| `apps/bff` | Fastify API: Better Auth, charging, billing, admin, CitrineOS webhooks |
| `apps/worker` | Stand-alone pg-boss worker: scheduled and manual invoicing, partition maintenance (run any number of replicas) |
| `packages/db` | Prisma schema, migrations and client (PostgreSQL) |
| `packages/auth`, `auth-adapters` | Better Auth configuration and adapters |
| `packages/cms-adapters` | CitrineOS and mock CMS adapters |
| `packages/payment-adapters` | Paystack, Flutterwave, Remita and mock providers |
| `packages/billing-core`, `notifications`, `jobs` | Billing domain, notification delivery, job contracts shared by API and worker |

Package scope: `@pithcharge/*`.

## Quick start with Docker

```sh
cp .env.example .env     # set BETTER_AUTH_SECRET; see the file for CitrineOS and payment settings
docker compose up --build
```

Web: <http://localhost:3100>, API: <http://localhost:4000>. The stack runs PostgreSQL, a one-shot migration job, the API, the worker and the web app. Production mode (the default) rejects the mock CMS and mock payment providers; for a local trial set `NODE_ENV=development`, `CMS_PROVIDER=mock` and `PAYMENT_PROVIDERS=mock` in `.env`. `NEXT_PUBLIC_*` values are baked into the web image at build time, so rebuild it if the public URLs change.

Create the first platform admin:

```sh
docker compose run --rm bff pnpm --filter @pithcharge/bff create-admin
```

(set `ADMIN_EMAIL`, `ADMIN_NAME` and `ADMIN_PASSWORD` in the environment first; see `apps/bff/.env.example`).

## Local development

Requirements: Node.js 24+, pnpm 11, PostgreSQL 16+.

```sh
pnpm install
cp apps/bff/.env.example apps/bff/.env
cp apps/web/.env.example apps/web/.env.local
cp apps/worker/.env.example apps/worker/.env
pnpm --filter @pithcharge/db exec prisma generate --config prisma7.config.ts
pnpm --filter @pithcharge/db exec prisma migrate deploy --config prisma7.config.ts
pnpm --filter @pithcharge/bff dev
pnpm --filter @pithcharge/web dev
pnpm --filter @pithcharge/worker dev
```

Each app and package carries its own `.env.example` containing only the variables it uses. Setup details for the API are in [apps/bff/README.md](./apps/bff/README.md) and for the worker in [apps/worker/README.md](./apps/worker/README.md).

## Features

- CitrineOS inventory, remote start/stop and webhook intake; a mock CMS for development.
- Viewport-bounded, clustered hub map; hub and station detail pages with live status.
- Organizations with admin, auditor (view-only) and user roles, invitations and platform administration.
- Automatic charging-token creation and synchronization with CitrineOS.
- Prepaid and postpaid billing set by platform admins; shared, individual or mixed wallets; negative-balance allowances; organization rate schedules and minimum spend; configurable billing cycles and manual invoice runs.
- Personal wallets for public-network users, public/hub/charger/CSMS charging rates, and a funded-wallet requirement for paid chargers.
- Wallet funding through Paystack, Flutterwave and Remita, or manually by platform admins.
- Double-entry ledger, audit log, structured and redacted logs, partitioned high-volume tables.
- In-app, email, push and webhook notifications, including low-credit alerts.

## Deployment notes

- Apply migrations with `prisma migrate deploy` (the `migrate` compose service does this). The `20261027080000_initial_schema` migration bootstraps a clean database; on an existing database verify schema parity before adopting it, and never edit applied migrations.
- Confirm the CitrineOS webhook schema and shared secret against your deployment.
- Flutterwave and Remita integrations and CSMS tariff pulling have not been verified against live services; test with provider sandbox credentials first.
- Validate invoice timing, rates, tax and accounting treatment before enabling live billing.
- Serve everything over HTTPS and set `TRUSTED_ORIGINS` to your exact web origins.
- Email: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `EMAIL_FROM` on the API and worker (any SMTP provider works). This enables invitations, password reset and email notifications; set `EMAIL_REQUIRE_VERIFICATION=true` to require verified addresses. Platform admins can check the configuration and send a test message under Admin → Email. Without SMTP, email is disabled and in-app notifications still work.

## Validation

```sh
pnpm check-types
pnpm lint
pnpm --filter @pithcharge/bff test
pnpm --filter @pithcharge/worker test
pnpm --filter @pithcharge/web build
```

## Contributing, security, license

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [SECURITY.md](./SECURITY.md). Licensed under the [Apache License 2.0](./LICENSE). Pithcharge is an independent project and is not affiliated with CitrineOS.
