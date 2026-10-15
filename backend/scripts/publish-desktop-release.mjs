#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const compareVersions = (left, right) => {
  const a = left.split('-', 1)[0].split('.').map(Number);
  const b = right.split('-', 1)[0].split('.').map(Number);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  const aPre = left.includes('-'), bPre = right.includes('-');
  if (aPre !== bPre) return aPre ? -1 : 1;
  return left.localeCompare(right);
};
const args = process.argv.slice(2);
const value = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : ''; };
const artifactArg = value('--file');
const version = value('--version');
const notesFile = value('--notes-file');
const root = resolve(value('--root') || process.env.DESKTOP_RELEASE_DIR || resolve(process.env.UPLOAD_DIR || '/var/lib/zalo-crm/files', 'desktop-releases'));

if (!artifactArg || !VERSION_RE.test(version)) {
  console.error('Usage: node scripts/publish-desktop-release.mjs --file <setup.exe> --version <x.y.z> [--notes-file <txt>] [--root <dir>]');
  process.exit(2);
}

const source = resolve(artifactArg);
const filename = basename(source);
if (!filename.toLowerCase().endsWith('.exe')) throw new Error('Release artifact must be a .exe file');
const info = await stat(source);
if (!info.isFile() || info.size <= 0) throw new Error('Release artifact is empty or not a file');

const hash = createHash('sha256');
for await (const chunk of createReadStream(source)) hash.update(chunk);

const notes = notesFile
  ? (await readFile(resolve(notesFile), 'utf8')).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 30)
  : [];
const manifest = {
  version,
  publishedAt: new Date().toISOString(),
  notes,
  platform: 'win32',
  arch: 'x64',
  filename,
  bytes: info.size,
  sha256: hash.digest('hex'),
};

const releaseDir = resolve(root, 'releases', version);
const artifactTarget = resolve(releaseDir, filename);
const artifactTmp = `${artifactTarget}.tmp-${process.pid}`;
const manifestTarget = resolve(releaseDir, 'manifest.json');
const manifestTmp = `${manifestTarget}.tmp-${process.pid}`;
const latestTarget = resolve(root, 'latest.json');
const latestTmp = `${latestTarget}.tmp-${process.pid}`;

if (await stat(manifestTarget).then((item) => item.isFile()).catch(() => false)) {
  throw new Error(`Version ${version} is already published; use a new version number`);
}
try {
  const current = JSON.parse(await readFile(latestTarget, 'utf8'));
  if (typeof current.version === 'string' && VERSION_RE.test(current.version) && compareVersions(version, current.version) < 0) {
    throw new Error(`Refusing to replace latest ${current.version} with older version ${version}`);
  }
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

await mkdir(releaseDir, { recursive: true });
await Promise.all([artifactTmp, manifestTmp, latestTmp].map((path) => rm(path, { force: true })));
await pipeline(createReadStream(source), createWriteStream(artifactTmp, { flags: 'wx' }));
await rename(artifactTmp, artifactTarget);
const json = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(manifestTmp, json, { flag: 'wx' });
await rename(manifestTmp, manifestTarget);
await mkdir(root, { recursive: true });
await writeFile(latestTmp, json, { flag: 'wx' });
await rename(latestTmp, latestTarget);
console.log(JSON.stringify({ published: true, root, ...manifest }, null, 2));
