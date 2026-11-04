# syntax=docker/dockerfile:1
#
# One Dockerfile, four targets: migrate, bff, worker, web.
#   docker build --target bff -t pithcharge-bff .
# The workspace packages are consumed as TypeScript source, so every target ships the installed
# workspace. Slimming the images (per-app pruning with `turbo prune --docker`) is a possible follow-up.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
ENV CI=true
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
WORKDIR /app

FROM base AS deps
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @pithcharge/db exec prisma generate --config prisma7.config.ts

# One-shot database migration job.
FROM deps AS migrate
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@pithcharge/db", "exec", "prisma", "migrate", "deploy", "--config", "prisma7.config.ts"]

FROM deps AS bff
ENV NODE_ENV=production
ENV PORT=4000
ENV FASTIFY_ADDRESS=0.0.0.0
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@pithcharge/bff", "start"]

FROM deps AS worker
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@pithcharge/worker", "start"]

FROM deps AS web
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time.
ARG NEXT_PUBLIC_BFF_URL=http://localhost:4000
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=
ENV NEXT_PUBLIC_BFF_URL=$NEXT_PUBLIC_BFF_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @pithcharge/web build
ENV NODE_ENV=production
ENV PORT=3100
ENV HOSTNAME=0.0.0.0
EXPOSE 3100
CMD ["pnpm", "--filter", "@pithcharge/web", "start"]
