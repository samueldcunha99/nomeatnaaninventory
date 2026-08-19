# Deploy — target, and what is deliberately not done yet

**Nothing here provisions anything, and no deploy has happened.** The step is written and
stubbed, waiting on one thing outside the codebase.

## Gate

**The E2E Networks account does not exist yet.** It must be created by the **client**, in
the client's name, on the client's payment method.

This is contractual, not a preference — PROJECT-SPEC § 13 puts every third-party account
in the client's name on the client's card. **No agent should propose provisioning under
the developer's own account**, however convenient it looks. A server the client cannot pay
for or log into directly is a server they cannot keep when the warranty ends.

## Target

| | |
|---|---|
| Provider / region | **E2E Networks, Mumbai** |
| OS | Ubuntu 24.04 LTS |
| Size | 2 vCPU, 4 GB RAM |
| Auth | **SSH key only — root password login disabled** |
| Account holder | The client |

Chosen over DigitalOcean Bangalore and AWS Lightsail because E2E bills in **INR with a GST
invoice**, which the client needs, and Mumbai is closer to Aurangabad than Bangalore.

## What already works, and what is left

Done and verified locally:

- `Dockerfile` — multi-stage, two targets (`runtime`, `migrate`), standalone output,
  non-root, no dev dependencies in the final image.
- `docker-compose.yml` — Postgres, one-shot migrations, the app, and Caddy in front.
- `.github/workflows/ci.yml` — tests against a real Postgres, typecheck, build, and on
  merge to `main` a push of both images to GHCR.

Left, once the account exists:

1. Create the server (client), add the developer's SSH key.
2. Harden: `PermitRootLogin no`, `PasswordAuthentication no`, ufw to 22/80/443 only,
   unattended-upgrades.
3. Install Docker Engine and the compose plugin.
4. Point a DNS A record at it — `order.cafename.com` per PROJECT-SPEC § 7.
5. Write `docker-compose.prod.yml`. It differs from the local file in exactly two ways:
   it **pulls a published image** instead of building, and `SITE_ADDRESS` is the real
   hostname so Caddy provisions TLS itself. The Postgres port publication is removed —
   only the app needs to reach the database.
6. Add the four repository secrets and uncomment the `deploy` job in `ci.yml`.
7. Nightly `pg_dump` to Cloudflare R2, **and a tested restore** — PROJECT-SPEC § 10.5 is
   explicit that the restore is what gets tested, not the backup.

## Rules that outlive this file

- **Never run `next build` on the VPS.** 4 GB will OOM. The image is built in CI and
  shipped. This is why the compose file on the server pulls rather than builds.
- **Deploy by `sha-` tag or digest, not `latest`.** A rollback should be a one-line change
  to a pinned tag, not a rebuild.
- **Migrations run as a one-shot container before the app starts**, from the same source
  tree as the app image, so the schema and the code reading it are never mismatched.
  Compose enforces the order with `service_completed_successfully`.
- **The app container cannot alter the schema.** The migration runner is a separate image
  target on purpose.
