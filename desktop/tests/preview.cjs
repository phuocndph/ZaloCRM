const { _electron } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

async function run() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'zalocrm-preview-'));
  const resultDir = path.resolve(__dirname, '../test-results');
  await fs.mkdir(resultDir, { recursive: true });
  const image = await fs.readFile(path.resolve(__dirname, '../../frontend/public/brand/hs-monogram.png'));
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    requests.push(url.pathname);
    if (url.pathname.startsWith('/avatar/')) {
      if (url.pathname.endsWith('missing.png')) { response.writeHead(404); response.end(); return; }
      if (url.pathname.endsWith('invalid.png')) { response.setHeader('Content-Type', 'image/png'); response.end('invalid image'); return; }
      const send = () => { response.setHeader('Content-Type', 'image/png'); response.setHeader('Cache-Control', 'public, max-age=3600'); response.end(image); };
      if (url.pathname.endsWith('slow.png')) { setTimeout(send, 3100); return; }
      send(); return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><title>Preview Fixture</title><h1>Local fixture</h1>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let desktop;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const executablePath = process.env.ZALOCRM_DESKTOP_TEST_EXE;
    desktop = await _electron.launch({ ...(executablePath ? { executablePath } : {}), args: executablePath ? [] : [path.resolve(__dirname, '..')],
      env: { ...process.env, ZALOCRM_DESKTOP_URL: origin, ZALOCRM_DESKTOP_PROFILE: profile }, timeout: 60000 });
    let main;
    for (let i = 0; i < 100; i++) { main = desktop.windows().find((page) => page.url() === `${origin}/`); if (main) break; await new Promise((resolve) => setTimeout(resolve, 100)); }
    assert.ok(main);
    await main.evaluate(() => window.zaloDesktop.setIdentity({ userId: 'tester', orgId: 'fixture' }));
    const send = (value) => main.evaluate((notification) => window.zaloDesktop.notify(notification), value);
    const event = desktop.waitForEvent('window');
    await send({ id: 'first', convId: 'customer', name: 'Nguyễn Minh Anh', context: 'Nick tư vấn Joliefam', preview: 'Cho chị xin báo giá bộ chăn ga màu xanh và thời gian giao hàng nhé.', avatarUrl: '/avatar/missing.png', avatarUrls: ['/avatar/missing.png', '/avatar/customer.png'] });
    const toast = await event; await toast.waitForURL('**/preview.html');
    const errors = []; toast.on('pageerror', (error) => errors.push(error.message));
    await toast.evaluate(() => window.preview.hover(true));
    await toast.waitForFunction(() => { const image = document.querySelector('.avatar'); return image && !image.hidden && image.complete && image.naturalWidth > 0 && image.src.endsWith('/avatar/customer.png'); });
    assert.ok(requests.includes('/avatar/missing.png') && requests.includes('/avatar/customer.png'), 'Broken primary avatar falls back to the next customer image');
    assert.equal(await toast.locator('.notification-count').isVisible(), false, 'No redundant badge on the first message');
    assert.equal(await toast.locator('.notification').first().boundingBox().then((box) => box.height), 108);
    assert.ok((await toast.evaluate(() => innerHeight)) < 130, 'Single notification window is compact');
    const firstImageRequests = requests.filter((value) => value === '/avatar/customer.png').length;
    await send({ id: 'second', convId: 'customer', name: 'Nguyễn Minh Anh', context: 'Nick tư vấn Joliefam', preview: 'Chị muốn nhận hàng vào cuối tuần này.', avatarUrl: '/avatar/missing.png', avatarUrls: ['/avatar/missing.png', '/avatar/customer.png'] });
    await toast.waitForSelector('[aria-label="2 tin mới"]');
    assert.equal(requests.filter((value) => value === '/avatar/customer.png').length, firstImageRequests, 'Message updates do not recreate/refetch a loaded avatar');
    await send({ id: 'group', convId: 'group', name: 'Đại lý Miền Nam - Khách hàng thân thiết', context: 'Nick chăm sóc đại lý', senderName: 'Chị Lan', preview: 'Gửi giúp chị danh sách mẫu mới và giá sỉ để chị kiểm tra tồn kho trước khi đặt hàng.', avatarUrl: '/avatar/group.png' });
    await toast.waitForFunction(() => document.querySelectorAll('.notification').length === 2 && [...document.querySelectorAll('.avatar')].every((image) => image.complete && image.naturalWidth > 0));
    assert.ok(await toast.locator('.notification').first().locator('.sender').textContent().then((text) => text.includes('Chị Lan')));
    await assertFits(toast);
    await toast.screenshot({ path: path.join(resultDir, 'preview-compact-avatars.png') });
    await send({ id: 'slow', convId: 'retry', name: 'Trần Ngọc Lan', context: 'Nick tư vấn', preview: 'Kiểm tra ảnh tải chậm', avatarUrl: '/avatar/slow.png', avatarUrls: ['/avatar/slow.png', '/avatar/retry.png'] });
    await toast.waitForFunction(() => { const image = document.querySelector('.notification .avatar'); return image && !image.hidden && image.src.endsWith('/avatar/retry.png') && image.naturalWidth > 0; });
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.ok((await toast.locator('.notification').first().locator('.avatar').getAttribute('src')).endsWith('/avatar/retry.png'), 'Late primary load cannot overwrite a successful fallback');
    await send({ id: 'all-broken', convId: 'retry', name: 'Trần Ngọc Lan', context: 'Nick tư vấn', preview: '<img src=x onerror=alert(1)>', avatarUrl: '/avatar/invalid.png' });
    await toast.waitForFunction(() => document.querySelector('.notification .avatar').hidden);
    assert.equal(await toast.locator('.notification').first().locator('.avatar-initials').textContent(), 'TL', 'Initials replace an unavailable customer avatar, not the ZaloCRM logo');
    assert.ok(await toast.locator('.notification').first().locator('.preview-text').textContent().then((value) => value.includes('<img')));
    await send({ id: 'private', convId: 'private', name: 'Secret', context: 'Secret nick', preview: 'Secret body', redacted: true, avatarUrl: '/avatar/private.png', avatarUrls: ['/avatar/private-fallback.png'] });
    await toast.waitForFunction(() => document.querySelector('.notification .name').textContent === 'Tin nhắn mới');
    assert.ok(!requests.some((value) => value.startsWith('/avatar/private')), 'Private notifications never request avatars');
    assert.ok(!(await toast.locator('body').textContent()).includes('Secret'));
    await assertFits(toast);
    await toast.screenshot({ path: path.join(resultDir, 'preview-compact-three.png') });
    const count = (await main.evaluate(() => window.zaloDesktop.state())).count;
    await toast.getByRole('button', { name: 'Ẩn thông báo Tin nhắn mới', exact: true }).click();
    assert.equal((await main.evaluate(() => window.zaloDesktop.state())).count, count, 'Hiding a preview does not mark messages read');
    await send({ id: 'click', convId: 'target', name: 'Khách mở nhanh', context: 'Nick tư vấn', preview: 'Mở đúng hội thoại', avatarUrl: '/avatar/customer.png' });
    const chatEvent = desktop.waitForEvent('window');
    await toast.getByRole('button', { name: 'Mở hội thoại Khách mở nhanh', exact: true }).click();
    const chat = await chatEvent; await chat.waitForURL(`${origin}/desktop/chat/target`);
    assert.deepEqual(errors, []);
    console.log('Preview passed: compact 108px cards, real image loading, broken/slow fallback, no avatar flicker, initials, private-image suppression, 3-card fit, safe text, close/read isolation and exact-conversation click.');
  } finally {
    if (desktop) await desktop.close(); await new Promise((resolve) => server.close(resolve));
  }
}
async function assertFits(page) {
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.notification, .name, .context, .preview-text, .close')].filter((node) => {
    const rect = node.getBoundingClientRect(); return rect.left < 0 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1;
  }).map((node) => node.className)), [], 'Cards and controls fit inside the actual notification window');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
