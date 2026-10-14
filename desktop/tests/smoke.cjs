const { _electron } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

async function run() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'zalocrm-desktop-smoke-'));
  const server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><title>CRM Test</title><h1>CRM test fixture</h1>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let desktop;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    desktop = await _electron.launch({ args: [path.resolve(__dirname, '..')], env: { ...process.env,
      ZALOCRM_DESKTOP_URL: origin, ZALOCRM_DESKTOP_PROFILE: profile }, timeout: 60000 });
    const main = await desktop.firstWindow();
    await main.waitForURL(`${origin}/`);
    assert.equal(await main.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await main.evaluate(() => window.zaloDesktop.role), 'main');
    await main.evaluate(() => window.zaloDesktop.notify({ id: 'before-login', convId: 'customer' }));
    assert.equal((await main.evaluate(() => window.zaloDesktop.state())).count, 0);
    await main.evaluate(() => window.zaloDesktop.setIdentity({ userId: 'tester', orgId: 'test-org' }));
    await main.evaluate(() => window.zaloDesktop.notify({ id: 'message-1', convId: 'customer', name: 'Khách thử nghiệm', context: 'Nick thử nghiệm' }));
    await main.evaluate(() => window.zaloDesktop.notify({ id: 'message-1', convId: 'customer', name: 'duplicate' }));
    assert.equal((await main.evaluate(() => window.zaloDesktop.state())).count, 1);
    const bubble = desktop.windows().find((win) => win.url().startsWith('file:'));
    await bubble.waitForSelector('#badge:not([hidden])');
    assert.equal(await bubble.locator('#badge').textContent(), '1');
    assert.equal(await bubble.evaluate(() => typeof window.require), 'undefined');
    await fs.mkdir(path.resolve(__dirname, '../test-results'), { recursive: true });
    await bubble.screenshot({ path: path.resolve(__dirname, '../test-results/bubble.png') });
    assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'ZaloCRM Bubble').isAlwaysOnTop()), true);
    // Synthetic fixture only: no production CRM data, credentials or outbound messages.
    const popupEvent = desktop.waitForEvent('window');
    await bubble.locator('#bubble').click();
    const popup = await popupEvent;
    await popup.waitForURL(`${origin}/desktop/chat/customer`);
    assert.equal(await popup.evaluate(() => window.zaloDesktop.role), 'chat');
    await popup.evaluate(() => window.zaloDesktop.notify({ id: 'forged-popup', convId: 'forged' }));
    assert.equal((await main.evaluate(() => window.zaloDesktop.state())).count, 1);
    await popup.evaluate(() => window.zaloDesktop.dismiss('customer'));
    assert.equal((await main.evaluate(() => window.zaloDesktop.state())).count, 0);
    await main.evaluate(() => window.zaloDesktop.notify({ id: 'message-2', convId: 'customer' }));
    await main.evaluate(() => window.zaloDesktop.setIdentity(null));
    assert.equal((await main.evaluate(() => window.zaloDesktop.state())).count, 0);
    assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'ZaloCRM Bubble').isVisible()), false);
    console.log('Desktop smoke passed: isolated preload, badge, floating window, compact chat, role checks, logout cleanup.');
  } finally {
    if (desktop) await desktop.close();
    await new Promise((resolve) => server.close(resolve));
    // Keep the isolated test profile for diagnostics; never touch the user's CRM profile.
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
