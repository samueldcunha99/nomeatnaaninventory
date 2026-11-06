# Prepared encrypted off-site backups

**Prepared, not activated.** No destination, cloud credential or encryption key was
created by this change. No actual off-site upload or decryption/restore was performed.
The scheduled job is skipped until the repository variable `BACKUP_ENABLED` is exactly
`true`. Manual dispatch validates configuration and fails clearly when it is missing.

The workflow is `.github/workflows/nightly-backup.yml`. It runs at **03:00 Asia/Kolkata**
(`30 21 * * *` UTC on the preceding day) or by manual dispatch, from `main` only. It uses
the `production-backups` GitHub environment, native PostgreSQL 17 client tools, GnuPG,
tar and AWS CLI v2. It uses no Docker and requires no backup secrets in Netlify.

## What the job does

1. Validate the explicit database, recipient, endpoint, bucket and fixed object prefix.
2. Run the existing `deploy/backup.ts`: a native custom-format dump and a manifest whose
   checksum/table counts come from the same exported, read-only PostgreSQL snapshot.
3. Verify the dump checksum, completed file pair and `pg_restore --list` ledger entry.
4. Pin the imported **public key** to the complete configured fingerprint. Package only
   the dump and its matching manifest, then encrypt both together using GnuPG.
5. Require completed GnuPG status and binary public-key/integrity-protected packet
   headers. A plaintext file with a `.gpg` filename is refused.
6. Upload only that encrypted bundle to the configured HTTPS S3-compatible destination,
   with Content-MD5 transport verification, encrypted-file SHA-256 metadata and
   `If-None-Match: *` protection against replacing an existing object.
7. Remove dump, manifest, tar file and temporary public keyring on success or error.

Files are generated under a private temporary directory. Native tool output is withheld
because connection errors can contain credentials. No Actions artifact is uploaded,
including on failure. The upload process receives S3 credentials; the database process
receives database credentials. GnuPG/tar receive neither. The client-held private key is
never present on the runner. Runner termination relies on GitHub's disposable VM cleanup;
there is no plaintext artifact or cache path in this workflow.

## Client configuration, before activation

Use client-owned accounts. Create the `production-backups` GitHub environment and restrict
deployments to the protected `main` branch **before adding credentials**. Review changes
to this workflow and the deployment scripts as privileged code. The scheduled job reads
`BACKUP_ENABLED` as a **repository-level** variable; keep it unset or `false` during setup.

The client supplies an encryption-capable GPG key and verifies its full primary-key
fingerprint through a trusted channel. Only its minimal, ASCII-armored public export goes
to GitHub. Keep the private key, passphrase and a recovery copy under the client's control,
outside GitHub and Netlify. Losing them makes the encrypted backups unrecoverable. The
script does not generate keys or accept private-key material.

Create a **private, dedicated S3-compatible bucket** with public access disabled. On AWS,
enable Block Public Access; on R2, keep public `r2.dev`/custom-domain access disabled.
The provider must support PutObject Content-MD5 and conditional `If-None-Match` writes;
unsupported behavior fails the job and must not be worked around by uploading plaintext.

Use an upload credential restricted to `s3:PutObject` under the chosen bucket/prefix, with
no list, read, delete, ACL or bucket-policy permissions. If the provider cannot restrict a
token by prefix, dedicate the bucket to this cafe and restrict the token to that bucket.
Downloads/restores use a separate client-controlled read credential. Configure retention,
versioning or object-lock policies with the client; this script never prunes cloud objects.

Configure these **environment secrets**:

| Secret | Value |
|---|---|
| `BACKUP_DATABASE_URL` | Source direct/session connection on port 5432, with read access to public/drizzle and snapshot/dump permissions; a dedicated backup role is preferable |
| `DATABASE_SSL_CA` | Source PostgreSQL/Supabase CA certificate |
| `BACKUP_GPG_PUBLIC_KEY` | One ASCII-armored public encryption key; never a private key |
| `BACKUP_S3_ACCESS_KEY_ID` | Restricted bucket-upload credential identifier |
| `BACKUP_S3_SECRET_ACCESS_KEY` | Its secret; never a web-service variable |

Configure these **environment variables**:

