// SPDX-License-Identifier: AGPL-3.0-or-later
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
const db = new PGlite();
const migration = new URL('../../prisma/migrations/20261023100000_customer_research/migration.sql', import.meta.url);
beforeAll(async () => {
  await db.exec('CREATE TABLE organizations(id TEXT PRIMARY KEY); INSERT INTO organizations VALUES (\'org-a\'), (\'org-b\');');
  await db.exec(await readFile(migration, 'utf8'));
  await db.exec(await readFile(new URL('../../prisma/migrations/20261023160000_research_hermes/migration.sql', import.meta.url), 'utf8'));
  for (const [id, org] of [['project-a','org-a'], ['project-b','org-b']]) {
    await db.query('INSERT INTO customer_research_projects(id,org_id,title,brief,model_config_id,created_by_user_id,updated_at) VALUES ($1,$2,\'Study\',\'Hotel\',\'model\',\'owner\',now())', [id,org]);
  }
}, 30000);
afterAll(async () => { await db.close(); });
describe('research migration and database boundaries', () => {
  it('applies five tables, the composite foreign keys and tenant policies', async () => {
    const tables = await db.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE tablename LIKE 'customer_research_%'");
    expect(tables.rows).toHaveLength(5);
    const policies = await db.query('SELECT * FROM pg_policies WHERE tablename LIKE \'customer_research_%\'');
    expect(policies.rows).toHaveLength(5);
  });
  it('rejects cross-organization sources even with a valid project ID', async () => {
    await expect(db.query("INSERT INTO customer_research_sources(id,org_id,project_id,canonical_key,title,updated_at) VALUES ('foreign','org-b','project-a','key','Source',now())")).rejects.toThrow(/foreign key/i);
  });
  it('enforces source and task idempotency at the database level', async () => {
    await db.query("INSERT INTO customer_research_sources(id,org_id,project_id,canonical_key,title,updated_at) VALUES ('s1','org-a','project-a','key','Source',now())");
    await expect(db.query("INSERT INTO customer_research_sources(id,org_id,project_id,canonical_key,title,updated_at) VALUES ('s2','org-a','project-a','key','Repost',now())")).rejects.toThrow(/unique/i);
    await db.query("INSERT INTO customer_research_tasks(id,org_id,project_id,kind,idempotency_key,created_by_user_id) VALUES ('t1','org-a','project-a','analyze','key','owner')");
    await expect(db.query("INSERT INTO customer_research_tasks(id,org_id,project_id,kind,idempotency_key,created_by_user_id) VALUES ('t2','org-a','project-a','analyze','key','owner')")).rejects.toThrow(/unique/i);
  });
  it('rejects a content draft pointing to a pain in another project', async () => {
    await db.query("INSERT INTO customer_research_pains(id,org_id,project_id,task_id,title,detail,evidence,updated_at) VALUES ('p1','org-a','project-a','t1','Pain','{}','[]',now())");
    await expect(db.query("INSERT INTO customer_research_contents(id,org_id,project_id,pain_id,task_id,format,title,body,evidence,pain_revision) VALUES ('c1','org-b','project-b','p1','t1','article','Title','Body','[]',1)")).rejects.toThrow(/foreign key/i);
  });
  it('isolates reads/writes under the normal application role', async () => {
    await db.exec('CREATE ROLE research_app; GRANT USAGE ON SCHEMA public TO research_app; GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO research_app; SET ROLE research_app;');
    try {
      await db.query("SELECT set_config('app.current_org','org-a',false)");
      const rows = await db.query<{ org_id: string }>('SELECT org_id FROM customer_research_projects');
      expect(rows.rows).toEqual([{ org_id: 'org-a' }]);
      await expect(db.query("INSERT INTO customer_research_projects(id,org_id,title,brief,model_config_id,created_by_user_id,updated_at) VALUES ('wrong','org-b','T','B','M','U',now())")).rejects.toThrow(/row.level security/i);
    } finally { await db.exec('RESET ROLE'); }
  });
  it('cascades organization deletion through the research tree', async () => {
    await db.query("DELETE FROM organizations WHERE id='org-a'");
    expect((await db.query('SELECT id FROM customer_research_sources')).rows).toHaveLength(0);
    expect((await db.query('SELECT id FROM customer_research_pains')).rows).toHaveLength(0);
  });
  it('can roll back the isolated research tables without removing other tables', async () => {
    await db.exec(await readFile(new URL('../../prisma/migrations/20261023100000_customer_research/rollback.sql', import.meta.url), 'utf8'));
    expect((await db.query("SELECT tablename FROM pg_tables WHERE tablename LIKE 'customer_research_%'")).rows).toHaveLength(0);
    expect((await db.query("SELECT tablename FROM pg_tables WHERE tablename='organizations'")).rows).toHaveLength(1);
  });
});
