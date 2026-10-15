const DEFAULT_ORIGIN = 'https://zcrm.joliefam.vn';
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_INSTALLER_BYTES = 3 * 1024 * 1024 * 1024;

function crmOrigin(value = DEFAULT_ORIGIN) {
  const url = new URL(value);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || !(url.protocol === 'https:' || (local && url.protocol === 'http:'))) throw new Error('CRM requires an HTTPS origin');
  return url.origin;
}

function sameOrigin(value, origin) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && url.origin === origin && !url.username && !url.password; } catch { return false; }
}

function compareVersions(left, right) {
  if (!VERSION.test(left) || !VERSION.test(right)) return 0;
  const a = left.split('-', 1)[0].split('.').map(Number);
  const b = right.split('-', 1)[0].split('.').map(Number);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  const aPre = left.includes('-'), bPre = right.includes('-');
  if (aPre !== bPre) return aPre ? -1 : 1;
  return left.localeCompare(right);
}

function desktopRelease(value, origin, currentVersion) {
  if (!value || typeof value !== 'object' || typeof origin !== 'string' || typeof currentVersion !== 'string') return null;
  const raw = value;
  const version = typeof raw.version === 'string' ? raw.version : '';
  const filename = typeof raw.filename === 'string' ? raw.filename : '';
  const sha256 = typeof raw.sha256 === 'string' ? raw.sha256.toLowerCase() : '';
  if (!VERSION.test(version) || compareVersions(version, currentVersion) <= 0) return null;
  if (raw.platform !== 'win32' || raw.arch !== 'x64' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.exe$/i.test(filename)) return null;
  if (!Number.isSafeInteger(raw.bytes) || raw.bytes <= 0 || raw.bytes > MAX_INSTALLER_BYTES || !SHA256.test(sha256)) return null;
  try {
    const url = new URL(typeof raw.downloadUrl === 'string' ? raw.downloadUrl : '', origin);
    const expected = `/api/v1/desktop/releases/${encodeURIComponent(version)}/download`;
    if (url.origin !== origin || url.pathname !== expected || url.search || url.hash || url.username || url.password) return null;
    return { version, filename, bytes: raw.bytes, sha256, url: url.href };
  } catch { return null; }
}

function githubRelease(value) {
  if (!value || value.draft || value.prerelease || typeof value.tag_name !== 'string') return null;
  const version = value.tag_name.replace(/^v/, '');
  if (!VERSION.test(version)) return null;
  const filename = `ZaloCRM-Setup-${version}.exe`;
  const asset = Array.isArray(value.assets) ? value.assets.find((item) => item.name === filename && item.state === 'uploaded') : null;
  const expectedUrl = `https://github.com/phuocndph/ZaloCRM/releases/download/${encodeURIComponent(value.tag_name)}/${filename}`;
  if (!asset || asset.browser_download_url !== expectedUrl || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_INSTALLER_BYTES) return null;
  const sha256 = typeof asset.digest === 'string' ? asset.digest.replace(/^sha256:/, '') : '';
  if (!SHA256.test(sha256)) return null;
  return { version, filename, bytes: asset.size, sha256, url: expectedUrl, source: 'github',
    notes: typeof value.body === 'string' ? value.body.slice(0, 4000) : '', publishedAt: value.published_at };
}

function identity(value) {
  if (!value || typeof value.userId !== 'string' || typeof value.orgId !== 'string' || !ID.test(value.userId) || !ID.test(value.orgId)) return null;
  return `${value.orgId}:${value.userId}`;
}

