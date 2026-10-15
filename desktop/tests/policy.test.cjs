const { test } = require('node:test');
const assert = require('node:assert/strict');
const { crmOrigin, sameOrigin, desktopRelease, notification, clampBounds, adjacentBounds, shouldAutoHide, ConversationQueue } = require('../src/policy.cjs');
test('defaults to Joliefam and rejects unsafe or credential-bearing origins', () => {
  assert.equal(crmOrigin(), 'https://zcrm.joliefam.vn');
  assert.equal(crmOrigin('http://127.0.0.1:3080'), 'http://127.0.0.1:3080');
  for (const url of ['http://example.com', 'file:///tmp', 'https://user:secret@example.com', 'https://example.com/chat', 'https://example.com?x=1']) assert.throws(() => crmOrigin(url));
});
test('origin validation is exact, not a hostname suffix match', () => {
  assert.ok(sameOrigin('https://zcrm.joliefam.vn/chat', crmOrigin()));
  assert.ok(!sameOrigin('https://zcrm.joliefam.vn.evil.com/', crmOrigin()));
  assert.ok(!sameOrigin('https://user@zcrm.joliefam.vn/', crmOrigin()));
  assert.ok(!sameOrigin('blob:https://zcrm.joliefam.vn/customer-file', crmOrigin()));
});
test('native updater accepts only a newer release from the exact CRM origin', () => {
  const origin = crmOrigin();
  const value = { version: '0.2.2', platform: 'win32', arch: 'x64', filename: 'ZaloCRM-Setup-0.2.2.exe', bytes: 123,
    sha256: 'a'.repeat(64), downloadUrl: '/api/v1/desktop/releases/0.2.2/download' };
  assert.deepEqual(desktopRelease(value, origin, '0.2.1'), {
    version: value.version, filename: value.filename, bytes: value.bytes, sha256: value.sha256, url: `${origin}${value.downloadUrl}`,
  });
  assert.equal(desktopRelease({ ...value, version: '0.2.1', downloadUrl: '/api/v1/desktop/releases/0.2.1/download' }, origin, '0.2.1'), null);
  assert.equal(desktopRelease({ ...value, filename: '../update.exe' }, origin, '0.2.1'), null);
  assert.equal(desktopRelease({ ...value, downloadUrl: 'https://zcrm.joliefam.vn.evil.test/api/v1/desktop/releases/0.2.2/download' }, origin, '0.2.1'), null);
  assert.equal(desktopRelease({ ...value, downloadUrl: `${value.downloadUrl}?redirect=evil` }, origin, '0.2.1'), null);
});
test('previews bounded, avatar protocols validated and credential fields discarded', () => {
  const value = notification({ id: 'msg', convId: 'conv', name: 'A'.repeat(1000), preview: 'secret', token: 'secret', avatarUrl: 'file:///secret' });
  assert.equal(value.name.length, 120); assert.equal(value.preview, 'secret'); assert.equal(value.token, undefined); assert.equal(value.avatarUrl, null);
  assert.equal(notification({ id: 'msg', convId: '../private' }), null);
  assert.equal(notification({}), null);
});
test('redacted previews cannot carry names, text or avatar URLs', () => {
  const value = notification({ id: 'msg', convId: 'conv', name: 'Secret name', preview: 'Secret body', redacted: true, avatarUrl: 'https://example.com/a.png' });
  assert.equal(value.name, 'Tin nhắn mới'); assert.equal(value.preview, 'Bạn có tin nhắn mới'); assert.equal(value.avatarUrl, null);
});
test('no notifications before login, deduplication and account-switch cleanup', () => {
  const queue = new ConversationQueue(); const msg = { id: 'msg', convId: 'conv' };
  assert.equal(queue.add(msg), false);
  queue.setOwner({}); assert.equal(queue.owner, null);
  queue.setOwner({ userId: 'user', orgId: 'org' }); assert.ok(queue.add(msg)); assert.equal(queue.add(msg), false);
  queue.add({ ...msg, id: 'next' }); assert.equal(queue.snapshot().count, 2);
  queue.setOwner({ userId: 'other', orgId: 'org' }); assert.equal(queue.snapshot().count, 0);
  queue.setOwner(null); assert.equal(queue.add(msg), false);
});
test('bounded queue, dismiss and reset', () => {
  const queue = new ConversationQueue(); queue.setOwner({ userId: 'user', orgId: 'org' });
  for (let i = 0; i < 105; i++) queue.add({ id: `msg-${i}`, convId: `conv-${i}` });
  assert.equal(queue.snapshot().items.length, 100); assert.equal(queue.snapshot().count, 105); queue.remove('conv-104'); assert.equal(queue.snapshot().items.length, 99);
  queue.clear(); assert.equal(queue.snapshot().count, 0);
});
test('restores authoritative unread counts without replaying notifications and rejects stale scans', () => {
  const queue = new ConversationQueue(); queue.setOwner({ userId: 'user', orgId: 'org' });
  const before = queue.revision;
  queue.add({ id: 'msg', convId: 'conv' });
  assert.equal(queue.syncUnread([], before), false); assert.equal(queue.snapshot().count, 1);
  assert.ok(queue.syncUnread([{ convId: 'history', count: 42 }, { convId: 'conv', count: 5 }], queue.revision));
  assert.equal(queue.snapshot().count, 47); assert.equal(queue.snapshot().items.length, 1);
  assert.equal(queue.syncUnread([{ convId: 'evil', count: -1 }], queue.revision), false);
});
test('auto-hide ignores pin, dialogs, picker and focused attachments', () => {
  const input = { pinned: false, focused: false, childFocused: false, dialogOpen: false, holding: false };
  assert.ok(shouldAutoHide(input));
  for (const key of Object.keys(input)) assert.equal(shouldAutoHide({ ...input, [key]: true }), false);
});
test('chat and preview fit laptop and secondary-monitor work areas', () => {
  const work = { x: -1280, y: 0, width: 1280, height: 680 };
  const result = adjacentBounds({ x: -90, y: 560, width: 76, height: 76 }, work, 540, 740);
  assert.ok(result.x >= work.x); assert.ok(result.x + result.width <= 0); assert.equal(result.height, 680); assert.equal(result.y, 0);
});
test('bubble position stays inside the work area including negative monitor coordinates', () => {
  assert.deepEqual(clampBounds({ x: 200, y: -999 }, { x: -1920, y: 0, width: 1920, height: 1040 }, 76, 76), { x: -76, y: 0, width: 76, height: 76 });
});
