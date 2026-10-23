// SPDX-License-Identifier: AGPL-3.0-or-later
// Run only against the local running server. Creates and removes an isolated test organization.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const url = new URL(process.env.DATABASE_URL);
url.hostname = '127.0.0.1'; url.port = '5433';
const db = new Client({ connectionString: url.toString() });
const origin = 'http://127.0.0.1:5173';
const orgId = randomUUID(), userId = randomUUID(), key = randomUUID();
let token;
let checks = 0;
async function call(path, body, external = false, expected = 200, method) {
  const response = await fetch(origin + path, { method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', ...(external ? { 'X-API-Key': key } : { Authorization: `Bearer ${token}` }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`); checks++;
  return data;
}
const base = '/api/v1/ai/research', ext = '/api/public/research/hermes';
await db.connect();
try {
  await db.query('INSERT INTO organizations(id,name,updated_at) VALUES ($1,$2,now())', [orgId, '[TEST] Hermes isolated smoke']);
  await db.query('INSERT INTO users(id,org_id,email,password_hash,full_name,role,updated_at,password_changed_at) VALUES ($1,$2,$3,$4,$5,$6,now(),now())', [userId, orgId, `test-${userId}@example.invalid`, 'disabled-test-login', 'Hermes smoke test', 'owner']);
  await db.query('INSERT INTO app_settings(id,org_id,setting_key,value_plain,updated_at) VALUES ($1,$2,$3,$4,now())', [randomUUID(), orgId, 'public_api_key', key]);
  token = jwt.sign({ id: userId, orgId, role: 'owner', email: `test-${userId}@example.invalid`, typ: 'access', tv: 0 }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const project = await call(`${base}/projects`, { title: '[TEST] Hermes', brief: 'Dữ liệu giả lập kiểm tra vận hành khách sạn', executor: 'hermes', maxQueries: 2 });
  const path = `${base}/projects/${project.id}`;
  const start = (kind, extra = {}) => call(`${path}/tasks`, { kind, idempotencyKey: randomUUID(), ...extra }, false, 202);
  await start('discover');
  const discovery = (await call(`${ext}/claim`, {}, true)).task;
  assert.equal(discovery.kind, 'discover'); assert.equal(discovery.limits.maxSearches, 2);
  const quote = 'Nội dung giả lập: khách sạn thiếu khăn sạch khi khách nhận phòng cùng lúc.';
  const found = { leaseToken: discovery.leaseToken, result: { sources: [{ title: '[TEST] Synthetic evidence', url: 'https://example.invalid/hotel-test', content: quote, permissionConfirmed: true }] } };
  await call(`${ext}/tasks/${discovery.taskId}/progress`, { leaseToken: discovery.leaseToken, message: 'Đang kiểm thử nguồn giả lập' }, true);
  await call(`${ext}/tasks/${discovery.taskId}/complete`, found, true);
  assert.equal((await call(`${ext}/tasks/${discovery.taskId}/complete`, found, true)).duplicate, true);
  const source = (await call(`${path}/sources`)).sources[0];
  assert.equal(source.speakerRole, 'unknown'); assert.equal(source.content, quote);
  const analysisTask = await start('analyze');
  const analysis = (await call(`${ext}/claim`, {}, true)).task;
  assert.equal(analysis.taskId, analysisTask.taskId);
  const pain = { title: 'Thiếu khăn sạch', audience: 'Quản lý khách sạn', situation: 'Giờ nhận phòng', impact: 'Chưa xác minh', desire: 'Đủ khăn sạch', uncertainty: 'Dữ liệu giả lập, không dùng thật', relevance: 'direct', evidence: [{ sourceId: source.id, quote }] };
  await call(`${ext}/tasks/${analysis.taskId}/complete`, { leaseToken: analysis.leaseToken, result: { pains: [{ ...pain, evidence: [{ sourceId: source.id, quote: 'This quotation was fabricated and does not appear in the source.' }] }] } }, true, 502);
  assert.equal((await call(`${path}/pains`)).pains.length, 0);
  await call(`${ext}/tasks/${analysis.taskId}/complete`, { leaseToken: analysis.leaseToken, result: { pains: [pain] } }, true);
  const draftPain = (await call(`${path}/pains`)).pains[0];
  assert.equal(draftPain.status, 'draft');
  await call(`${path}/tasks`, { kind: 'generate', idempotencyKey: randomUUID(), painId: draftPain.id, format: 'zalo_message' }, false, 409);
  await call(`${path}/pains/${draftPain.id}`, { status: 'approved', revision: draftPain.revision }, false, 200, 'PATCH');
  await start('generate', { painId: draftPain.id, format: 'zalo_message' });
  const generation = (await call(`${ext}/claim`, {}, true)).task;
  await call(`${ext}/tasks/${generation.taskId}/complete`, { leaseToken: generation.leaseToken, result: { title: '[TEST] Bản nháp', body: 'Nội dung giả lập để kiểm thử.', sourceIds: [source.id], missingInformation: ['Chưa có dữ liệu thực tế'] } }, true);
  const content = (await call(`${path}/contents`)).contents[0];
  assert.equal(content.status, 'draft');
  await call(`${path}/contents/${content.id}/approve`, {});
  const cancellation = await start('analyze');
  const claimed = (await call(`${ext}/claim`, {}, true)).task;
  await call(`${path}/tasks/${cancellation.taskId}/cancel`, {});
  await call(`${ext}/tasks/${cancellation.taskId}/complete`, { leaseToken: claimed.leaseToken, result: { pains: [] } }, true, 409);
  const status = await call(`${base}/hermes-status`);
  assert.equal(status.recentlySeen, true);
  console.log(`PASS: ${checks} live HTTP checks: discover -> evidence -> analyze -> approve -> generate -> approve; replay/cancel/fabrication gates.`);
} finally {
  // Remove only rows belonging to the randomly generated test org, in dependency order.
  await db.query('DELETE FROM ai_audit_logs WHERE org_id=$1', [orgId]);
  await db.query('DELETE FROM customer_research_projects WHERE org_id=$1', [orgId]);
  await db.query('DELETE FROM app_settings WHERE org_id=$1', [orgId]);
  await db.query('DELETE FROM users WHERE org_id=$1', [orgId]);
  await db.query('DELETE FROM organizations WHERE id=$1', [orgId]);
  await db.end();
  console.log('Isolated test data removed. No paid provider or real customer contacted.');
}
