// SPDX-License-Identifier: AGPL-3.0-or-later
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
const db = new PGlite();
beforeAll(async () => { await db.exec("CREATE TABLE organizations(id TEXT PRIMARY KEY); INSERT INTO organizations VALUES ('a'),('b');"); await db.exec(await readFile(new URL('../../prisma/migrations/20261029100000_joliefam_commerce/migration.sql', import.meta.url), 'utf8')); }, 30000);
afterAll(() => db.close());
describe('Commerce migration', () => {
  it('creates six tenant-isolated tables', async () => { expect((await db.query("SELECT * FROM pg_policies WHERE tablename LIKE 'joliefam_%'")).rows).toHaveLength(6); });
  it('enforces draft create/request idempotency', async () => { await db.exec("INSERT INTO joliefam_drafts(id,org_id,contact_id,created_by,create_key,input,request_key,updated_at) VALUES ('d','a','c','u','create','{}','request',now())"); await expect(db.exec("INSERT INTO joliefam_drafts(id,org_id,contact_id,created_by,create_key,input,request_key,updated_at) VALUES ('d2','a','c','u','other','{}','request',now())")).rejects.toThrow(/unique/i); });
  it('rejects invalid status and revision', async () => { await expect(db.exec("UPDATE joliefam_drafts SET status='approved' WHERE id='d'")).rejects.toThrow(/check/i); await expect(db.exec("UPDATE joliefam_drafts SET revision=0 WHERE id='d'")).rejects.toThrow(/check/i); });
  it('supports multiple contacts per hotel and multiple hotels per contact', async () => { await db.exec("INSERT INTO joliefam_customer_links(id,org_id,contact_id,customer_id,customer_name,confirmed_by) VALUES ('l1','a','c1','hotel','A','u'),('l2','a','c2','hotel','A','u'),('l3','a','c1','hotel2','B','u')"); expect((await db.query('SELECT id FROM joliefam_customer_links')).rows).toHaveLength(3); });
  it('isolates both cached reads and writes by organization under the application role', async () => { await db.exec("CREATE ROLE commerce_app; GRANT USAGE ON SCHEMA public TO commerce_app; GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO commerce_app; SET ROLE commerce_app;"); try { await db.query("SELECT set_config('app.current_org','b',false)"); expect((await db.query('SELECT * FROM joliefam_drafts')).rows).toHaveLength(0); await expect(db.exec("INSERT INTO joliefam_audit(id,org_id,actor_id,action,entity_id) VALUES ('x','a','u','read','c')")).rejects.toThrow(/row.level security/i); } finally { await db.exec('RESET ROLE'); } });
});
