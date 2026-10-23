// SPDX-License-Identifier: AGPL-3.0-or-later
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
// Deployment runner is plain ESM so it can run in the production image without tsx.
// @ts-expect-error deployment scripts intentionally have no TS declarations
import { deployResearchSchema } from '../../scripts/deploy-research-schema.mjs';
const databases: PGlite[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.close(); });
async function setup() {
  const db = new PGlite(); databases.push(db);
  await db.exec(`CREATE TABLE organizations(id TEXT PRIMARY KEY);
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE app_settings(id TEXT PRIMARY KEY);
    CREATE TABLE ai_audit_logs(id TEXT PRIMARY KEY);
    CREATE TABLE _prisma_migrations(id VARCHAR(36) PRIMARY KEY, checksum VARCHAR(64) NOT NULL,
      finished_at TIMESTAMPTZ, migration_name VARCHAR(255) NOT NULL, logs TEXT,
      rolled_back_at TIMESTAMPTZ, started_at TIMESTAMPTZ DEFAULT now(), applied_steps_count INT DEFAULT 0);`);
  // PGlite is a single-session test engine; lock ownership is verified by the real PG runner.
  return { db, client: { query: (sql: string, args?: unknown[]) => sql.includes('pg_advisory_xact_lock')
    ? Promise.resolve({ rows: [] })
    : args === undefined ? db.exec(sql).then((results) => results[results.length - 1] ?? { rows: [] }) : db.query(sql, args) } };
}
describe('research-only deployment runner', () => {
  it('checks without writing tables or migration records', async () => {
    const { db, client } = await setup();
    expect(await deployResearchSchema(client)).toMatchObject({ pending: ['20261023100000_customer_research', '20261023160000_research_hermes'], applied: false });
    expect((await db.query('SELECT * FROM _prisma_migrations')).rows).toHaveLength(0);
    expect((await db.query("SELECT tablename FROM pg_tables WHERE tablename='customer_research_projects'")).rows).toHaveLength(0);
  });
  it('applies exactly two migrations with checksums and remains idempotent', async () => {
    const { db, client } = await setup();
    expect((await deployResearchSchema(client, true)).pending).toHaveLength(2);
    expect((await deployResearchSchema(client, true)).pending).toHaveLength(0);
    const history = await db.query<{ checksum: string; applied_steps_count: number }>('SELECT checksum,applied_steps_count FROM _prisma_migrations');
    expect(history.rows).toHaveLength(2);
    expect(history.rows.every((r) => r.checksum.length === 64 && r.applied_steps_count === 1)).toBe(true);
    expect((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='customer_research_projects' AND column_name='executor'")).rows).toHaveLength(1);
  });
  it('refuses untracked or partially created research tables', async () => {
    const { db, client } = await setup();
    await db.exec('CREATE TABLE customer_research_projects(id TEXT PRIMARY KEY)');
    await expect(deployResearchSchema(client, true)).rejects.toThrow(/disagree/);
    expect((await db.query('SELECT * FROM _prisma_migrations')).rows).toHaveLength(0);
  });
  it('rolls back both DDL and migration metadata if the second migration fails', async () => {
    const { db, client } = await setup();
    const failing = { query: (sql: string, args?: unknown[]) => sql.includes('ADD COLUMN "executor"')
      ? Promise.reject(new Error('simulated deployment failure')) : client.query(sql, args) };
    await expect(deployResearchSchema(failing, true)).rejects.toThrow(/simulated deployment failure/);
    expect((await db.query('SELECT * FROM _prisma_migrations')).rows).toHaveLength(0);
    expect((await db.query("SELECT tablename FROM pg_tables WHERE tablename='customer_research_projects'")).rows).toHaveLength(0);
  });
  it('refuses checksum drift without changing schema or records', async () => {
    const { db, client } = await setup(); await deployResearchSchema(client, true);
    await db.query('UPDATE _prisma_migrations SET checksum=$1 WHERE migration_name=$2', ['0'.repeat(64), '20261023160000_research_hermes']);
    await expect(deployResearchSchema(client, true)).rejects.toThrow(/checksum differs/);
  });
  it('refuses unresolved failed migration history', async () => {
    const { db, client } = await setup();
    await db.query('INSERT INTO _prisma_migrations(id,checksum,migration_name) VALUES ($1,$2,$3)', ['failed', '0'.repeat(64), '20261023100000_customer_research']);
    await expect(deployResearchSchema(client, true)).rejects.toThrow(/failed migration/);
  });
});
