import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { backupConfig, runOffsiteBackup, assertEncryptedPacket, type Execute } from '../../deploy/offsite-backup.ts';

const fingerprint = '1234567890ABCDEF1234567890ABCDEF12345678';
const env = () => ({
  BACKUP_DATABASE_URL: 'postgres://backup:unit-test-password@db.exampleproject.supabase.co:5432/postgres',
  DATABASE_SSL_CA: 'unit-test-certificate',
  BACKUP_GPG_PUBLIC_KEY: '-----BEGIN PGP PUBLIC KEY BLOCK-----\nunit-test-public-material\n-----END PGP PUBLIC KEY BLOCK-----',
  BACKUP_GPG_RECIPIENT: fingerprint,
  BACKUP_S3_ENDPOINT: 'https://exampleproject.r2.cloudflarestorage.com', BACKUP_S3_BUCKET: 'private-cafe-backups',
  BACKUP_S3_PREFIX: 'nomeatnaan/production', AWS_DEFAULT_REGION: 'auto', AWS_ACCESS_KEY_ID: 'unit-test-key', AWS_SECRET_ACCESS_KEY: 'unit-test-secret',
});

function encryptedPacket() {
  // Structural fixture only. It is not a cryptographic key or a real encrypted backup.
  const data = Buffer.alloc(1024, 0x5a);
  data[0] = 0xc1; data[1] = 12; data[2] = 3;
  data[14] = 0xd2; data[15] = 255; data.writeUInt32BE(1004, 16);
  return data;
}

async function temporary<T>(work: (directory: string) => Promise<T>) {
  const parent = await realpath(tmpdir());
  const directory = await mkdtemp(join(parent, 'cafe-offsite-test-'));
  try { return await work(directory); }
  finally {
    assert.equal(dirname(directory), parent); assert.ok(basename(directory).startsWith('cafe-offsite-test-'));
    await rm(directory, { recursive: true, force: true });
  }
}