function notification(value, origin = DEFAULT_ORIGIN) {
  if (!value || typeof value.convId !== 'string' || typeof value.id !== 'string' || !ID.test(value.convId) || !ID.test(value.id)) return null;
  const text = (input, length) => typeof input === 'string' ? input.replace(/[\u0000-\u001f]/g, ' ').slice(0, length) : '';
  const avatarUrls = [];
  const sources = [value.avatarUrl, ...(Array.isArray(value.avatarUrls) ? value.avatarUrls.slice(0, 3) : [])];
  if (!value.redacted) for (const source of sources) {
    try {
      if (typeof source !== 'string' || !source || source.length > 4096) continue;
      const url = new URL(source, origin);
      if (url.username || url.password || !(url.protocol === 'https:' || sameOrigin(url.href, origin))) continue;
      if (!avatarUrls.includes(url.href)) avatarUrls.push(url.href);
      if (avatarUrls.length === 3) break;
    } catch {}
  }
  return { convId: value.convId, id: value.id, redacted: value.redacted === true,
    name: value.redacted ? 'Tin nhắn mới' : text(value.name, 120) || 'Tin nhắn mới',
    senderName: value.redacted ? '' : text(value.senderName, 120),
    context: value.redacted ? 'Nội dung riêng tư' : text(value.context, 160),
    preview: value.redacted ? 'Bạn có tin nhắn mới' : text(value.preview, 240),
    avatarUrl: avatarUrls[0] || null, avatarUrls, announce: value.announce !== false,
    sequence: Number.isSafeInteger(value.sequence) && value.sequence > 0 ? value.sequence : 0,
    at: Number.isSafeInteger(value.at) && value.at > 0 && value.at <= Date.now() ? value.at : Date.now() };
}

function clampBounds(bounds, workArea, width, height) {
  return { x: Math.round(Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width))),
    y: Math.round(Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height))), width, height };
}

function adjacentBounds(anchor, work, width, height) {
  const w = Math.min(width, work.width), h = Math.min(height, work.height);
  const x = anchor.x + anchor.width + 10 + w <= work.x + work.width
    ? anchor.x + anchor.width + 10 : anchor.x - w - 10;
  return clampBounds({ x, y: anchor.y + anchor.height - h }, work, w, h);
}
function shouldAutoHide({ pinned, focused, childFocused, dialogOpen, holding }) {
  return !pinned && !focused && !childFocused && !dialogOpen && !holding;
}
class ConversationQueue {
  constructor() { this.rows = new Map(); this.unread = new Map(); this.latestSequences = new Map(); this.owner = null; this.seen = new Set(); this.revision = 0; }
  setOwner(value) { const next = identity(value); if (next !== this.owner) this.clear(); this.owner = next; }
  clear() { this.rows.clear(); this.unread.clear(); this.latestSequences.clear(); this.seen.clear(); this.revision++; }
  add(value, origin) {
    const row = notification(value, origin);
    if (!this.owner || !row || this.seen.has(row.id)) return false;
    this.seen.add(row.id);
    if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value);
    const old = this.rows.get(row.convId);
    const stale = row.sequence > 0 && (this.latestSequences.get(row.convId) ?? 0) > row.sequence;
    if (stale && !old) return false;
    if (row.sequence > 0 && !stale) {
      this.latestSequences.delete(row.convId); this.latestSequences.set(row.convId, row.sequence);
      if (this.latestSequences.size > 2000) this.latestSequences.delete(this.latestSequences.keys().next().value);
    }
    if (!stale) this.rows.delete(row.convId);
    this.rows.set(row.convId, { ...(stale ? old : row), count: Math.min((old?.count ?? 0) + 1, 999) });
    this.unread.set(row.convId, Math.min((this.unread.get(row.convId) ?? 0) + 1, 9999));
    this.revision++;
    if (this.rows.size > 100) this.rows.delete(this.rows.keys().next().value);
    return true;
  }
  remove(id) { this.rows.delete(id); this.unread.delete(id); this.revision++; }
  syncUnread(counts, revision) {
    if (!this.owner || revision !== this.revision || !Array.isArray(counts) || counts.length > 50000) return false;
    const unread = new Map();
    for (const row of counts) {
      if (typeof row?.convId !== 'string' || !ID.test(row.convId) || !Number.isSafeInteger(row.count) || row.count < 0 || row.count > 1000000) return false;
      if (row.count) unread.set(row.convId, row.count);
    }
    this.unread = unread;
    for (const id of this.rows.keys()) if (!unread.has(id)) this.rows.delete(id);
    this.revision++; return true;
  }
  snapshot() { return { items: [...this.rows.values()].reverse(), count: [...this.unread.values()].reduce((a, b) => a + b, 0), revision: this.revision }; }
}

module.exports = { DEFAULT_ORIGIN, crmOrigin, sameOrigin, compareVersions, desktopRelease, githubRelease, identity, notification, clampBounds, adjacentBounds, shouldAutoHide, ConversationQueue, ID };
