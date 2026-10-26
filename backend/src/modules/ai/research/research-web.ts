// SPDX-License-Identifier: AGPL-3.0-or-later
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import ipaddr from 'ipaddr.js';
import { load } from 'cheerio';
import robotsParser from 'robots-parser';
import { ResearchError, canonicalUrl, facebookUrl, normalize, redact } from './research-domain.js';

const parseRobots = robotsParser as unknown as (url: string, content: string) => { isAllowed(url: string, agent: string): boolean | undefined };
const USER_AGENT = 'ZCRMResearchBot';
export const MAX_DOWNLOAD_BYTES = 1_000_000;
export function publicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export async function resolvePublicHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, '');
  const records = ipaddr.isValid(host) ? [{ address: host, family: ipaddr.parse(host).kind() === 'ipv4' ? 4 : 6 }] : await lookup(host, { all: true });
  if (!records.length || records.some((record) => !publicAddress(record.address))) throw new ResearchError('Không được đọc địa chỉ nội bộ.', 400, 'RESEARCH_UNSAFE_URL');
  return records[0];
}
/** Pin the checked DNS address into the actual connection, including every redirect. */
export async function download(raw: string, options: { method?: string; headers?: Record<string, string>; body?: string; limit?: number } = {}) {
  const url = new URL(canonicalUrl(raw));
  const address = await resolvePublicHost(url.hostname);
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    const req = request(url, {
      method: options.method ?? 'GET', agent: false,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html, text/plain, application/json', 'Accept-Encoding': 'identity', ...options.headers },
      family: address.family,
      lookup: (_host, opts, callback) => {
        if (opts.all) callback(null, [{ address: address.address, family: address.family }]);
        else callback(null, address.address, address.family);
      },
    }, (res) => {
      let size = 0; const buffers: Buffer[] = [];
      res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > (options.limit ?? MAX_DOWNLOAD_BYTES)) { res.destroy(new ResearchError('Trang quá lớn.', 400, 'RESEARCH_PAGE_TOO_LARGE')); } else buffers.push(chunk); });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode ?? 500, headers: res.headers, body: Buffer.concat(buffers).toString('utf8') }));
    });
    const timer = setTimeout(() => req.destroy(new ResearchError('Hết thời gian đọc trang.', 504, 'RESEARCH_FETCH_TIMEOUT')), 15_000);
    req.once('close', () => clearTimeout(timer)); req.once('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
export function allowedDomain(host: string, allowlist = process.env.RESEARCH_WEB_ALLOWED_DOMAINS ?? ''): boolean {
  // Public pages are the default. Operators may restrict domains explicitly;
  // DNS pinning, robots, login checks and redirect checks still apply to every site.
  if (!allowlist.trim()) return true;
  return allowlist.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).some((domain) => domain.startsWith('*.') ? host.endsWith(domain.slice(1)) : host === domain);
}
export function extractPage(html: string) {
  const $ = load(html);
  const title = normalize($('title').first().text()).slice(0, 300);
  const date = $('meta[property="article:published_time"]').attr('content') ?? $('time[datetime]').first().attr('datetime');
  $('script,style,noscript,nav,footer,header,form,iframe,svg').remove();
  const main = $('article').first().length ? $('article').first() : $('main').first().length ? $('main').first() : $('body');
  main.find('p,div,li,br,h1,h2,h3').each((_i, el) => { $(el).append('\n'); });
  return { title, content: redact(normalize(main.text())).slice(0, 12000), publishedAt: date && !Number.isNaN(Date.parse(date)) ? new Date(date) : null };
}
export async function readPage(raw: string): Promise<{ status: string; errorCode: string | null; url: string; title?: string; content?: string; publishedAt?: Date | null }> {
  let url = canonicalUrl(raw);
  for (let redirect = 0; redirect < 4; redirect++) {
    if (facebookUrl(url)) return { status: 'requires_manual', errorCode: 'FACEBOOK_MANUAL_IMPORT', url };
    const parsed = new URL(url);
    if (!allowedDomain(parsed.hostname)) return { status: 'blocked', errorCode: 'DOMAIN_NOT_ALLOWED', url };
    const robotsUrl = `${parsed.origin}/robots.txt`;
    const robots = await download(robotsUrl, { limit: 256000 });
    if (robots.status !== 404 && robots.status !== 410 && (robots.status !== 200 || parseRobots(robotsUrl, robots.body).isAllowed(url, USER_AGENT) === false)) return { status: 'blocked', errorCode: 'ROBOTS_DENIED', url };
    const response = await download(url);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;
      if (typeof location !== 'string') throw new ResearchError('Chuyển trang không hợp lệ.', 502, 'RESEARCH_REDIRECT');
      url = canonicalUrl(new URL(location, url).toString()); continue;
    }
    if ([401, 403].includes(response.status)) return { status: 'requires_manual', errorCode: 'PAGE_ACCESS_DENIED', url };
    if (response.status !== 200) return { status: 'failed', errorCode: 'PAGE_HTTP_ERROR', url };
    const mime = String(response.headers['content-type'] ?? '');
    if (!/^text\/(html|plain)/i.test(mime)) return { status: 'failed', errorCode: 'UNSUPPORTED_CONTENT_TYPE', url };
    if (/content-encoding/i.test(Object.keys(response.headers).join(' ')) && response.headers['content-encoding'] !== 'identity') return { status: 'failed', errorCode: 'UNSUPPORTED_CONTENT_ENCODING', url };
    if (/^text\/html/i.test(mime)) {
      const html = load(response.body);
      const title = html('title').first().text();
      if ((html('input[type="password"]').length && !html('article').length) || /just a moment|access denied|captcha|security check/i.test(title)) {
        return { status: 'requires_manual', errorCode: 'LOGIN_OR_CHALLENGE_REQUIRED', url };
      }
    }
    const page = mime.startsWith('text/plain') ? { title: parsed.hostname, content: redact(normalize(response.body)).slice(0, 12000), publishedAt: null } : extractPage(response.body);
    if (page.content.length < 100) return { status: 'snippet_only', errorCode: 'INSUFFICIENT_PAGE_TEXT', url };
    return { status: 'read', errorCode: null, url, ...page };
  }
  throw new ResearchError('Quá nhiều lần chuyển trang.', 400, 'RESEARCH_TOO_MANY_REDIRECTS');
}
export async function searchGoogle(query: string, apiKey?: string) {
  const key = apiKey ?? process.env.RESEARCH_SERPER_API_KEY;
  if (!key) throw new ResearchError('Chưa cấu hình dịch vụ tìm Google.', 409, 'RESEARCH_SEARCH_NOT_CONFIGURED');
  const response = await download('https://google.serper.dev/search', {
    method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, gl: 'vn', hl: 'vi', num: 10 }), limit: 256000,
  });
  if ([401, 403].includes(response.status)) throw new ResearchError('Mã kết nối tìm kiếm bị từ chối. Hãy kiểm tra lại mã Serper.', 409, 'RESEARCH_SEARCH_AUTH_FAILED');
  if (response.status !== 200) throw new ResearchError('Dịch vụ tìm kiếm không trả kết quả.', 502, 'RESEARCH_SEARCH_FAILED');
  const payload = JSON.parse(response.body);
  if (!Array.isArray(payload.organic)) throw new ResearchError('Kết quả tìm kiếm sai định dạng.', 502, 'RESEARCH_SEARCH_FAILED');
  return payload.organic.slice(0, 10).flatMap((item: Record<string, unknown>) => {
    try { return [{ url: canonicalUrl(String(item.link)), title: String(item.title ?? item.link).slice(0, 300) }]; } catch { return []; }
  }) as Array<{ url: string; title: string }>;
}
