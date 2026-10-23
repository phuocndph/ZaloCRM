// SPDX-License-Identifier: AGPL-3.0-or-later
// Applies ONLY the two customer research migrations; never runs unrelated pending migrations.
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const names = ['20261023100000_customer_research', '20261023160000_research_hermes'];
const tables = ['customer_research_projects', 'customer_research_sources', 'customer_research_pains', 'customer_research_contents', 'customer_research_tasks'];
export async function deployResearchSchema(client, apply = false) {
  const migrations = await Promise.all(names.map(async (name) => {
    const sql = await readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('zcrm-customer-research-schema-v1'))");
    const core = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('organizations','users','app_settings','ai_audit_logs','_prisma_migrations')");
    if (core.rows.length !== 5) throw new Error('Existing ZCRM core schema/migration history is missing. Stop and check the deployment target.');
    const records = await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = ANY($1::text[])', [names]);
    const present = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1::text[])", [tables]);
    const column = await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customer_research_projects' AND column_name='executor'");
    const done = new Set();
    for (const migration of migrations) {
      const rows = records.rows.filter((r) => r.migration_name === migration.name && !r.rolled_back_at);
      if (rows.some((r) => !r.finished_at)) throw new Error(`Unresolved failed migration: ${migration.name}. Stop; do not mark it applied automatically.`);
      if (rows.some((r) => r.checksum !== migration.checksum)) throw new Error(`Migration checksum differs: ${migration.name}. Stop and compare versions.`);
      if (rows.some((r) => r.finished_at)) done.add(migration.name);
    }
    if (done.has(names[0]) ? present.rows.length !== 5 : present.rows.length > 0) {
      throw new Error('Research tables and Prisma migration records disagree. Stop; manual reconciliation is required. No data was changed.');
    }
    if (done.has(names[1]) !== (column.rows.length === 1)) throw new Error('Hermes executor column and migration history disagree. Stop for reconciliation.');
    if (done.has(names[1]) && !done.has(names[0])) throw new Error('Research migration dependency is inconsistent.');
    const pending = migrations.filter((m) => !done.has(m.name));
    console.log('Research migrations pending:', pending.map((m) => m.name).join(', ') || 'none');
    if (apply) {
      for (const migration of pending) {
        await client.query(migration.sql);
        await client.query('INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES ($1,$2,now(),$3,now(),1)', [randomUUID(), migration.checksum, migration.name]);
        console.log('Applied:', migration.name);
      }
      await client.query('COMMIT');
    } else await client.query('ROLLBACK');
    return { pending: pending.map((m) => m.name), applied: apply };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apply = process.argv.includes('--apply');
  if (process.argv.slice(2).some((x) => !['--check', '--apply'].includes(x))) throw new Error('Use --check or --apply');
  if (apply && process.env.RESEARCH_DB_BACKUP_CONFIRMED !== '1') throw new Error('Make a database backup first, then set RESEARCH_DB_BACKUP_CONFIRMED=1 for this command.');
  const { Client } = await import('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try { await deployResearchSchema(client, apply); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { await client.end(); }
}
