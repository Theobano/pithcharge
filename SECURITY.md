# Security Policy

## Supported versions

Pithcharge is pre-1.0. Only the latest `0.x` release receives security fixes.

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Use GitHub's private vulnerability reporting (the repository's **Security** tab, then **Report a vulnerability**). Include:

- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- affected versions or commits, and any suggested fix.

You can expect an acknowledgement within 5 working days and a status update within 14 days. Fixes are released as soon as practical, and reporters are credited unless they ask not to be.

## Scope

In scope: authentication and sessions, organization and role access control, wallet, ledger and payment handling, webhook verification (CitrineOS and payment providers), the worker and the Docker images.

Out of scope: vulnerabilities in CitrineOS itself or in third-party payment providers (report those upstream), and issues requiring a compromised host or leaked deployment secrets.

## Operator guidance

- Never commit `.env` files. Only `.env.example` files are tracked.
- Use a long random `BETTER_AUTH_SECRET` and rotate any secret that has been exposed.
- Production startup rejects the mock CMS and mock payment providers; keep it that way.
- Set `TRUSTED_ORIGINS` to your exact web origins and serve everything over HTTPS.
- Configure the CitrineOS and payment webhook secrets so inbound callbacks are verified.
