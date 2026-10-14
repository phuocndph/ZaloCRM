const DEFAULT_ORIGIN = 'https://zcrm.joliefam.vn';
const ID = /^[a-zA-Z0-9_-]{1,100}$/;

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

function identity(value) {
  if (!value || typeof value.userId !== 'string' || typeof value.orgId !== 'string' || !ID.test(value.userId) || !ID.test(value.orgId)) return null;
  return `${value.orgId}:${value.userId}`;
}

function notification(value) {
  if (!value || typeof value.convId !== 'string' || typeof value.id !== 'string' || !ID.test(value.convId) || !ID.test(value.id)) return null;
  return { convId: value.convId, id: value.id,
    name: typeof value.name === 'string' ? value.name.slice(0, 120) : 'Tin nhan moi',
    context: typeof value.context === 'string' ? value.context.slice(0, 160) : '', at: Date.now() };
}

function clampBounds(bounds, workArea, width, height) {
  return { x: Math.round(Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width))),
    y: Math.round(Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height))), width, height };
}

class ConversationQueue {
  constructor() { this.rows = new Map(); this.owner = null; this.seen = new Set(); }
  setOwner(value) { const next = identity(value); if (next !== this.owner) this.clear(); this.owner = next; }
  clear() { this.rows.clear(); this.seen.clear(); }
  add(value) {
    const row = notification(value);
    if (!this.owner || !row || this.seen.has(row.id)) return false;
    this.seen.add(row.id);
    if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value);
    const old = this.rows.get(row.convId);
    this.rows.delete(row.convId);
    this.rows.set(row.convId, { ...row, count: Math.min((old?.count ?? 0) + 1, 999) });
    if (this.rows.size > 100) this.rows.delete(this.rows.keys().next().value);
    return true;
  }
  remove(id) { this.rows.delete(id); }
  snapshot() { const items = [...this.rows.values()].reverse(); return { items, count: items.reduce((sum, item) => sum + item.count, 0) }; }
}

module.exports = { DEFAULT_ORIGIN, crmOrigin, sameOrigin, identity, notification, clampBounds, ConversationQueue, ID };
