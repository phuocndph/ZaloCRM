const { _electron, chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../frontend/dist');
const resultDir = path.resolve(__dirname, '../test-results');
async function run() {
  const audio = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'aac', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1']);
  const image = await fs.readFile(path.resolve(__dirname, '../../frontend/public/pwa-192x192.png'));
  const nick = { id: 'nick', displayName: 'Nick tư vấn', status: 'connected', privacyMode: 'sub', ownerUserId: 'tester' };
  const rows = ['An', 'Bình', 'Lan'].map((name, index) => ({ id: `conv-${index}`, threadType: 'user', externalThreadId: `customer-${index}`, isPrivate: false,
    contact: { id: `contact-${index}`, fullName: name, crmName: name, avatarUrl: index === 2 ? '/broken-contact.png' : '/avatar.png' },
    friendship: { id: `friend-${index}`, zaloAvatarUrl: '/broken-friend.png', friendshipStatus: 'accepted', relationshipKind: 'friend' },
    zaloAccount: nick, unreadCount: 0, lastMessageAt: new Date().toISOString(), messages: [], userState: { flags: {} } }));
  const history = [{ id: 'voice', senderType: 'contact', senderName: 'An', contentType: 'voice', sentAt: new Date().toISOString(),
    content: JSON.stringify({ title: '', thumb: '', href: '/voice.aac', params: JSON.stringify({ fileSize: audio.length, duration: 2000, m4a: '/voice.m4a' }) }) }];
  const writes = [], downloads = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname.startsWith('/socket.io')) { response.writeHead(503); response.end(); return; }
    if (url.pathname.startsWith('/broken-')) { response.writeHead(404); response.end(); return; }
    if (url.pathname === '/avatar.png') { response.setHeader('Content-Type', 'image/png'); response.end(image); return; }
    if (['/voice.aac', '/voice.m4a'].includes(url.pathname)) {
      response.setHeader('Content-Type', 'audio/mp4'); response.setHeader('Accept-Ranges', 'bytes');
      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
      if (range) response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${audio.length}`, 'Content-Length': end - start + 1 });
      response.end(audio.subarray(start, end + 1)); return;
    }
    if (url.pathname.startsWith('/api/')) {
      response.setHeader('Content-Type', 'application/json');
      if (request.method !== 'GET') writes.push(url.pathname);
      let data = [];
      if (url.pathname.endsWith('/profile')) data = { id: 'tester', orgId: 'org', role: 'owner', fullName: 'Test', passwordChangedAt: '2026-10-01', grants: {}, org: { name: 'Fixture' } };
      else if (url.pathname.endsWith('/setup/status')) data = { needsSetup: false };
      else if (url.pathname.endsWith('/privacy/status')) data = { isUnlocked: false, activeSessions: [], activeSessionCount: 0 };
      else if (url.pathname.endsWith('/zalo-accounts')) data = [nick];
      else if (url.pathname.endsWith('/conversations')) data = { conversations: rows, total: rows.length, hasMore: false };
      else if (/\/conversations\/conv-\d$/.test(url.pathname)) data = rows.find((row) => row.id === url.pathname.split('/').at(-1));
      else if (url.pathname.endsWith('/messages')) data = { messages: history, hasMore: false };
      else if (url.pathname.endsWith('/pinned')) data = { items: [] };
      else if (url.pathname.endsWith('/ai/config')) data = { enabled: false };
      else if (url.pathname.endsWith('/state')) data = { flags: {} };
      else if (url.pathname.endsWith('/message-notifications')) data = { notifications: [], unreadCount: 0 };
      else if (url.pathname.endsWith('/media/download')) { downloads.push(url.searchParams.get('url')); response.setHeader('Content-Type', 'audio/mp4'); response.end(audio); return; }
      response.end(JSON.stringify(data)); return;
    }
    let file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep)) file = path.join(root, 'index.html');
    try { if (!(await fs.stat(file)).isFile()) file = path.join(root, 'index.html'); } catch { file = path.join(root, 'index.html'); }
    response.setHeader('Content-Type', { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream'); response.end(await fs.readFile(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await fs.mkdir(resultDir, { recursive: true });
  try {
    for (const platform of ['windows', 'web']) {
      let desktop, browser;
      try {
        let page;
        if (platform === 'windows') {
          desktop = await _electron.launch({ args: [path.resolve(__dirname, '..')], env: { ...process.env, ZALOCRM_DESKTOP_URL: origin, ZALOCRM_DESKTOP_PROFILE: await fs.mkdtemp(path.join(os.tmpdir(), 'zcrm-media-ui-')) }, timeout: 60000 });
          for (let i = 0; i < 100; i++) { page = desktop.windows().find((candidate) => candidate.url().startsWith(origin)); if (page) break; await new Promise((resolve) => setTimeout(resolve, 100)); }
        } else { browser = await chromium.launch({ channel: 'msedge', headless: true }); page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); await page.goto(`${origin}/login`); }
        const errors = []; page.on('pageerror', (error) => errors.push(error.stack || error.message));
        await page.evaluate(() => localStorage.setItem('token', 'synthetic-media-test'));
        await page.goto(`${origin}/desktop/chat`); await page.waitForSelector('.inbox-row');
        await page.waitForFunction(() => { const image = document.querySelector('.inbox-row .av-img'); return image && image.complete && image.naturalWidth > 0 && image.src.endsWith('/avatar.png'); });
        await page.waitForSelector('.inbox-row:last-child .av-initials');
        assert.ok(await page.locator('.inbox-row:last-child .av-initials').isVisible(), `${platform}: broken avatars never leave an invisible hole`);
        await page.locator('.inbox-row').first().click(); await page.waitForSelector('.voice-player audio', { state: 'attached' });
        assert.equal(await page.locator('.file-card').count(), 0, `${platform}: recording is not a generic file card`);
        await testPlayback(page, platform);
        const before = downloads.length;
        const downloaded = page.waitForResponse((response) => response.url().includes('/media/download') && response.status() === 200);
        await page.getByRole('button', { name: 'Tải ghi âm', exact: true }).click(); await downloaded;
        assert.equal(downloads.length, before + 1); assert.equal(downloads.at(-1), '/voice.aac');
        await page.screenshot({ path: path.join(resultDir, `chat-media-${platform}-compact.png`), animations: 'disabled' });
        await page.goto(`${origin}/chat/conv-0`); await page.waitForSelector('.voice-player audio', { state: 'attached' });
        await testPlayback(page, `${platform} full chat`);
        await page.screenshot({ path: path.join(resultDir, `chat-media-${platform}-full.png`), animations: 'disabled' });
        assert.deepEqual(errors, [], `${platform}: no runtime exceptions`);
      } finally { if (desktop) await desktop.close(); if (browser) await browser.close(); }
    }
    assert.ok(!writes.some((url) => /\/messages$/.test(url)), 'No outbound customer messages');
    console.log('Chat media passed in Windows Electron and Edge web: broken avatar fallback, initials, actual AAC/MP4 decoding, playback progress, seek, pause, download and full/compact chat; no customer messages sent.');
  } finally { await new Promise((resolve) => server.close(resolve)); }
}
async function testPlayback(page, label) {
  const audio = page.locator('.voice-player audio').first(); await audio.evaluate((node) => { node.muted = true; });
  await page.waitForFunction(() => document.querySelector('.voice-player audio')?.readyState >= 1);
  await page.getByRole('button', { name: 'Phát ghi âm', exact: true }).first().click();
  await page.waitForFunction(() => document.querySelector('.voice-player audio')?.currentTime > .1);
  await page.getByRole('slider', { name: 'Tua ghi âm', exact: true }).first().evaluate((node) => { node.value = '1'; node.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.ok(await audio.evaluate((node) => node.currentTime >= .9), `${label}: seeks successfully`);
  await page.getByRole('button', { name: 'Tạm dừng ghi âm', exact: true }).first().click();
  assert.ok(await audio.evaluate((node) => node.paused), `${label}: pauses successfully`);
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
