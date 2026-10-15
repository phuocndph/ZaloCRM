const { _electron } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../frontend/dist');
const resultDir = path.resolve(__dirname, '../test-results');
const nick = { id: 'nick-a', displayName: 'Nick tư vấn', status: 'connected', privacyMode: 'sub', ownerUserId: 'tester' };
const contact = { id: 'contact-a', fullName: 'Khách thử nghiệm', crmName: 'Nguyễn An', avatarUrl: '/pwa-192x192.png', hasZalo: true };
const rows = Array.from({ length: 65 }, (_, index) => ({ id: `conv-${index}`, threadType: 'user', contact: { ...contact, id: `contact-${index}`, crmName: index ? `Khách hàng ${index}` : 'Nguyễn An' },
  zaloAccount: nick, externalThreadId: `thread-${index}`, lastMessageAt: new Date(Date.now() - index * 60000).toISOString(), unreadCount: index < 3 ? 2 : 0, isReplied: true,
  messages: [{ id: `msg-${index}`, content: index ? 'Mình muốn xem thêm mẫu và bảng giá mới.' : 'Cho mình xin báo giá bộ chăn ga màu xanh nhé.', contentType: 'text', senderType: 'contact' }], userState: { flags: {} } }));
const history = [{ id: 'message-a', content: 'Chào bạn, mình đang tìm bộ chăn ga cho phòng ngủ.', contentType: 'text', senderType: 'contact', senderName: 'Nguyễn An', sentAt: new Date(Date.now() - 120000).toISOString() },
  { id: 'message-b', content: 'Cho mình xin báo giá bộ chăn ga màu xanh nhé.', contentType: 'text', senderType: 'contact', senderName: 'Nguyễn An', sentAt: new Date().toISOString() }];

async function run() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'zalocrm-desktop-ui-'));
  const writes = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname.startsWith('/socket.io')) { response.writeHead(503); response.end(); return; }
    if (url.pathname.startsWith('/api/')) {
      response.setHeader('Content-Type', 'application/json');
      if (!['GET', 'HEAD'].includes(request.method)) writes.push(url.pathname);
      let data = {};
      if (url.pathname.endsWith('/profile')) data = { id: 'tester', orgId: 'test-org', role: 'owner', fullName: 'Nhân viên thử nghiệm', passwordChangedAt: '2026-10-01', org: { name: 'CRM thử nghiệm' }, grants: {} };
      else if (url.pathname.endsWith('/setup/status')) data = { needsSetup: false };
      else if (url.pathname.endsWith('/privacy/status')) data = { isUnlocked: false };
      else if (url.pathname.endsWith('/zalo-accounts')) data = [nick];
      else if (url.pathname.endsWith('/conversations')) {
        let filtered = rows.filter((row) => (!url.searchParams.get('unread') || row.unreadCount > 0) && (!url.searchParams.get('search') || row.contact.crmName.toLowerCase().includes(url.searchParams.get('search').toLowerCase())));
        const start = Number(url.searchParams.get('cursor') || 0), limit = Number(url.searchParams.get('limit') || 50);
        data = { conversations: filtered.slice(start, start + limit), hasMore: start + limit < filtered.length, nextCursor: String(start + limit) };
      } else if (/\/conversations\/conv-\d+$/.test(url.pathname)) data = rows.find((row) => row.id === url.pathname.split('/').at(-1));
      else if (/\/conversations\/conv-\d+\/messages$/.test(url.pathname)) {
        if (request.method !== 'GET') { response.writeHead(403); response.end(JSON.stringify({ error: 'No test sends' })); return; }
        data = { messages: history, hasMore: false };
      } else if (url.pathname.endsWith('/pinned')) data = { items: [] };
      else if (url.pathname.endsWith('/message-notifications')) data = { notifications: [], unreadCount: 0 };
      else if (url.pathname.includes('/ai/config')) data = { enabled: false };
      response.end(JSON.stringify(data)); return;
    }
    let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep)) file = path.join(root, 'index.html');
    try { if (!(await fs.stat(file)).isFile()) file = path.join(root, 'index.html'); } catch { file = path.join(root, 'index.html'); }
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream'); response.end(await fs.readFile(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let desktop;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    desktop = await _electron.launch({ args: [path.resolve(__dirname, '..')], env: { ...process.env, ZALOCRM_DESKTOP_URL: origin, ZALOCRM_DESKTOP_PROFILE: profile }, timeout: 60000 });
    let main;
    for (let i = 0; i < 100; i++) { main = desktop.windows().find((page) => page.url().startsWith(origin)); if (main) break; await new Promise((done) => setTimeout(done, 100)); }
    assert.ok(main);
    await main.evaluate(() => { localStorage.setItem('token', 'synthetic-ui-fixture'); });
    await main.goto(`${origin}/desktop/chat/`);
    await main.waitForSelector('.inbox-row');
    const bubble = desktop.windows().find((page) => page.url().endsWith('/bubble.html'));
    await bubble.waitForSelector('#bubble');
    const popupEvent = desktop.waitForEvent('window'); await bubble.locator('#bubble').click(); const popup = await popupEvent;
    const errors = []; popup.on('pageerror', (error) => errors.push(error.message));
    await popup.waitForSelector('.inbox-row');
    assert.equal(await popup.locator('.inbox-row').count(), 50);
    await popup.locator('.inbox-rows').evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await popup.waitForFunction(() => document.querySelectorAll('.inbox-row').length === 65);
    await popup.locator('.inbox-rows').evaluate((node) => { node.scrollTop = 0; });
    await fs.mkdir(resultDir, { recursive: true }); await popup.screenshot({ path: path.join(resultDir, 'inbox-laptop.png') });
    await popup.locator('.inbox-row').first().click(); await popup.waitForSelector('.message-thread');
    await popup.screenshot({ path: path.join(resultDir, 'chat-laptop.png') });
    await popup.getByRole('button', { name: 'Danh sách hội thoại', exact: true }).click();
    assert.equal(await popup.locator('.inbox-row').count(), 65);
    await popup.getByRole('searchbox', { name: 'Tìm hội thoại' }).fill('Nguyễn An');
    await popup.waitForFunction(() => document.querySelectorAll('.inbox-row').length === 1);
    await popup.getByRole('searchbox', { name: 'Tìm hội thoại' }).fill('');
    await popup.waitForFunction(() => document.querySelectorAll('.inbox-row').length === 50);
    await popup.getByRole('tab', { name: 'Chưa đọc', exact: true }).click();
    await popup.waitForFunction(() => document.querySelectorAll('.inbox-row').length === 3);
    await popup.getByRole('tab', { name: 'Tất cả', exact: true }).click();
    await popup.waitForFunction(() => document.querySelectorAll('.inbox-row').length === 50);
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/desktop/chat') && w.getBounds().width < 900).setSize(1060, 740));
    await popup.locator('.inbox-row').first().click(); await popup.waitForSelector('.message-thread');
    await popup.screenshot({ path: path.join(resultDir, 'chat-wide.png') });
    const viewport = await popup.evaluate(() => ({ width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth }));
    assert.ok(viewport.scroll <= viewport.width + 1, 'No horizontal overflow');
    assert.ok(!writes.some((url) => /\/messages$/.test(url)), 'No outbound messages');
    assert.deepEqual(errors, []);
    console.log('Desktop UI passed: 65 server conversations, pagination, search, unread filter, chat/back, laptop and wide layouts; no outbound messages.');
  } finally {
    if (desktop) await desktop.close(); await new Promise((resolve) => server.close(resolve));
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
