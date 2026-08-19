# Production images for the cafe management system.
#
# Two targets, both built from one source tree so the schema and the code that reads it
# are always the same build:
#
#   --target runtime   the Next.js app. Standalone output, no dev dependencies, no source.
#   --target migrate   a one-shot container that applies migrations, then exits.
#
# Built in CI and shipped. NEVER build on the VPS: 4 GB will OOM on `next build`
# (PROJECT-SPEC § 3).

ARG NODE_VERSION=24-alpine

# ---------------------------------------------------------------------------
# deps — production dependencies only, cached on the lockfile
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# libc6-compat: @node-rs/argon2 ships a prebuilt native binary expecting glibc symbols.
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# build — needs dev dependencies; produces .next/standalone
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Telemetry off: this builds on a CI runner and phones nobody.
# Build-time placeholder ONLY. "next build" imports every page to collect its data, and
# a build machine has no database credentials and must not need any. Nothing connects at
# build time. This value never reaches the runtime stage - that is a separate FROM, and
# instrumentation.ts asserts the real configuration when the server starts.
# Deliberately not localhost: src/lib/env.ts rejects that in production as the classic
# compose wiring mistake, and the check should stay strict.
ENV DATABASE_URL=postgres://build:build@build-time-placeholder:5432/build
ENV SEED_OWNER_PASSWORD=build-time-placeholder
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production
RUN npm run build

# ---------------------------------------------------------------------------
# migrate — one-shot: apply migrations and exit
# ---------------------------------------------------------------------------
# Deliberately a separate target rather than extra baggage in the runtime image. The app
# container should not be able to alter the schema, and the runtime image should not carry
# a migration runner it never invokes.
FROM node:${NODE_VERSION} AS migrate
WORKDIR /app
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY drizzle ./drizzle
COPY src/db ./src/db
COPY src/lib ./src/lib
USER node
# Node 24 runs TypeScript directly, so there is nothing to compile here.
CMD ["node", "src/db/migrate.ts"]

# ---------------------------------------------------------------------------
# runtime — the app. No source, no dev dependencies, non-root.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
RUN apk add --no-cache libc6-compat

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# node:alpine already ships uid/gid 1000 as `node`; no need to create one.
USER node

# Standalone output bundles only the dependencies the server actually reached for, so
# node_modules is not copied wholesale.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

EXPOSE 3000

# No curl or wget in the final image; node is already here and is one fewer package.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
