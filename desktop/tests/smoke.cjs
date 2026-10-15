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
    response.end('<!doctype html><title>CRM Test</title><h1>CRM test fixture</h1><input type="file" id="file" onclick="event.preventDefault()"><button id="child" onclick="window.open(location.origin + \'/attachment\')">Attachment</button>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let desktop;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const executablePath = process.env.ZALOCRM_DESKTOP_TEST_EXE;
    desktop = await _electron.launch({ ...(executablePath ? { executablePath } : {}), args: executablePath ? [] : [path.resolve(__dirname, '..')], env: { ...process.env,
      ZALOCRM_DESKTOP_URL: origin, ZALOCRM_DESKTOP_PROFILE: profile }, timeout: 60000 });
    let main;
    for (let i = 0; i < 100; i++) {
      main = desktop.windows().find((page) => page.url() === `${origin}/`);
      if (main) break;
      await new Promise((done) => setTimeout(done, 100));
    }
    assert.ok(main, 'CRM fixture window loaded');
    const visible = () => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'CRM Test' && w.webContents.getURL().includes('/desktop/chat'))?.isVisible() ?? false);
    async function expectVisibility(expected) {
      for (let i = 0; i < 40; i++) { if (await visible() === expected) return; await new Promise((done) => setTimeout(done, 100)); }
      console.log(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), focused: w.isFocused(), enabled: w.isEnabled(), visible: w.isVisible() }))));
      assert.equal(await visible(), expected);
    }
    const focusMain = () => desktop.evaluate(({ BrowserWindow }, currentOrigin) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === `${currentOrigin}/`).focus(), origin);
    assert.equal(await main.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await main.evaluate(() => window.zaloDesktop.role), 'main');
    assert.deepEqual(await main.evaluate(() => window.zaloDesktop.appInfo()), { version: '0.2.2', platform: process.platform, arch: process.arch });
    assert.equal(await main.evaluate(() => typeof window.zaloDesktop.installUpdate), 'function');
    assert.equal((await main.evaluate(() => window.zaloDesktop.installUpdate({}))).ok, false);
    await main.evaluate(() => window.zaloDesktop.notify({ id: 'before-login', convId: 'customer' }));
    assert.equal((await main.evaluate(() => window.zaloDesktop.state())).count, 0);
    await main.evaluate(() => window.zaloDesktop.setIdentity({ userId: 'tester', orgId: 'test-org' }));
    const toastEvent = desktop.waitForEvent('window');
    await main.evaluate(() => window.zaloDesktop.notify({ id: 'message-1', convId: 'customer', name: 'Khách thử nghiệm', context: 'Nick thử nghiệm', preview: 'Xin báo giá bộ chăn ga màu xanh.' }));
    await main.evaluate(() => window.zaloDesktop.notify({ id: 'message-1', convId: 'customer', name: 'duplicate' }));
    assert.equal((await main.evaluate(() => window.zaloDesktop.state())).count, 1);
    const bubble = desktop.windows().find((win) => win.url().endsWith('/bubble.html'));
    const toast = await toastEvent; await toast.waitForURL('**/preview.html');
    await bubble.waitForSelector('#badge:not([hidden])'); assert.equal(await bubble.locator('#badge').textContent(), '1');
    await toast.waitForFunction(() => document.getElementById('text').textContent.includes('Xin báo giá'));
    assert.equal(await toast.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await bubble.evaluate(() => typeof window.require), 'undefined');
    const resultDir = path.resolve(__dirname, '../test-results'); await fs.mkdir(resultDir, { recursive: true });
    await bubble.screenshot({ path: path.join(resultDir, 'bubble.png') }); await toast.screenshot({ path: path.join(resultDir, 'preview.png') });
    assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'ZaloCRM Bubble').isAlwaysOnTop()), true);
    // No production accounts, credentials or outbound messages are used.
    const popupEvent = desktop.waitForEvent('window'); await bubble.locator('#bubble').click();
    const popup = await popupEvent; await popup.waitForURL(`${origin}/desktop/chat/`);
    assert.equal(await popup.evaluate(() => window.zaloDesktop.role), 'chat');
    await popup.evaluate(() => window.zaloDesktop.notify({ id: 'forged-popup', convId: 'forged' }));
    assert.equal((await main.evaluate(() => window.zaloDesktop.state())).count, 1);
    await focusMain(); await expectVisibility(false);
    await bubble.locator('#bubble').click(); await expectVisibility(true);
    await popup.evaluate(() => window.zaloDesktop.setPinned(true));
    await focusMain(); await new Promise((done) => setTimeout(done, 350)); await expectVisibility(true);
    await popup.evaluate(() => window.zaloDesktop.setPinned(false)); await expectVisibility(false);
    await bubble.locator('#bubble').click(); await expectVisibility(true);
    // Dispatch a fixture file-input event, without opening a real native chooser.
    await popup.evaluate(() => { const input = document.getElementById('file'); input.disabled = true; input.dispatchEvent(new Event('click', { bubbles: true })); });
    await focusMain(); await new Promise((done) => setTimeout(done, 350)); await expectVisibility(true);
    await popup.evaluate(() => document.getElementById('file').dispatchEvent(new Event('cancel'))); await focusMain(); await expectVisibility(false);
    await bubble.locator('#bubble').click(); await expectVisibility(true);
    const childEvent = desktop.waitForEvent('window'); await popup.locator('#child').click();
    const child = await childEvent; await child.waitForURL(`${origin}/attachment`);
    assert.equal(await child.evaluate(() => typeof window.zaloDesktop), 'undefined');
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/attachment')).focus());
    await new Promise((done) => setTimeout(done, 350)); await expectVisibility(true);
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/attachment')).close());
    await popup.evaluate(() => window.zaloDesktop.dismiss('customer'));
    assert.equal((await main.evaluate(() => window.zaloDesktop.state())).count, 0);
    const state = await main.evaluate(() => window.zaloDesktop.state());
    assert.equal(await main.evaluate((revision) => window.zaloDesktop.syncUnread([{ convId: 'history', count: 17 }], revision), state.revision), true);
    assert.equal((await main.evaluate(() => window.zaloDesktop.state())).count, 17);
    await main.evaluate(() => window.zaloDesktop.setIdentity(null));
    assert.equal((await main.evaluate(() => window.zaloDesktop.state())).count, 0);
    assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'ZaloCRM Bubble').isVisible()), false);
    console.log('Desktop smoke passed: preview, inbox-default, auto-hide, pin, picker hold, attachment child, badge restore, role checks and logout.');
  } finally {
    if (desktop) await desktop.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
