/** Verified native snapshot -> public-key encryption -> private S3-compatible storage. */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { databaseConfig } from '../src/lib/database-config.ts';

type Env = Record<string, string | undefined>;
export type BackupConfig = {
  databaseUrl: string; ca: string; publicKey: string; recipient: string;
  endpoint: string; bucket: string; prefix: string; region: string; accessKey: string; secretKey: string;
};
export type Execute = (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string>;

/** Error messages contain setting names, never their values or native-tool output. */
export function backupConfig(env: Env): BackupConfig {
  const required = ['BACKUP_DATABASE_URL', 'DATABASE_SSL_CA', 'BACKUP_GPG_PUBLIC_KEY', 'BACKUP_GPG_RECIPIENT',
    'BACKUP_S3_ENDPOINT', 'BACKUP_S3_BUCKET', 'BACKUP_S3_PREFIX', 'AWS_DEFAULT_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
  const missing = required.filter(name => !env[name]?.trim());
  if (missing.length) throw new Error(`Backup configuration missing: ${missing.join(', ')}. Scheduled backups remain disabled until configured.`);
  if (env.GITHUB_ACTIONS === 'true' && env.GITHUB_REF !== 'refs/heads/main') throw new Error('Off-site backups may run only from refs/heads/main.');
  const databaseUrl = env.BACKUP_DATABASE_URL!.trim(), ca = env.DATABASE_SSL_CA!.trim();
  try { databaseConfig({ DATABASE_URL: databaseUrl, DATABASE_SSL_CA: ca, NODE_ENV: 'development' }); }
  catch { throw new Error('BACKUP_DATABASE_URL or DATABASE_SSL_CA is invalid. Use a verified direct/session database connection.'); }
  const recipient = env.BACKUP_GPG_RECIPIENT!.replace(/\s/g, '').toUpperCase();
  if (!/^(?:[A-F0-9]{40}|[A-F0-9]{64})$/.test(recipient)) throw new Error('BACKUP_GPG_RECIPIENT must be a complete public-key fingerprint, not an email or short key ID.');
  const publicKey = env.BACKUP_GPG_PUBLIC_KEY!.trim();
  if (publicKey.length > 131072 || !publicKey.startsWith('-----BEGIN PGP PUBLIC KEY BLOCK-----') ||
      !publicKey.endsWith('-----END PGP PUBLIC KEY BLOCK-----') || /PRIVATE KEY|SECRET KEY/.test(publicKey) ||
      (publicKey.match(/BEGIN PGP PUBLIC KEY BLOCK/g)?.length !== 1)) throw new Error('BACKUP_GPG_PUBLIC_KEY must contain exactly one armored public key. Never put a private key in CI.');
  let endpoint: URL;
  try { endpoint = new URL(env.BACKUP_S3_ENDPOINT!.trim()); }
  catch { throw new Error('BACKUP_S3_ENDPOINT must be an HTTPS service endpoint.'); }
  if (endpoint.protocol !== 'https:' || !endpoint.hostname || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      endpoint.pathname !== '/' || ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error('BACKUP_S3_ENDPOINT must be an HTTPS service endpoint without credentials, path, query or fragment.');
  const bucket = env.BACKUP_S3_BUCKET!.trim(), prefix = env.BACKUP_S3_PREFIX!.trim(), region = env.AWS_DEFAULT_REGION!.trim();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes('..') || /^\d+\.\d+\.\d+\.\d+$/.test(bucket)) throw new Error('BACKUP_S3_BUCKET must be a bucket name, not a URL or path.');
  if (!/^[A-Za-z0-9][A-Za-z0-9/_-]{0,149}$/.test(prefix) || prefix.endsWith('/') || prefix.includes('//')) throw new Error('BACKUP_S3_PREFIX must be a fixed relative prefix without empty or parent segments.');
  if (!/^[a-z0-9-]{2,32}$/.test(region)) throw new Error('AWS_DEFAULT_REGION must be an explicit service region (or auto for R2).');
  return { databaseUrl, ca, publicKey, recipient, endpoint: endpoint.origin, bucket, prefix, region,
    accessKey: env.AWS_ACCESS_KEY_ID!.trim(), secretKey: env.AWS_SECRET_ACCESS_KEY!.trim() };
}

const execute: Execute = (command, args, env) => new Promise((done, fail) => {
  const child = spawn(command, args, { env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal: AbortSignal.timeout(15 * 60 * 1000) });
  let stdout = '', settled = false;
  const reject = () => { if (!settled) { settled = true; fail(new Error('A backup tool failed. Check its installation, configuration and permissions; native output is withheld to protect credentials.')); } };
  child.stdout.setEncoding('utf8').on('data', chunk => {
    stdout += chunk;
    if (stdout.length > 1048576) { child.kill(); reject(); }
  });
  child.stderr.resume();
  child.once('error', reject);
  child.once('close', code => { if (code !== 0) reject(); else if (!settled) { settled = true; done(stdout); } });
});

async function digest(file: string, algorithm: 'sha256' | 'md5', encoding: 'hex' | 'base64') {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}

async function regularFile(directory: string, file: string, minimum: number, maximum: number) {
  const path = resolve(directory, file), info = await lstat(path);
  if (dirname(path) !== directory || info.isSymbolicLink() || !info.isFile() || await realpath(path) !== path ||
      info.size < minimum || info.size > maximum) throw new Error('Backup refused: unexpected file path, type or size.');
  return { path, size: info.size };
}

/** Check the public-key session packet is followed by integrity-protected encrypted data. */
export function assertEncryptedPacket(bytes: Uint8Array) {
  const data = Buffer.from(bytes);
  let offset: number, length: number;
  if (data.length < 8 || (data[0] & 0x80) === 0) throw new Error('Backup refused: encryption output is not a binary OpenPGP message.');
  const modern = (data[0] & 0x40) !== 0;
  const tag = modern ? data[0] & 0x3f : (data[0] >> 2) & 0x0f;
  if (tag !== 1) throw new Error('Backup refused: public-key encryption packet missing.');
  if (modern) {
    const first = data[1];
    if (first < 192) { length = first; offset = 2; }
    else if (first < 224) { length = (first - 192) * 256 + data[2] + 192; offset = 3; }
    else if (first === 255) { length = data.readUInt32BE(2); offset = 6; }
    else throw new Error('Backup refused: unexpected public-key packet length.');
  } else {
    const mode = data[0] & 3;
    if (mode === 0) { length = data[1]; offset = 2; }
    else if (mode === 1) { length = data.readUInt16BE(1); offset = 3; }
    else if (mode === 2) { length = data.readUInt32BE(1); offset = 5; }
    else throw new Error('Backup refused: indeterminate public-key packet.');
  }
  const next = offset + length;
  if (![3, 6].includes(data[offset]) || length < 10 || next + 2 >= data.length || (data[next] & 0x80) === 0) throw new Error('Backup refused: truncated public-key encryption packet.');
  const encryptedTag = (data[next] & 0x40) ? data[next] & 0x3f : (data[next] >> 2) & 0x0f;
  if (![18, 20].includes(encryptedTag)) throw new Error('Backup refused: integrity-protected encrypted data missing.');
}

export async function runOffsiteBackup(config: BackupConfig, options: { execute?: Execute; temporaryRoot?: string } = {}) {
  const run = options.execute ?? execute;
  const temporaryRoot = await realpath(options.temporaryRoot ?? tmpdir());
  const work = await mkdtemp(join(temporaryRoot, 'cafe-offsite-'));
  await chmod(work, 0o700);
  const dumpDirectory = join(work, 'dump'), keyDirectory = join(work, 'gnupg');
  const baseEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    NODE_ENV: 'production', LANG: 'C.UTF-8', AWS_EC2_METADATA_DISABLED: 'true', AWS_PAGER: '',
  };
  try {
    await mkdir(dumpDirectory, { mode: 0o700 }); await mkdir(keyDirectory, { mode: 0o700 });
    const version = await run('pg_dump', ['--version'], baseEnv);
    if (Number(version.match(/\b(\d+)(?:\.\d+)?/)?.[1] ?? 0) < 17) throw new Error('PostgreSQL client 17 or newer is required for the source database.');
    if (!/aws-cli\/2\./.test(await run('aws', ['--version'], baseEnv))) throw new Error('AWS CLI v2 is required.');
    await run('gpg', ['--version'], baseEnv);
    await run(process.execPath, ['deploy/backup.ts'], { ...baseEnv, BACKUP_DIR: dumpDirectory,
      BACKUP_DATABASE_URL: config.databaseUrl, DATABASE_SSL_CA: config.ca, NODE_ENV: 'development' });
    const files = await readdir(dumpDirectory);
    const dumps = files.filter(file => /^cafe-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.dump$/.test(file));
    if (dumps.length !== 1 || files.length !== 2 || !files.includes(`${dumps[0]}.json`)) throw new Error('Backup refused: expected exactly one completed dump and its manifest.');
    const dump = await regularFile(dumpDirectory, dumps[0], 5120, 4 * 1024 ** 3);
    const manifestFile = await regularFile(dumpDirectory, `${dumps[0]}.json`, 1, 1048576);
    const manifest = JSON.parse(await readFile(manifestFile.path, 'utf8')) as { version?: unknown; sha256?: unknown; tables?: unknown };
    if (manifest.version !== 1 || !/^[a-f0-9]{64}$/.test(String(manifest.sha256)) || !Array.isArray(manifest.tables) ||
        !manifest.tables.length || !manifest.tables.every(table => table && typeof table === 'object' &&
          ['public', 'drizzle'].includes(table.schema) && /^[a-z_][a-z0-9_]*$/.test(table.name) && /^\d+$/.test(table.count)) ||
        !manifest.tables.some(table => table.schema === 'public' && table.name === 'stock_movements')) throw new Error('Backup refused: invalid snapshot manifest.');
    if (await digest(dump.path, 'sha256', 'hex') !== manifest.sha256) throw new Error('Backup refused: dump checksum differs from its snapshot manifest.');
    const contents = await run('pg_restore', ['--list', dump.path], baseEnv);
    if (!/TABLE DATA public stock_movements\b/.test(contents)) throw new Error('Backup refused: archive does not contain the cafe ledger.');
    const keyFile = join(work, 'recipient.asc'); await writeFile(keyFile, config.publicKey, { mode: 0o600 });
    const gpg = ['--no-options', '--batch', '--no-tty', '--homedir', keyDirectory];
    const keys = await run('gpg', [...gpg, '--with-colons', '--import-options', 'show-only', '--import', keyFile], baseEnv);
    let expectingFingerprint = false; const fingerprints: string[] = [];
    for (const line of keys.split(/\r?\n/)) {
      const fields = line.split(':');
      if (['sec', 'ssb'].includes(fields[0])) throw new Error('Backup refused: private key material must never be provided to CI.');
      if (fields[0] === 'pub') expectingFingerprint = true;
      else if (fields[0] === 'fpr' && expectingFingerprint) { fingerprints.push(fields[9].toUpperCase()); expectingFingerprint = false; }
    }
    if (fingerprints.length !== 1 || fingerprints[0] !== config.recipient) throw new Error('Backup refused: public-key fingerprint does not match the configured recipient.');
    await run('gpg', [...gpg, '--import', keyFile], baseEnv);
    const archive = join(work, 'snapshot.tar'), encrypted = join(work, 'snapshot.tar.gpg');
    await run('tar', ['--format=ustar', '-cf', archive, '-C', dumpDirectory, '--', dumps[0], `${dumps[0]}.json`], baseEnv);
    await regularFile(work, basename(archive), 5120, 4 * 1024 ** 3); await chmod(archive, 0o600);
    const encryption = await run('gpg', [...gpg, '--trust-model', 'always', '--status-fd', '1', '--recipient', config.recipient, '--output', encrypted, '--encrypt', archive], baseEnv);
    if (!encryption.includes('[GNUPG:] BEGIN_ENCRYPTION ') || !encryption.includes('[GNUPG:] END_ENCRYPTION')) throw new Error('Backup refused: GnuPG did not confirm completed encryption.');
    const output = await regularFile(work, basename(encrypted), 512, 4 * 1024 ** 3); await chmod(encrypted, 0o600);
    const handle = await open(encrypted, 'r'); const header = Buffer.alloc(65536);
    try { const { bytesRead } = await handle.read(header, 0, header.length, 0); assertEncryptedPacket(header.subarray(0, bytesRead)); }
    finally { await handle.close(); }
    const sha256 = await digest(encrypted, 'sha256', 'hex'), md5 = await digest(encrypted, 'md5', 'base64');
    const objectKey = `${config.prefix}/${dumps[0]}.${randomUUID()}.tar.gpg`;
    const uploaded = await run('aws', ['--endpoint-url', config.endpoint, 's3api', 'put-object', '--bucket', config.bucket,
      '--key', objectKey, '--body', encrypted, '--content-type', 'application/pgp-encrypted', '--content-md5', md5,
      '--metadata', `sha256=${sha256}`, '--if-none-match', '*', '--output', 'json', '--no-cli-pager'], {
      ...baseEnv, AWS_ACCESS_KEY_ID: config.accessKey, AWS_SECRET_ACCESS_KEY: config.secretKey, AWS_DEFAULT_REGION: config.region,
      AWS_CONFIG_FILE: join(work, 'no-config'), AWS_SHARED_CREDENTIALS_FILE: join(work, 'no-credentials'),
      AWS_REQUEST_CHECKSUM_CALCULATION: 'when_required', AWS_RESPONSE_CHECKSUM_VALIDATION: 'when_required',
    });
    if (typeof JSON.parse(uploaded).ETag !== 'string') throw new Error('Upload did not return an object acknowledgement; inspect the destination before retrying.');
    return { sha256, bytes: output.size };
  } finally {
    // The only recursive deletion target is our own mkdtemp directory under the verified temporary root.
    if (dirname(resolve(work)) !== temporaryRoot || !basename(work).startsWith('cafe-offsite-')) throw new Error('Temporary cleanup refused: unexpected directory.');
    await rm(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    const config = backupConfig(process.env);
    if (process.argv[2] === '--check-config') console.log('Backup configuration is complete. No database connection or upload was attempted.');
    else {
      if (process.argv.length > 2) throw new Error('Use no argument to back up, or --check-config to validate settings only.');
      const result = await runOffsiteBackup(config);
      console.log(`Encrypted backup uploaded with transport checksum verification (${result.bytes} bytes; SHA-256 ${result.sha256}).`);
    }
  } catch (error) {
    // Parsing failures may contain source fragments; expose only our authored, credential-free messages.
    const message = error instanceof Error && /^(Backup |Off-site |BACKUP_|AWS_|PostgreSQL |A backup |Upload |Use )/.test(error.message)
      ? error.message : 'Backup failed before completion. Native output is withheld to protect credentials.';
    console.error(message); process.exitCode = 1;
  }
}
