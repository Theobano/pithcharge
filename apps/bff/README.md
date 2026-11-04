# EV charger BFF

The Fastify BFF serves the web application and connects it to PostgreSQL, CitrineOS, and the payment provider. Copy `.env.example` to `.env` for local development and configure real provider credentials in the production secret manager.

## Production configuration

Production startup intentionally refuses the mock CMS and mock payment providers. Configure:

- `DATABASE_URL` for PostgreSQL.
- A long, random `BETTER_AUTH_SECRET` and the public `BETTER_AUTH_URL`.
- `TRUSTED_ORIGINS` as a comma-separated allowlist of exact browser origins.
- `CMS_PROVIDER=citrineos`, `CITRINEOS_URL`, and `CITRINEOS_API_KEY`. Set the GraphQL URL, Hasura secret, and tenant ID only when required by the CitrineOS deployment.
- `CITRINEOS_WEBHOOK_SECRET` for authenticated charger event delivery to `/api/v1/webhooks/citrineos`.
- `PAYMENT_PROVIDERS` (e.g. `paystack,flutterwave,remita`) plus each provider's keys (see `.env.example`).
- Token synchronization goes through the CMS adapter (`syncIdToken`, CitrineOS GraphQL `Authorizations`) using OCPP 2.0.1 `IdTokenEnumType` values (`Central`, `eMAID`, `ISO14443`, `ISO15693`, `KeyCode`, `Local`, `MacAddress`, `NoAuthorization`). A token is registered at account creation, re-synced on login (`/users/idtoken`) and before every session start, all in real time with no background polling; if the CMS is unreachable at signup the token stays pending and registers on the next login or session start. Existing databases need the `20261027160000_ocpp_id_token_types` migration.

- The CitrineOS adapter follows the operator UI protocol. GraphQL calls send `x-hasura-admin-secret`, `x-hasura-role` and `x-hasura-tenant-id` (default `1`). Commands are `POST {CITRINEOS_URL}/ocpp/{1.6|2.0.1}/{module}/{action}?identifier=<ocppConnectionName>&tenantId=<tenant>` and succeed only when every returned `MessageConfirmation` has `success: true`. EVSE ids sent to the station are `Evses.evseTypeId`.
- Create the first platform admin with `ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run create-admin` from `apps/bff` (existing users are promoted; add `--reset-password` to reset).
- Optional email (`NOTIFICATION_EMAIL_WEBHOOK_URL` and `NOTIFICATION_EMAIL_WEBHOOK_SECRET`), push (`NOTIFICATION_PUSH_WEBHOOK_URL` and `NOTIFICATION_PUSH_WEBHOOK_SECRET`), and generic webhook (`NOTIFICATION_WEBHOOK_URL` and `NOTIFICATION_WEBHOOK_SECRET`) delivery relays.
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in the web build environment when enabling browser push, using the public key matching the push relay's Web Push sender.

Never use development secrets, mock providers, or wildcard origins in production. Provider errors are logged and surfaced rather than converted to empty inventory results.

## Account and access behavior

New users receive a persisted virtual charging token in pending-activation state. On the first authenticated web visit, the UI asks the BFF to synchronize it with the configured CMS; a token becomes active only after successful synchronization. Organization roles are `admin`, `user`, and `auditor`; auditors can view organization data but cannot issue charger-control or membership changes. Member-role changes require an organization administrator.

### Charging and billing

Starting a session is orchestrated by `src/services/charging/`: `startCharging` resolves the connector (`target.ts`), resolves and syncs the token (`token.ts`), then delegates billing to a strategy chosen by `selectBillingStrategy`.

- **Active organization (registered accounts)**: `OrganizationBillingStrategy` follows the organization's billing policy (prepaid/postpaid, shared or individual wallets, credit limits, idempotent wallet reservation).
- **No active organization, or an anonymous account**: `PublicBillingStrategy` creates an unbilled session with no wallet.
- **Anonymous accounts** differ only in `policy.ts`: one live session at a time, tokens registered on the CMS with `concurrentTransaction=false`, no wallets and no personalisation. Registered accounts may run concurrent sessions.

