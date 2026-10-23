// SPDX-License-Identifier: AGPL-3.0-or-later
// Read-only, conversation-scoped inspection. Does not load Zalo sessions or send.
import { Client } from 'pg';
import { access } from 'node:fs/promises';
import path from 'node:path';

const conversationId = process.argv[2];
const since = process.argv[3] ? new Date(process.argv[3]) : new Date(Date.now() - 24 * 60 * 60_000);
if (!conversationId || !/^[a-f0-9-]{36}$/i.test(conversationId) || !Number.isFinite(since.getTime())) {
  console.error('Usage: node scripts/diagnose-image-delivery.mjs CONVERSATION_ID [SINCE_ISO]'); process.exit(1);
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required in the server environment.'); process.exit(1); }
const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  await db.connect(); await db.query('BEGIN READ ONLY'); await db.query("SET LOCAL statement_timeout = '5s'");
  const conversation = await db.query('SELECT id FROM conversations WHERE id=$1', [conversationId]);
  if (!conversation.rowCount) { console.log(JSON.stringify({ found: false, conversationId, message: 'Conversation is absent from this database. Check the server target.' }, null, 2)); }
  else {
    const rows = await db.query(`SELECT id, sent_at, content_type, delivery_state, zalo_msg_id, zalo_cli_msg_id,
      delivery_lease_until, metadata->>'failReason' AS reason, metadata->'outboundAttachment' AS attachment
      FROM messages WHERE conversation_id=$1 AND sender_type='self' AND content_type IN ('image','file','video')
      AND sent_at >= $2 ORDER BY sent_at DESC LIMIT 50`, [conversationId, since]);
    const messages = [];
    const root = path.resolve(process.env.CHAT_OUTBOX_DIR || '/var/lib/zalo-crm/chat-outbox');
    for (const row of rows.rows) {
      const job = row.attachment; let sourcePresent = null;
      if (job && /^[a-f0-9-]{36}$/i.test(job.sourceId || '') && typeof job.filename === 'string' && job.filename.length > 0 && path.basename(job.filename) === job.filename && !/[\\/:\x00-\x1f]/.test(job.filename) && !['.', '..'].includes(job.filename)) {
        try { await access(path.join(root, job.sourceId, job.filename)); sourcePresent = true; } catch { sourcePresent = false; }
      }
      messages.push({ id: row.id, sentAt: row.sent_at, kind: row.content_type, state: row.delivery_state,
        confirmedZaloId: row.zalo_msg_id, exactClientId: row.zalo_cli_msg_id, leaseUntil: row.delivery_lease_until,
        filename: job?.filename ?? null, attachmentStatus: job?.status ?? null, sourcePresent, reason: row.reason });
    }
    console.log(JSON.stringify({ found: true, conversationId, since, messages }, null, 2));
  }
  await db.query('ROLLBACK');
} catch (error) { console.error('Read-only diagnosis failed:', error.code ?? error.name); process.exitCode = 1; }
finally { await db.end(); }