type Fault = 'none' | 'checksum' | 'extra-file' | 'fingerprint' | 'private-key' | 'plaintext' | 'old-pg' | 'no-confirmation' | 'upload';
function stub(fault: Fault = 'none') {
  const calls: { command: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const run: Execute = async (command, args, childEnv) => {
    calls.push({ command, args, env: childEnv });
    if (command === 'pg_dump') return `pg_dump (PostgreSQL) ${fault === 'old-pg' ? '16.9' : '17.11'}`;
    if (command === 'aws' && args[0] === '--version') return 'aws-cli/2.36.0';
    if (command === 'gpg' && args[0] === '--version') return 'gpg (GnuPG) 2.4.4';
    if (command === process.execPath) {
      assert.deepEqual(args, ['deploy/backup.ts']);
      const directory = childEnv.BACKUP_DIR!;
      const dump = Buffer.alloc(8192, 0x31); dump.write('PGDMP');
      const name = 'cafe-2026-11-06T21-30-00-000Z.dump';
      await writeFile(join(directory, name), dump);
      await writeFile(join(directory, name + '.json'), JSON.stringify({ version: 1,
        sha256: fault === 'checksum' ? '0'.repeat(64) : createHash('sha256').update(dump).digest('hex'),
        tables: [{ schema: 'public', name: 'stock_movements', count: '0' }] }));
      if (fault === 'extra-file') await writeFile(join(directory, 'unrelated-private-file'), 'must never be archived');
      return 'Backup written';
    }
    if (command === 'pg_restore') return '1; 0 123 TABLE DATA public stock_movements backup';
    if (command === 'gpg' && args.includes('show-only')) return `${fault === 'private-key' ? 'sec' : 'pub'}:-:4096:1:::::::::\nfpr:::::::::${fault === 'fingerprint' ? '0'.repeat(40) : fingerprint}:\n`;
    if (command === 'gpg' && args.includes('--import')) return '';
    if (command === 'tar') {
      assert.equal(args[0], '--format=ustar'); assert.equal(args.at(-2), 'cafe-2026-11-06T21-30-00-000Z.dump');
      assert.equal(args.at(-1), 'cafe-2026-11-06T21-30-00-000Z.dump.json');
      await writeFile(args[args.indexOf('-cf') + 1], Buffer.alloc(12288, 0x74)); return '';
    }
    if (command === 'gpg' && args.includes('--encrypt')) {
      assert.equal(args[args.indexOf('--recipient') + 1], fingerprint);
      await writeFile(args[args.indexOf('--output') + 1], fault === 'plaintext' ? Buffer.alloc(8192, 0x74) : encryptedPacket());
      return fault === 'no-confirmation' ? '' : '[GNUPG:] BEGIN_ENCRYPTION 2 9\n[GNUPG:] END_ENCRYPTION\n';
    }
    if (command === 'aws' && args.includes('put-object')) {
      assert.match(args[args.indexOf('--body') + 1], /\.tar\.gpg$/);
      assert.equal(args[args.indexOf('--if-none-match') + 1], '*');
      assert.equal(args[args.indexOf('--content-md5') + 1], createHash('md5').update(encryptedPacket()).digest('base64'));
      assert.equal(args[args.indexOf('--metadata') + 1], 'sha256=' + createHash('sha256').update(encryptedPacket()).digest('hex'));
      assert.ok(!args.some(arg => arg.includes('unit-test-password') || arg.includes('unit-test-secret')));
      assert.ok(!args.includes('--acl')); assert.ok(!args.includes('delete-object'));
      return fault === 'upload' ? '{}' : '{"ETag":"unit-test-acknowledgement"}';
    }
    throw new Error('Unexpected stubbed command');
  };
  return { calls, run, uploads: () => calls.filter(c => c.command === 'aws' && c.args.includes('put-object')) };
}

test('off-site backup configuration refuses unset destinations, private keys and ambiguous recipients without exposing values', () => {
  assert.throws(() => backupConfig({}), /Backup configuration missing: BACKUP_DATABASE_URL/);
  for (const patch of [
    { BACKUP_GPG_RECIPIENT: 'owner@example.test' }, { BACKUP_GPG_RECIPIENT: '12345678' },
    { BACKUP_GPG_PUBLIC_KEY: '-----BEGIN PGP PRIVATE KEY BLOCK-----\nprivate\n-----END PGP PRIVATE KEY BLOCK-----' },
    { BACKUP_S3_ENDPOINT: 'http://example.test' }, { BACKUP_S3_ENDPOINT: 'https://private-password@example.test' },
    { BACKUP_S3_ENDPOINT: 'https://example.test/a-path' }, { BACKUP_S3_BUCKET: 's3://wrong/bucket' },
    { BACKUP_S3_PREFIX: '../public' }, { BACKUP_S3_PREFIX: '/public' }, { BACKUP_S3_PREFIX: 'cafe//public' },
    { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/unreviewed' },
  ]) {
    assert.throws(() => backupConfig({ ...env(), ...patch }), error => {
      assert.ok(error instanceof Error); assert.ok(!error.message.includes('unit-test-password'));
      assert.ok(!error.message.includes('private-password')); return true;
    });
  }
  assert.equal(backupConfig(env()).recipient, fingerprint);
});

test('only verified, recipient-encrypted bundles reach the fixed off-site prefix and plaintext temporaries are removed', async () => {
  await temporary(async directory => {
    const s = stub(); const config = backupConfig(env());
    const result = await runOffsiteBackup(config, { execute: s.run, temporaryRoot: directory });
    assert.equal(result.bytes, 1024); assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.equal(s.uploads().length, 1);
    const upload = s.uploads()[0]; assert.match(upload.args[upload.args.indexOf('--key') + 1], /^nomeatnaan\/production\/cafe-.*\.tar\.gpg$/);
    assert.equal(upload.env.BACKUP_DATABASE_URL, undefined); assert.equal(upload.env.AWS_SECRET_ACCESS_KEY, config.secretKey);
    const backup = s.calls.find(c => c.command === process.execPath)!;
    assert.equal(backup.env.AWS_SECRET_ACCESS_KEY, undefined); assert.equal(backup.env.BACKUP_DATABASE_URL, config.databaseUrl);
    for (const gpg of s.calls.filter(c => c.command === 'gpg')) {
      assert.equal(gpg.env.BACKUP_DATABASE_URL, undefined); assert.equal(gpg.env.AWS_SECRET_ACCESS_KEY, undefined);
    }
    assert.deepEqual(await readdir(directory), [], 'dump, manifest, archive and temporary keyring must all be removed');
  });
});

test('backup corruption, unrelated files, wrong recipients, private key packets and old PostgreSQL clients prevent uploads', async () => {
  for (const fault of ['checksum', 'extra-file', 'fingerprint', 'private-key', 'old-pg', 'no-confirmation'] as const) {
    await temporary(async directory => {
      const s = stub(fault);
      await assert.rejects(runOffsiteBackup(backupConfig(env()), { execute: s.run, temporaryRoot: directory }));
      assert.equal(s.uploads().length, 0, fault); assert.deepEqual(await readdir(directory), [], fault);
    });
  }
});

test('plaintext output is refused even when a broken encryption command claims success', async () => {
  await temporary(async directory => {
    const s = stub('plaintext');
    await assert.rejects(runOffsiteBackup(backupConfig(env()), { execute: s.run, temporaryRoot: directory }), /binary OpenPGP/);
    assert.equal(s.uploads().length, 0); assert.deepEqual(await readdir(directory), []);
  });
});

test('an unacknowledged upload fails visibly and still removes every temporary plaintext file', async () => {
  await temporary(async directory => {
    const s = stub('upload');
    await assert.rejects(runOffsiteBackup(backupConfig(env()), { execute: s.run, temporaryRoot: directory }), /acknowledgement/);
    assert.equal(s.uploads().length, 1); assert.deepEqual(await readdir(directory), []);
  });
});

test('the encryption-output guard accepts public-key protected packets and rejects plaintext or unprotected payloads', () => {
  assert.doesNotThrow(() => assertEncryptedPacket(encryptedPacket()));
  assert.throws(() => assertEncryptedPacket(Buffer.from('PGDMP this is a plaintext database dump')), /binary OpenPGP/);
  const unprotected = encryptedPacket(); unprotected[14] = 0xcb;
  assert.throws(() => assertEncryptedPacket(unprotected), /integrity-protected/);
  const noRecipient = encryptedPacket(); noRecipient[0] = 0xc3;
  assert.throws(() => assertEncryptedPacket(noRecipient), /public-key encryption packet/);
});

test('the public-repository backup workflow stays opt-in, main-only and free of published artifacts', async () => {
  const workflow = await readFile('.github/workflows/nightly-backup.yml', 'utf8');
  assert.match(workflow, /cron: '30 21 \* \* \*'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' \|\| vars\.BACKUP_ENABLED == 'true'/);
  assert.match(workflow, /environment: production-backups/);
  assert.match(workflow, /persist-credentials: false/);
  assert.ok(!/upload-artifact|upload-pages-artifact|pull_request_target|^\s+push:/m.test(workflow));
  assert.ok(!workflow.includes('\r'));
});
