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
   explicit that the restore is what gets tested, not the backup. The two scripts exist
   (see Backups below); what is left is putting `backup.sh` in cron on the real box and
   pointing `R2_REMOTE` at the bucket.

## Backups, and the restore that proves them

Two scripts, both meant to run on the VPS beside `docker-compose.prod.yml`.

**`backup.sh`** — one `pg_dump -Fc` per night, written `.partial` and moved on success,
refused if the result is implausibly small, copied off the box, then old ones pruned. In
that order: a prune that runs after a failed copy deletes the backups that still worked.

    # /etc/crontab on the VPS
    0 2 * * *  cd /srv/cafe && R2_REMOTE=r2:cafe-backups ./backup.sh >> /var/log/cafe-backup.log 2>&1

`R2_REMOTE` is an [rclone](https://rclone.org/) remote. **Without it the script still runs
and warns**: a backup on the same disk as the database survives a bad migration and
nothing else — not a dead disk, not a deleted instance, not ransomware.

**`restore-check.sh`** — restores the newest dump into a scratch database next to the live
one, compares row counts table by table, checks the append-only trigger came back, and
drops the scratch database. The live database is only ever read.

    cd /srv/cafe && ./restore-check.sh

Monthly, and **once before go-live with the output kept** — that output is the handover
deliverable in § 12, not the existence of the scripts.

It reports a restored count *lower* than live as rows newer than the backup, which is
normal, and an *empty* table where live has rows as a failure. `pg_restore` runs with
`--exit-on-error`, because it otherwise prints a screen of warnings, exits 0, and leaves
you with half a database and a passing check.

Both scripts default to `docker-compose.prod.yml`; set `COMPOSE="docker compose"` to
rehearse against a local stack. That is how the first successful restore was run on
16 September 2026 — ten tables, every count matching, trigger present.

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

---

## Demo box on a free VPS (not the production path above)

The E2E target above still stands for production and § 13 still applies. This section is
a **throwaway demo host**, on the developer's own free-tier account, with no client data
on it. Do not let it drift into production: no real orders, no real customer records.

**Provider: Oracle Cloud Always Free, Mumbai or Hyderabad.** The only free tier big
enough to run this stack — Ampere A1, up to 4 ARM vCPU / 24 GB, free indefinitely rather
than for 12 months. Google's e2-micro (1 GB) and Oracle's AMD micro shapes are too small
for Postgres + Next + Caddy together. Two known annoyances: signup needs a card for
identity verification (no charge on Always Free), and popular regions often answer
"Out of host capacity" for A1 — retry, or take 2 vCPU / 12 GB instead of 4 / 24.

Ampere is ARM64, which is why CI now publishes `linux/amd64,linux/arm64` for both images.
The same `IMAGE_TAG` works on either architecture.

### 1. Create the instance — you, not an agent

Account creation and card entry are yours to do. Shape `VM.Standard.A1.Flex`,
Ubuntu 24.04, paste your SSH public key, and open 80/443 in the subnet's security list
(Oracle blocks them by default — this is the step everyone forgets).

### 2. Harden and install Docker

    sudo apt update && sudo apt install -y unattended-upgrades
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker ubuntu   # log out and back in
    # Ubuntu images on Oracle ship iptables rules that drop 80/443 regardless of the
    # console's security list. Both have to allow it.
    sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
    sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
    sudo netfilter-persistent save

### 3. Ship the three files it needs

From the repo, `scp` `deploy/docker-compose.prod.yml`, `Caddyfile`, and a `.env` you
write on the server (never committed) into `~/cafe/`:

    GHCR_REPO=<lowercase owner/repo>
    IMAGE_TAG=sha-<the sha CI published>
    SITE_ADDRESS=:80          # demo: plain HTTP on the IP. A hostname here gets TLS free.
    POSTGRES_PASSWORD=<generated>
    SEED_OWNER_PASSWORD=<generated>

Then, if the packages are private, `docker login ghcr.io` with a PAT scoped
`read:packages`, and:

    docker compose -f docker-compose.prod.yml pull
    docker compose -f docker-compose.prod.yml up -d

Migrations run as a one-shot before the app starts, same as locally. Seeding is not
automatic — `docker compose run --rm migrate node src/db/seed.ts` if the demo needs the
owner account.

### 4. Deleting it

It is a demo. `docker compose down -v` and terminate the instance; nothing here is
backed up, and § 10.5's tested-restore requirement is deliberately not met.
