# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0-alpha.1] - Unreleased

First public pre-release.

### Added
- Next.js driver and organization UI, Fastify BFF, Better Auth, Prisma/PostgreSQL.
- CitrineOS adapter (inventory, commands, webhooks) with a mock CMS for development.
- Organization roles (admin, auditor, user), invitations and platform administration.
- Prepaid/postpaid billing, shared/individual/mixed wallets, double-entry ledger, configurable billing cycles and invoices, manual wallet funding.
- Public-network personal wallets, charging rates with hub, charger and CSMS overrides.
- Payment providers: Paystack, Flutterwave, Remita (Flutterwave and Remita not yet verified against live APIs).
- Notifications (in-app, email, push, webhook), low-credit alerts.
- pg-boss worker as an independent package, with audit and ledger partition maintenance.
- Docker images, docker-compose stack and CI.
