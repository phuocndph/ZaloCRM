const { _electron, chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const sharp = require('../../backend/node_modules/sharp');

async function run() {
  const root = path.resolve(__dirname, '../../frontend/dist');
  const resultDir = path.resolve(__dirname, '../test-results');
  const pixels = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 240, 200, 0, 100, 50, 230, 0, 230, 230]);
  const png = await sharp(pixels, { raw: { width: 3, height: 2, channels: 3 } }).png().toBuffer();
  const jpeg = await sharp(png).jpeg().toBuffer();
  const nick = { id: 'nick', displayName: 'Nick kiem thu', status: 'connected', privacyMode: 'sub', ownerUserId: 'tester' };
  const conversation = { id: 'copy-fixture', threadType: 'user', externalThreadId: 'synthetic', isPrivate: false,
    contact: { id: 'customer', fullName: 'Khach kiem thu', avatarUrl: '/files/source.png' }, zaloAccount: nick,
    unreadCount: 0, lastMessageAt: new Date().toISOString(), messages: [], userState: { flags: {} } };
  const messages = [
    { id: 'image-single', contentType: 'image', content: JSON.stringify({ href: '/files/source.jpg' }) },
    ...[0, 1].map((index) => ({ id: `album-${index}`, contentType: 'image', albumKey: 'test-album', albumIndex: index, albumTotal: 2,
      content: JSON.stringify({ href: '/files/source.png' }) })),
  ].map((message, index) => ({ ...message, senderType: 'contact', senderName: 'Khach kiem thu', sentAt: new Date(Date.now() + index * 1000).toISOString() }));
  const writes = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname.startsWith('/socket.io')) { response.writeHead(503); response.end(); return; }
    if (url.pathname.startsWith('/files/')) {
      response.setHeader('Content-Type', url.pathname.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
      response.end(url.pathname.endsWith('.jpg') ? jpeg : png); return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET') writes.push(url.pathname);
      let value = [];
      if (url.pathname.endsWith('/profile')) value = { id: 'tester', orgId: 'org', role: 'owner', fullName: 'Test', passwordChangedAt: '2026-10-01', grants: {}, org: { name: 'Fixture' } };
      else if (url.pathname.endsWith('/setup/status')) value = { needsSetup: false };
      else if (url.pathname.endsWith('/privacy/status')) value = { isUnlocked: false, activeSessions: [], activeSessionCount: 0 };
      else if (url.pathname.endsWith('/zalo-accounts')) value = [nick];
      else if (url.pathname.endsWith('/conversations')) value = { conversations: [conversation], total: 1, hasMore: false };
      else if (url.pathname.endsWith('/conversations/copy-fixture')) value = conversation;
      else if (url.pathname.endsWith('/messages')) value = { messages, hasMore: false };
      else if (url.pathname.endsWith('/pinned')) value = { items: [] };
      else if (url.pathname.endsWith('/ai/config')) value = { enabled: false };
      else if (url.pathname.endsWith('/state')) value = { flags: {} };
      else if (url.pathname.endsWith('/message-notifications')) value = { notifications: [], unreadCount: 0 };
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); return;
    }
    let file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep)) file = path.join(root, 'index.html');
    try { if (!(await fs.stat(file)).isFile()) file = path.join(root, 'index.html'); } catch { file = path.join(root, 'index.html'); }
    response.setHeader('Content-Type', { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream');
    response.end(await fs.readFile(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await fs.mkdir(resultDir, { recursive: true });
  let desktop, browser, clipboardSnapshot;
  try {
    console.log('Launching isolated Electron copy test');
    desktop = await _electron.launch({ args: [path.resolve(__dirname, '..')], env: { ...process.env, ZALOCRM_DESKTOP_URL: origin,
      ZALOCRM_DESKTOP_PROFILE: await fs.mkdtemp(path.join(os.tmpdir(), 'zcrm-copy-fixture-')) }, timeout: 60000 });
    console.log('Saving clipboard formats');
    clipboardSnapshot = await desktop.evaluate(async ({ clipboard, ClipboardItem }) => {
      const items = await clipboard.read();
      globalThis.__copyTestSnapshot = await Promise.all(items.map(async (item) => new ClipboardItem(
        Object.fromEntries(await Promise.all(item.types.map(async (type) => [type, await item.getType(type)]))),
      )));
      return true;
    });
    console.log('Launching Edge copy test');
    browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 30000 });
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    for (const platform of ['windows', 'web']) {
      let page;
      if (platform === 'windows') {
        for (let attempt = 0; attempt < 100; attempt++) {
          page = desktop.windows().find((candidate) => candidate.url().startsWith(origin));
          if (page) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.ok(page, 'Main CRM window exists');
      } else page = await context.newPage();
      page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(40000);
      console.log(`${platform}: opening fixture login`);
      await page.addInitScript(() => {
        if (!navigator.clipboard?.write) return;
        const write = navigator.clipboard.write.bind(navigator.clipboard);
        navigator.clipboard.write = async (...args) => {
          try { await write(...args); window.__copyResult = 'ok'; }
          catch (error) { window.__copyResult = `${error.name}: ${error.message}`; throw error; }
        };
      });
      await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => localStorage.setItem('token', 'synthetic-copy-fixture'));
      const errors = []; page.on('pageerror', (error) => errors.push(error.message));
      for (const compact of [false, true]) {
        if (platform === 'web') await page.setViewportSize(compact ? { width: 440, height: 720 } : { width: 1440, height: 900 });
        await page.goto(`${origin}/${compact ? 'desktop/chat' : 'chat'}/copy-fixture`, { waitUntil: 'domcontentloaded' });
        console.log(`${platform}/${compact ? 'compact' : 'full'}: loading image fixture`);
        const image = page.locator('.chat-image').first();
        await image.waitFor(); await image.evaluate((node) => node.decode());
        await desktop.evaluate(({ clipboard }) => clipboard.writeText('zcrm-copy-test'));
        await image.click({ button: 'right' });
        console.log('Context menu:', await page.locator('.ctx-menu').allTextContents());
        await page.getByRole('menuitem', { name: 'Sao chép ảnh', exact: true }).click();
        await assertCopiedImage(page, desktop, platform);
        await image.click();
        const lightbox = page.locator('.lightbox-wrap'); await lightbox.waitFor();
        await desktop.evaluate(({ clipboard }) => clipboard.writeText('zcrm-copy-test'));
        await lightbox.getByRole('button', { name: 'Sao chép ảnh', exact: true }).click();
        await assertCopiedImage(page, desktop, platform);
        await page.screenshot({ path: path.join(resultDir, `image-copy-${platform}-${compact ? 'compact' : 'full'}.png`), animations: 'disabled' });
        await page.keyboard.press('Escape');
        await lightbox.waitFor({ state: 'hidden' });
        const tile = page.locator('.album-tile').first(); await tile.waitFor();
        await tile.click({ button: 'right' });
        await desktop.evaluate(({ clipboard }) => clipboard.writeText('zcrm-copy-test'));
        await page.getByRole('button', { name: 'Sao chép ảnh này', exact: true }).click();
        await assertCopiedImage(page, desktop, platform);
        console.log(`${platform}/${compact ? 'compact' : 'full'}: native PNG clipboard verified after single-image, lightbox and album copy`);
      }
      assert.deepEqual(errors, [], `${platform}: no browser runtime errors`);
    }
    assert.ok(!writes.some((url) => /\/(messages|attachments)$/.test(url)), 'Copy never sends or uploads customer messages');
  } catch (error) {
    console.error('Copy fixture failed:', error.message);
    if (desktop) for (const page of desktop.windows()) console.log('Window state:', page.url(), (await page.locator('body').innerText({ timeout: 2000 }).catch(() => '')).slice(-1800));
    if (desktop) for (const [index, page] of desktop.windows().entries()) await page.screenshot({ path: path.join(resultDir, `image-copy-failure-${index}.png`), timeout: 5000 }).catch(() => {});
    throw error;
  } finally {
    if (clipboardSnapshot && desktop) await desktop.evaluate(async ({ clipboard }) => {
      await clipboard.write(globalThis.__copyTestSnapshot);
    }).catch(() => {});
    if (browser) await browser.close();
    if (desktop) await desktop.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
async function assertCopiedImage(page, desktop, platform) {
  console.log('Clipboard check', platform);
  const size = platform === 'web' ? await page.evaluate(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const items = await navigator.clipboard.read();
      const item = items.find((item) => item.types.includes('image/png'));
      if (item) {
        const bitmap = await createImageBitmap(await item.getType('image/png'));
        const size = { width: bitmap.width, height: bitmap.height }; bitmap.close(); return size;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { width: 0, height: 0 };
  }) : await desktop.evaluate(async ({ clipboard, nativeImage }) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const items = await clipboard.read();
      const item = items.find((item) => item.types.includes('image/png'));
      if (item) {
        const blob = await item.getType('image/png');
        return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())).getSize();
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { width: 0, height: 0 };
  });
  const result = await page.evaluate(() => window.__copyResult);
  console.log('Native write result:', result);
  assert.deepEqual(size, { width: 3, height: 2 }, `${platform}: clipboard contains raster pixels, not a copied URL (${result})`);
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
