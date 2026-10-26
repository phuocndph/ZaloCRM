// SPDX-License-Identifier: AGPL-3.0-or-later
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));
import { download, readPage, resolvePublicHost, searchGoogle } from '../../src/modules/ai/research/research-web.js';
function respond(status: number, body: string, headers: Record<string, string> = { 'content-type': 'text/html' }) {
  mocks.request.mockImplementationOnce((_url, _options, callback) => {
    const req = new EventEmitter() as any;
    req.write = vi.fn(); req.destroy = (e: Error) => { req.emit('error', e); req.emit('close'); };
    req.end = () => queueMicrotask(() => {
      const res = new EventEmitter() as any; res.statusCode = status; res.headers = headers;
      res.destroy = (e: Error) => { res.emit('error', e); req.emit('close'); };
      callback(res); res.emit('data', Buffer.from(body)); res.emit('end'); req.emit('close');
    }); return req;
  });
}
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('RESEARCH_WEB_ALLOWED_DOMAINS', 'safe.test,127.0.0.1'); vi.stubEnv('RESEARCH_SERPER_API_KEY', 'test-key'); mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]); });
describe('research network boundaries', () => {
  it('rejects DNS resolving to private addresses, including mixed records', async () => {
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]);
    await expect(resolvePublicHost('safe.test')).rejects.toMatchObject({ code: 'RESEARCH_UNSAFE_URL' });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('pins the checked address to the HTTPS lookup function', async () => {
    respond(200, 'OK'); await download('https://safe.test');
    const options = mocks.request.mock.calls[0][1]; const callback = vi.fn();
    options.lookup('safe.test', { all: false }, callback);
    expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    expect(options.agent).toBe(false);
  });
  it('refuses a redirect into a loopback destination', async () => {
    respond(404, ''); respond(302, '', { location: 'https://127.0.0.1/secret' });
    await expect(readPage('https://safe.test/article')).rejects.toMatchObject({ code: 'RESEARCH_UNSAFE_URL' });
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
  it('does not read Facebook or unapproved domains automatically', async () => {
    expect(await readPage('https://www.facebook.com/groups/12')).toMatchObject({ status: 'requires_manual' });
    expect(await readPage('https://other.test/post')).toMatchObject({ errorCode: 'DOMAIN_NOT_ALLOWED' });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('reads arbitrary public sites by default while retaining DNS and robots checks', async () => {
    vi.stubEnv('RESEARCH_WEB_ALLOWED_DOMAINS', '');
    respond(404, ''); respond(200, `<article>${'Hotel operations discussion. '.repeat(10)}</article>`);
    expect(await readPage('https://public-hotel.test/post')).toMatchObject({ status: 'read' });
    expect(mocks.lookup).toHaveBeenCalledWith('public-hotel.test', { all: true });
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
  it('uses the organization search key rather than another organization or environment key', async () => {
    respond(200, JSON.stringify({ organic: [] }), { 'content-type': 'application/json' });
    await searchGoogle('hotel', 'org-secret');
    expect(mocks.request.mock.calls[0][1].headers['X-API-KEY']).toBe('org-secret');
  });
  it('respects robots exclusion without fetching the article', async () => {
    respond(200, 'User-agent: *\nDisallow: /private');
    expect(await readPage('https://safe.test/private')).toMatchObject({ errorCode: 'ROBOTS_DENIED' });
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it('does not promote HTTP errors or short snippets to evidence', async () => {
    respond(404, ''); respond(403, 'Log in');
    expect(await readPage('https://safe.test/private')).toMatchObject({ status: 'requires_manual' });
    respond(404, ''); respond(200, '<article>Too short</article>');
    expect(await readPage('https://safe.test/article')).toMatchObject({ status: 'snippet_only' });
  });
  it('limits downloaded bytes before storing content', async () => {
    respond(200, '1234567890');
    await expect(download('https://safe.test', { limit: 5 })).rejects.toMatchObject({ code: 'RESEARCH_PAGE_TOO_LARGE' });
  });
  it('searches Google through the fixed provider and never treats snippets as full evidence', async () => {
    respond(200, JSON.stringify({ organic: [{ link: 'https://safe.test/article', title: 'T', snippet: 'Not read' }, { link: 'http://invalid.test', title: 'invalid' }] }), { 'content-type': 'application/json' });
    expect(await searchGoogle('khó khăn khách sạn')).toEqual([{ url: 'https://safe.test/article', title: 'T' }]);
    expect(mocks.request.mock.calls[0][0].origin).toBe('https://google.serper.dev');
    expect(mocks.request.mock.calls[0][1].headers['X-API-KEY']).toBe('test-key');
  });
  it('reports rejected search credentials as a connection problem', async () => {
    respond(403, '{}', { 'content-type': 'application/json' });
    await expect(searchGoogle('hotel')).rejects.toMatchObject({ code: 'RESEARCH_SEARCH_AUTH_FAILED' });
  });
  it('reports missing search configuration without making a call', async () => {
    vi.stubEnv('RESEARCH_SERPER_API_KEY', '');
    await expect(searchGoogle('test')).rejects.toMatchObject({ code: 'RESEARCH_SEARCH_NOT_CONFIGURED' });
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
