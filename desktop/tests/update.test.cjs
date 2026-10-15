const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { downloadVerifiedInstaller } = require('../src/update.cjs');

test('downloads an installer to a temporary file and verifies its hash', async () => {
  const body = Buffer.from('fixture installer bytes');
  const sha256 = createHash('sha256').update(body).digest('hex');
  const server = http.createServer((_request, response) => {
    response.setHeader('Content-Length', String(body.length));
    response.end(body);
  });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'zalocrm-updater-'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/v1/desktop/releases/0.2.2/download`;
    const events = [];
    const installer = await downloadVerifiedInstaller({ version: '0.2.2', bytes: body.length, sha256, url }, temporary, (event) => events.push(event));
    assert.deepEqual(await fs.readFile(installer), body);
    assert.ok(events.some((event) => event.phase === 'verified'));
    await fs.rm(installer, { force: true });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test('removes a failed download when checksum verification fails', async () => {
  const body = Buffer.from('wrong checksum');
  const server = http.createServer((_request, response) => response.end(body));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'zalocrm-updater-'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/v1/desktop/releases/0.2.2/download`;
    await assert.rejects(downloadVerifiedInstaller({ version: '0.2.2', bytes: body.length, sha256: '0'.repeat(64), url }, temporary));
    assert.deepEqual(await fs.readdir(temporary), []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
