const { test } = require('node:test');
const assert = require('node:assert/strict');
const { crmOrigin, sameOrigin, notification, clampBounds, ConversationQueue } = require('../src/policy.cjs');
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
test('bubble stores no message body, avatar URL or credentials', () => {
  const value = notification({ id: 'msg', convId: 'conv', name: 'A'.repeat(1000), preview: 'secret', token: 'secret', avatarUrl: 'file:///secret' });
  assert.equal(value.name.length, 120); assert.equal(value.preview, undefined); assert.equal(value.token, undefined); assert.equal(value.avatarUrl, undefined);
  assert.equal(notification({ id: 'msg', convId: '../private' }), null);
  assert.equal(notification({}), null);
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
  assert.equal(queue.snapshot().items.length, 100); queue.remove('conv-104'); assert.equal(queue.snapshot().items.length, 99);
  queue.clear(); assert.equal(queue.snapshot().count, 0);
});
test('bubble position stays inside the work area including negative monitor coordinates', () => {
  assert.deepEqual(clampBounds({ x: 200, y: -999 }, { x: -1920, y: 0, width: 1920, height: 1040 }, 76, 76), { x: -76, y: 0, width: 76, height: 76 });
});
