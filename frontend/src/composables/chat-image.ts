// SPDX-License-Identifier: AGPL-3.0-or-later
/** Shared image recognition for single messages, albums and the image viewer. */
export function chatImageUrls(message: { contentType?: string | null; content?: string | null }): string[] {
  const kind = message.contentType;
  if (kind && !['image', 'text'].includes(kind)) return [];
  const raw = message.content?.trim() || '';
  let data: Record<string, unknown> = {};
  try { const parsed = JSON.parse(raw); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed; } catch { /* Direct image URL. */ }
  let params: Record<string, unknown> = {};
  try { const parsed = typeof data.params === 'string' ? JSON.parse(data.params) : data.params; if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) params = parsed; } catch { /* Legacy metadata. */ }
  const safe = (value: unknown): value is string => {
    if (typeof value !== 'string' || !value.trim() || value.length > 8192 || value.includes('\\')) return false;
    const url = value.trim();
    if (!/^https?:\/\//i.test(url) && !/^\/(?!\/)/.test(url)) return false;
    try { const parsed = new URL(url, 'https://crm.invalid'); return !parsed.username && !parsed.password; } catch { return false; }
  };
  const urls = [...new Set([data.hdUrl, data.oriUrl, data.href, data.normalUrl, data.fileUrl, data.url, data.thumbUrl, data.thumb, data.thumbnail, raw].filter(safe).map(v => v.trim()))];
  if (kind === 'image') return urls;
  if (!Object.keys(data).length) return []; // Plain text containing a photo URL remains text.
  // Older messages have no contentType. Do not mistake a document/link thumbnail for an image message.
  const extension = String(params.fileExt || '').replace(/^\./, '');
  if (extension && !/^(?:jpe?g|png|webp|gif|bmp|avif)$/i.test(extension)) return [];
  if (typeof data.mime === 'string' && !data.mime.startsWith('image/')) return [];
  const primary = urls[0]; if (!primary) return [];
  const parsed = new URL(primary, 'https://crm.invalid');
  return /\.(?:jpe?g|png|webp|gif|bmp|avif)$/i.test(parsed.pathname) || /(?:^|\.)(?:zdn\.vn|zaloapp\.com|zalocontent\.com)$/i.test(parsed.hostname) ? urls : [];
}
export const chatImageUrl = (message: Parameters<typeof chatImageUrls>[0]) => chatImageUrls(message)[0] || null;
