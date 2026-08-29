import { prisma } from '../dist/shared/database/prisma-client.js';
import { decryptToken } from '../dist/modules/integrations/_shared/token-encryption.util.js';

try {
  const user = await prisma.user.findFirst({ where: { role: { in: ['owner', 'admin'] }, isActive: true }, orderBy: { createdAt: 'asc' }, select: { orgId: true } });
  const setting = await prisma.appSetting.findUnique({ where: { orgId_settingKey: { orgId: user.orgId, settingKey: 'ai_f5quota_api_key' } }, select: { valueEncrypted: true, valuePlain: true } });
  const key = setting?.valueEncrypted ? decryptToken(Buffer.from(setting.valueEncrypted).toString('utf8')) : setting?.valuePlain || '';
  const url = 'https://f5quota.store/v1/chat/completions';
  const payloads = {
    plain: { model: 'gpt-5.4', messages: [{ role: 'user', content: 'Reply with OK only.' }], max_completion_tokens: 16, stream: false },
    jsonSchema: { model: 'gpt-5.4', messages: [{ role: 'user', content: 'Return JSON with reply.' }], max_completion_tokens: 64, response_format: { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema: { type: 'object', required: ['reply'], properties: { reply: { type: 'string' } } } } }, stream: false },
    jsonObject: { model: 'gpt-5.4', messages: [{ role: 'user', content: 'Return JSON with reply.' }], max_completion_tokens: 64, response_format: { type: 'json_object' }, stream: false },
  };
  for (const [name, payload] of Object.entries(payloads)) {
    const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const text = await response.text();
    process.stdout.write(JSON.stringify({ name, status: response.status, body: text.slice(0, 500).replace(/\s+/g, ' ') }) + '\n');
  }
} finally { await prisma.$disconnect(); }