New billing models implement `BillingStrategy` and are selected in `selectBillingStrategy`.

### Error format

All error responses use the Better Auth shape `{ "code": "SOME_CODE", "message": "Human readable text", ...details }`. The `error-format` plugin normalizes legacy `{ error: "text" }` bodies, thrown errors, validation errors and 404s. The web app parses them with `toApiError` in `apps/web/src/lib/api/error.ts`.

### Auth levels

Better Auth anonymous (guest) users hold a real session, so they are authenticated.

- **Public**: station/hub reads and webhooks.
- `fastify.authenticate`: any session, anonymous included. Used for charging (remote start/stop), `/users/idtoken`, own sessions. No session returns 401 `UNAUTHENTICATED`.
- `fastify.requireRegistered`: registered accounts only. Used for billing, notifications, organizations, profile, and hardware commands. Anonymous users get 403 `REGISTERED_ACCOUNT_REQUIRED`.

Guests are unbilled, limited to one live session, and receive tokens with `concurrentTransaction=false`.

## Sessions and remote stop

- `GET /api/v1/sessions/:id` returns the local session (keyed by `ChargingSession.id`), live CMS telemetry (power, energy, SoC, voltage, current) and `canControl`. It is visible and controllable only by the session's owner (`GET /sessions` and `GET /sessions/active` list only the caller's sessions).
- `POST /api/v1/sessions/:id/stop` (and `POST /stations/:id/remote-stop` with `sessionId` or `transactionId`) stops a session. Ownership comes from the local session, not the CMS token. Errors: `SESSION_NOT_FOUND` (404), `SESSION_CONTROL_FORBIDDEN` (403), `SESSION_NOT_ACTIVE` / `SESSION_NOT_STARTED` (409), `REMOTE_STOP_REJECTED` (502).
- Reading a session reconciles it with the CMS: it links the transaction ID once the charger reports it, and settles the session if the CMS reports it finished (covers missed webhooks). Sessions without a wallet (public/anonymous) complete unbilled. The transaction ID, start time and energy are saved while active, and the final details are persisted when the CMS reports the transaction ended.
- Connector/EVSE status is derived from the CMS's latest StatusNotification (not the stale connector column), is `Unavailable` when the station is offline, and shows `Charging` only when an active transaction is actually charging.

## Notifications

Authenticated users can manage event/channel preferences, read their in-app notification inbox, and register or remove browser push subscriptions through the versioned API. Session start/stop requests create idempotent in-app events. Delivery uses a durable database queue with leases, bounded retries, and recorded failure details. Email, push, and generic webhook relays must accept JSON POSTs with a `Bearer` secret; the push relay receives `{ subscriptions, title, body, data }` and must send Web Push using the matching VAPID key. Without a configured relay, the channel is not queued; in-app notifications remain available.

CitrineOS webhooks are authenticated with `x-citrineos-webhook-secret`, deduplicated, and persisted in the integration outbox before asynchronous processing. Transaction start, meter-value, and end events are reconciled to persisted sessions and the organization ledger. Confirm the deployment's webhook event payload shape and configure matching fields before enabling live event delivery.

## Platform admin API

`/api/v1/admin/*` is restricted to platform administrators (`user.role === 'admin'`, non-anonymous) via `requirePlatformAdmin`; others get `401 UNAUTHENTICATED` or `403 PLATFORM_ADMIN_REQUIRED`. Every mutation is written to the audit log with `byPlatformAdmin: true`.

