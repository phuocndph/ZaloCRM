// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
import { config } from '../../config/index.js';

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const DEFAULT_ROOT = resolve(config.desktopReleaseDir || resolve(config.uploadDir, 'desktop-releases'));

export interface DesktopReleaseManifest {
  version: string;
  publishedAt: string;
  notes: string[];
  platform: 'win32';
  arch: 'x64';
  filename: string;
  bytes: number;
  sha256: string;
}

export interface DesktopReleaseFile {
  manifest: DesktopReleaseManifest;
  absolutePath: string;
}

function within(root: string, target: string): boolean {
  return target === root || target.startsWith(root + sep);
}

function parseManifest(value: unknown): DesktopReleaseManifest | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const version = typeof raw.version === 'string' ? raw.version.trim() : '';
  const filename = typeof raw.filename === 'string' ? raw.filename.trim() : '';
  const publishedAt = typeof raw.publishedAt === 'string' ? raw.publishedAt : '';
  const notes = Array.isArray(raw.notes) ? raw.notes.filter((note): note is string => typeof note === 'string').map((note) => note.trim()).filter(Boolean).slice(0, 30) : [];
  const bytes = Number(raw.bytes);
  const sha256 = typeof raw.sha256 === 'string' ? raw.sha256.toLowerCase() : '';
  if (!VERSION_RE.test(version) || basename(filename) !== filename || !filename.toLowerCase().endsWith('.exe')) return null;
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || !SHA256_RE.test(sha256)) return null;
  if (raw.platform !== 'win32' || raw.arch !== 'x64' || Number.isNaN(Date.parse(publishedAt))) return null;
  return { version, publishedAt, notes, platform: 'win32', arch: 'x64', filename, bytes, sha256 };
}

async function readManifest(path: string): Promise<DesktopReleaseManifest | null> {
  try {
    return parseManifest(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return null;
  }
}

export function isDesktopReleaseVersion(value: string): boolean {
  return VERSION_RE.test(value);
}

export async function getDesktopRelease(version: string, root = DEFAULT_ROOT): Promise<DesktopReleaseFile | null> {
  if (!VERSION_RE.test(version)) return null;
  const safeRoot = resolve(root);
  const releaseDir = resolve(safeRoot, 'releases', version);
  if (!within(safeRoot, releaseDir)) return null;
  const manifest = await readManifest(resolve(releaseDir, 'manifest.json'));
  if (!manifest || manifest.version !== version) return null;
  const absolutePath = resolve(releaseDir, manifest.filename);
  if (!within(releaseDir, absolutePath)) return null;
  const info = await lstat(absolutePath).catch(() => null);
  if (!info?.isFile() || info.size !== manifest.bytes) return null;
  return { manifest, absolutePath };
}

export async function getLatestDesktopRelease(root = DEFAULT_ROOT): Promise<DesktopReleaseFile | null> {
  const safeRoot = resolve(root);
  const latest = await readManifest(resolve(safeRoot, 'latest.json'));
  if (!latest) return null;
  return getDesktopRelease(latest.version, safeRoot);
}

export function desktopReleaseStream(release: DesktopReleaseFile) {
  return createReadStream(release.absolutePath);
}
