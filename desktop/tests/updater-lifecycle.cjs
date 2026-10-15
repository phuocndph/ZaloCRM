const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function run() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'zalocrm-update-lifecycle-'));
  const server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html'); response.end('<title>Updater fixture</title>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let desktop;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const executablePath = process.env.ZALOCRM_DESKTOP_TEST_EXE;
    desktop = await _electron.launch({ ...(executablePath ? { executablePath } : {}), args: executablePath ? [] : [path.resolve(__dirname, '..')],
      env: { ...process.env, ZALOCRM_DESKTOP_URL: origin, ZALOCRM_DESKTOP_PROFILE: profile }, timeout: 60000 });
    let main;
    for (let index = 0; index < 300; index++) {
      main = desktop.windows().find((page) => page.url() === `${origin}/`);
      if (main) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(main);
    await desktop.evaluate(({ dialog, shell }) => {
      global.updateFixture = { downloads: 0, confirmations: 0, launches: 0, finishDownload: null };
      dialog.showMessageBox = async () => { global.updateFixture.confirmations++; return { response: 1 }; };
      // A synthetic installer must never be executed, even if this test regresses.
      shell.openPath = async () => { global.updateFixture.launches++; return 'Fixture execution blocked'; };
      const body = Buffer.from('Synthetic installer, not executable');
      const digest = process.getBuiltinModule('crypto').createHash('sha256').update(body).digest('hex');
      global.fetch = async (url) => {
        if (String(url).includes('api.github.com')) return new Response(JSON.stringify({ tag_name: 'v9.0.0', assets: [{
          name: 'ZaloCRM-Setup-9.0.0.exe', state: 'uploaded', size: body.length, digest: `sha256:${digest}`,
          browser_download_url: 'https://github.com/phuocndph/ZaloCRM/releases/download/v9.0.0/ZaloCRM-Setup-9.0.0.exe',
        }] }));
        global.updateFixture.downloads++;
        return new Response(new ReadableStream({ start(controller) {
          global.updateFixture.finishDownload = () => { controller.enqueue(body); controller.close(); };
        } }), { headers: { 'Content-Length': String(body.length) } });
      };
    });
    const opening = desktop.waitForEvent('window'); await main.evaluate(() => window.zaloDesktop.openUpdater());
    const updater = await opening; await updater.waitForURL('**/updater.html');
    await updater.waitForFunction(() => !document.getElementById('install').disabled);
    await updater.evaluate(() => { window.pendingInstallation = window.desktopUpdater.install(); });
    await updater.waitForFunction(() => document.getElementById('status').textContent.includes('0%'));
    const hidden = await desktop.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().endsWith('/updater.html'));
      window.close(); return { destroyed: window.isDestroyed(), visible: !window.isDestroyed() && window.isVisible() };
    });
    assert.deepEqual(hidden, { destroyed: false, visible: false });
    await main.evaluate(() => window.zaloDesktop.openUpdater());
    assert.equal(await updater.evaluate(() => typeof window.desktopUpdater.install), 'function');
    await desktop.evaluate(() => global.updateFixture.finishDownload());
    const result = await updater.evaluate(() => window.pendingInstallation);
    assert.deepEqual(result, { ok: false, cancelled: true });
    assert.equal((await updater.evaluate(() => window.desktopUpdater.state())).phase, 'cancelled');
    assert.deepEqual(await desktop.evaluate(() => ({ downloads: global.updateFixture.downloads,
      confirmations: global.updateFixture.confirmations, launches: global.updateFixture.launches })), { downloads: 1, confirmations: 1, launches: 0 });
    await updater.close();
    console.log('Updater lifecycle passed: close/reopen during download keeps the same transfer and reaches confirmation; no installer executed.');
  } finally {
    if (desktop) await desktop.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