- **Users** (`/users`): list/search, create (the Better Auth hook issues the OCPP token), edit, ban/unban (blocks/reactivates tokens in the CSMS), revoke sessions, block/activate individual tokens.
- **Organizations** (`/organizations`): create/update/delete (deletion refused when ledger history, funded wallets or live sessions exist), manage members and roles, per-member credit limits and wallet assignment, billing policy (including billing mode, which only platform admins may change), wallet freeze/close, and a paged ledger.
- **Impersonation** (`authClient.admin.impersonateUser` / `stopImpersonating`, Better Auth admin plugin): platform admins can sign in as any non-admin, non-banned user from the user detail page. Sessions last one hour, carry `impersonatedBy`, skip the last-active-organization memory, and start with an `admin.impersonation.started` audit entry (actor = admin, target = user). The web app shows a banner with a "Stop impersonating" button. Platform admins cannot be impersonated.
- **Wallet adjustments** (`POST /organizations/:id/wallets/:walletId/adjust`): signed amount with a required reason and idempotency key; posts a balanced ledger transaction against the `ADMIN_ADJUSTMENTS` equity account, never drives available balance below zero on debits, and notifies the wallet holder.
- **Reports** (`/overview`, `/reports/summary`, `/reports/export?type=sessions|ledger|invoices|audit`, `/audit-logs`, `/sessions`): CSV exports are capped at 10,000 rows and neutralize spreadsheet formulas.

## Organization management API

Owners and organization admins manage the session's active organization under `/api/v1/organizations/current` (platform admins use `/admin`). Auditors get read-only access; users see only the basics. Failures return `409 ACTIVE_ORGANIZATION_REQUIRED`, `403 NOT_A_MEMBER` or `403 ORGANIZATION_ROLE_REQUIRED`.

- `GET /` details, caller role and 30-day usage; `PATCH /` name, slug, logo (owner/admin).
- `GET|POST /members`, `PATCH|DELETE /members/:memberId`: list, add an existing registered user by email (use invitations for anyone else), change role, remove. The owner cannot be removed or re-roled, and only the owner removes other admins.
- `POST /leave` (non-owners) and `POST /transfer-ownership` (owner only; the old owner becomes admin).
- `GET /sessions` and `GET /audit-logs` (owner, admin, auditor): org-wide charging activity and change history.
- Billing type and wallet sharing remain platform-admin settings. Wallets, credit limits, top-ups and invoices are under `/billing`.

Every change is written to the audit log.

### Invitations

- `POST /organizations/current/invitations` (owner/admin; `{ email, role }`) creates an invitation valid for 7 days and returns its link (`WEB_APP_URL/invite/<id>`, default `http://localhost:3100`). The link is also emailed through the email relay when `NOTIFICATION_EMAIL_WEBHOOK_URL` is set; otherwise the inviter shares it. `GET /invitations` lists them (links only for pending ones, hidden from auditors) and `DELETE /invitations/:id` cancels a pending one. Duplicates return `409 INVITATION_PENDING` / `ALREADY_MEMBER`.
- `GET /api/v1/invitations/:id` is public and returns the organization, invited email, role, status and whether an account already exists. `GET /invitations/mine` lists pending invitations for the signed-in user's email.
- `POST /api/v1/invitations/:id/accept` requires a registered (non-guest) account whose email matches the invitation. It creates the membership, marks the invitation accepted, and remembers the organization as last active. The invitation id is the secret; emails are never auto-joined by address alone. Errors: `INVITATION_NOT_FOUND`, `INVITATION_EXPIRED` (410), `INVITATION_NOT_PENDING`, `INVITATION_EMAIL_MISMATCH` (403).
- Web: `/invite/<id>` shows the invitation and either registers a new account (email locked) or signs in, then accepts, activates the organization and routes to `/dashboard`. `/auth/login|register?invitation=<id>` redirect there, and pending invitations also show on the dashboard.

### Active organization and session scoping

- Registered users' last active organization is stored on `user.lastActiveOrganizationId` (updated by a Better Auth session hook whenever the active organization changes, `null` meaning public). New sessions start in that organization if the user is still a member; otherwise in public mode. A stale active organization without membership is treated as public.
- Charging sessions are scoped to the active context: with an active organization only sessions billed to it (`organizationId`) are listed, viewable or controllable; in public mode only sessions with no organization. Switching organization in the UI clears cached data and redirects to `/dashboard`.