| Variable | Value |
|---|---|
| `BACKUP_GPG_RECIPIENT` | Full 40- or 64-hex-character primary fingerprint, independently checked |
| `BACKUP_S3_ENDPOINT` | HTTPS service origin, e.g. the client's S3/R2 endpoint; no bucket path or credentials |
| `BACKUP_S3_BUCKET` | Private bucket name, without `s3://` or a path |
| `BACKUP_S3_PREFIX` | Fixed relative prefix, such as `nomeatnaan/production`; no leading/trailing slash |
| `BACKUP_S3_REGION` | Explicit service region, or `auto` for R2 |

For a local configuration-only check, provide the same values as environment variables;
map the S3 credential variables to `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` and the
region to `AWS_DEFAULT_REGION`, then run:

```text
node deploy/offsite-backup.ts --check-config
```

That check does not connect, prove the bucket is private, or prove recovery. After review,
manually dispatch **Encrypted off-site backup** on `main`, verify an encrypted object was
created under the expected prefix, and complete the recovery rehearsal below. Only then
set the repository variable `BACKUP_ENABLED=true`. No activation was done by this change.

## Failure notifications and ongoing checks

The failure step records a recovery reminder in the job summary. Enable GitHub Actions
failure notifications for the client responsible for backups and verify that they receive
one from an intentionally failed configuration-only rehearsal. Scheduled-run notifications
go to the workflow's cron author or re-enabling actor according to GitHub settings; they
are not automatically sent to every cafe owner. This change sends no email or message.

The owner must monitor the most recent **successful off-site object**, not merely a green
or skipped Actions page. Scheduled Actions can be delayed, and public repositories can
have schedules disabled after 60 days without repository activity. GitHub cron is not an
always-on backup-service guarantee. Review key expiry, credential expiry, bucket usage and
schedule state, and rehearse recovery regularly. Keep the latest known good object if a
backup fails; do not change the live app connection or disable TLS to make the job green.

## Download, decrypt and rehearse recovery

Use a trusted client device with the private GPG key and separate read credential. Work
in a private directory outside a public checkout. Record the encrypted object's key and
SHA-256 from its `sha256` metadata. Download it with `aws s3api get-object` using the
configured HTTPS endpoint, then compare the local encrypted file's SHA-256 with that
metadata before decrypting. The upload-only credential cannot perform this download.

```text
gpg --output recovery.tar --decrypt recovery.tar.gpg
tar -tvf recovery.tar
```

Inspect the listing: it must contain exactly two **regular files**, one `cafe-<timestamp>.dump`
and the matching `.dump.json`, with no directory paths, links or other entries. Extract
only those two explicit basenames into a new private directory. Never blindly extract
an unexpected archive over the application checkout or another existing directory.

Create a **separate empty** test database. Set the original source `BACKUP_DATABASE_URL`,
the target `RESTORE_DATABASE_URL` and `RESTORE_DATABASE_SSL_CA`, then use the existing
restore tool with the extracted dump:

```text
npm run db:restore-check -- /private/recovery/cafe-<timestamp>.dump
```

It refuses the source database and nonempty targets, checks the manifest checksum,
restores, compares table counts and verifies append-only protections. Reapply the target's
runtime grants with the existing migrator, then verify reads with that target's restricted
runtime role as described in [the main recovery runbook](README.md#5-native-backups-and-a-demonstrated-restore).
Record the successful rehearsal and client recovery contact. Do not switch production to
the rehearsal database. Encryption/upload success does not establish a successful restore.

## Verification and references

The orchestration tests use isolated files and stub native commands. They verify missing
configuration, checksum mismatch, unrelated files, wrong fingerprints, private-key
packets, old PostgreSQL tools, failed encryption status, disguised plaintext, constrained
upload arguments and cleanup. They do **not** exercise a real cloud destination or prove
client-key recovery. The plaintext-output regression was observed failing when its
ciphertext guard was deliberately removed, then passing after restoration.

Primary references checked for this implementation:

- [GitHub scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [GitHub workflow notifications](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs)
- [PostgreSQL Ubuntu client installation](https://www.postgresql.org/download/linux/ubuntu/)
- [GnuPG input/output and public-key inspection](https://gnupg.org/documentation/manuals/gnupg/GPG-Input-and-Output.html)
- [S3 PutObject checksums and conditional writes](https://docs.aws.amazon.com/cli/latest/reference/s3api/put-object.html)
