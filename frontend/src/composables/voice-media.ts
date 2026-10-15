export function voiceMedia(content: string | null): { urls: string[]; durationMs: number } {
  let data: Record<string, unknown> = {};
  const raw = content?.trim() || '';
  try { const parsed = JSON.parse(raw); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed; } catch { /* Direct media URL. */ }
  let params: Record<string, unknown> = {};
  try { const parsed = typeof data.params === 'string' ? JSON.parse(data.params) : data.params; if (parsed && typeof parsed === 'object') params = parsed; } catch { /* Legacy metadata. */ }
  const urls = [...new Set([raw, data.href, data.fileUrl, data.url, data.normalUrl, data.hdUrl, params.m4a].filter((value): value is string => {
    if (typeof value !== 'string' || !value.trim() || value.length > 8192) return false;
    const url = value.trim();
    if (!/^https?:\/\//i.test(url) && !/^\/(?!\/)/.test(url)) return false;
    try { const parsed = new URL(url, 'https://crm.invalid'); return !parsed.username && !parsed.password; } catch { return false; }
  }).map((url) => url.trim()))];
  const durationMs = Number(data.duration ?? params.duration ?? 0);
  return { urls, durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0 };
}