## Billing cycles and invoices

- Each organization policy has `billingCycleUnit` (`DAY`/`WEEK`/`MONTH`), `billingCycleInterval` (1–52), an optional `billingCycleAnchor` and `autoInvoice`. Boundaries are UTC.
- An hourly scheduler invoices every elapsed cycle (max 12 per run) for postpaid organizations and any organization with a minimum spend. `invoiceCursor` tracks progress; invoices are idempotent per organization and period.
- An invoice bills the session receivables not yet invoiced (`usageCharges`) plus any minimum-spend shortfall (`shortfallCharges`). Receivables were already posted to the ledger at settlement; only the shortfall posts new AR/revenue. Cycles with nothing to bill create no invoice.
- Background processing: the API never generates invoices itself. The stand-alone worker (`apps/worker`, see its README) runs an hourly sweep that fans out one pg-boss job per due organization, with retries and a dead-letter queue.
- Manual issue: `POST /billing/invoices/trigger` (org owner/admin) and `POST /admin/organizations/:id/invoices` (platform admin) enqueue a job and return `202 {jobId}` (409 for a duplicate click within 10 s). Poll `GET /billing/invoices/jobs/:jobId` or `GET /admin/organizations/:id/invoices/jobs/:jobId` for `{state: queued|running|completed|failed, result}`; the result status is `ISSUED`, `EXISTING` or `NOTHING_TO_INVOICE`. `POST /billing/invoices/generate` (platform admin) queues a sweep. Org admins and owners are notified of every invoice.
- Requires `DATABASE_URL` (or `JOBS_DATABASE_URL`) on the API; the queue client connects on first use, and jobs wait in Postgres until a worker is running.

## Rate rules (time-based pricing)

- Each organization has a standard rate on its billing policy (`ratePerKwh`, `ratePerMinute`, `sessionFee`, `idleFeePerMinute`) plus a pricing `timezone` (IANA name).
- `RateRule`s override the standard rate when they match: optional days of week (0 = Sunday), a `HH:MM` window in the policy timezone (an end earlier than the start wraps past midnight), station IDs, a validity period and a `priority` (highest matching rule wins). Rule `sessionFee`, `ratePerMinute` and `idleFeePerMinute` fall back to the standard values when blank.
- Managed by organization admins at `POST/PATCH/DELETE /api/v1/billing/rate-rules[/:ruleId]` and by platform admins at `/api/v1/admin/organizations/:id/rate-rules`. All changes are audit logged. Members can read the schedule via `GET /billing/me` (`rateRules`).
- When an organization session starts, the policy and active rules are frozen into `ChargingSession.pricingSnapshot`; later edits never reprice in-flight sessions. Legacy sessions without a snapshot use their flat rates.
- `services/rate-engine.service.ts` prices a session by splitting its energy evenly over its duration and billing each slice at the rule active at that moment. Session details expose the current rate and a per-rule breakdown (`pricing`).
- Rate precedence: active time-band rule (e.g. 07:00–18:00 and 18:00–07:00) > the organization's optional general price (`ratePerKwh`, `ratePerMinute`, `sessionFee`; `null` = unset) > the CSMS connector tariff (`ICmsAdapter.getConnectorTariff`). `pricing.source` reports `policy`, `csms` or `none`.
- Organization spend/usage shown in the UI covers the current UTC calendar month (`currentPeriod` in the org responses), matching monthly invoicing.
- Apply migrations `20261029170000_rate_rules` and `20261030100000_optional_price_override`.

## Local commands

- `pnpm --filter @pithcharge/bff dev` starts the BFF.
- `pnpm --filter @pithcharge/bff test` runs BFF tests.
- `pnpm --filter @pithcharge/bff build:ts` type-checks and builds the BFF TypeScript.
