// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Seed and upgrade the default system permission groups.
 *
 * Every operation is idempotent. Existing explicit values are preserved; an
 * upgrade only adds missing defaults according to the rules below.
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { DEFAULT_PERMISSION_GROUPS, type GrantsJson } from './permission-types.js';

export interface SeedResult {
  created: number;
  existing: number;
  updated: number;
  groups: Array<{ id: string; name: string; isSystem: boolean }>;
}

type PermissionGroupSeedDb = Pick<typeof prisma, 'permissionGroup'>;
type PermissionGroupBackfillDb = Pick<typeof prisma, 'organization' | 'permissionGroup'>;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Merge defaults without removing or overwriting an explicitly persisted value.
 *
 * System Admin is special: it is the break-glass group and must receive actions
 * introduced by an upgrade even when the resource key already existed. An
 * explicit `false` is customization and is therefore preserved. Other system
 * groups only receive entirely new resource keys from their own template; this
 * prevents an upgrade from silently widening their permissions.
 */
export function mergeDefaultSystemGrants(
  currentValue: unknown,
  template: GrantsJson,
  options: { mergeMissingActions: boolean },
): { grants: GrantsJson; changed: boolean } {
  const current = isJsonObject(currentValue) ? currentValue : {};
  const merged: Record<string, unknown> = { ...current };
  let changed = false;

  for (const [resource, templateActionsValue] of Object.entries(template)) {
    if (!isJsonObject(templateActionsValue)) continue;

    if (!hasOwn(current, resource)) {
      merged[resource] = { ...templateActionsValue };
      changed = true;
      continue;
    }

    if (!options.mergeMissingActions) continue;

    const currentActionsValue = current[resource];
    const currentActions = isJsonObject(currentActionsValue) ? currentActionsValue : {};
    const mergedActions: Record<string, unknown> = { ...currentActions };
    let resourceChanged = !isJsonObject(currentActionsValue);

    for (const [action, enabled] of Object.entries(templateActionsValue)) {
      if (!hasOwn(currentActions, action)) {
        mergedActions[action] = enabled;
        resourceChanged = true;
      }
    }

    if (resourceChanged) {
      merged[resource] = mergedActions;
      changed = true;
    }
  }

  return { grants: merged as GrantsJson, changed };
}

export async function seedDefaultPermissionGroups(
  orgId: string,
  db: PermissionGroupSeedDb = prisma,
): Promise<SeedResult> {
  const result: SeedResult = { created: 0, existing: 0, updated: 0, groups: [] };

  for (const tmpl of DEFAULT_PERMISSION_GROUPS) {
    const existing = await db.permissionGroup.findFirst({
      where: { orgId, name: tmpl.name, isSystem: true },
      select: { id: true, name: true, isSystem: true, grants: true },
    });

    if (existing) {
      const { grants, changed } = mergeDefaultSystemGrants(
        existing.grants,
        tmpl.grants as GrantsJson,
        { mergeMissingActions: tmpl.name === 'Admin' },
      );
      if (changed) {
        await db.permissionGroup.update({
          where: { id: existing.id },
          data: { grants: grants as object },
        });
        result.updated++;
      }
      result.existing++;
      result.groups.push({ id: existing.id, name: existing.name, isSystem: existing.isSystem });
      continue;
    }

    const created = await db.permissionGroup.create({
      data: {
        id: randomUUID(),
        orgId,
        name: tmpl.name,
        isSystem: tmpl.isSystem,
        grants: tmpl.grants as object,
      },
      select: { id: true, name: true, isSystem: true },
    });
    result.created++;
    result.groups.push(created);
  }

  return result;
}

export interface BackfillPermissionGroupsResult {
  organizations: number;
  created: number;
  existing: number;
  updated: number;
  failed: Array<{ orgId: string; error: string }>;
}

async function seedOrganizationWithUpgradeLock(
  orgId: string,
  db: PermissionGroupBackfillDb,
): Promise<SeedResult> {
  if (db !== prisma) return seedDefaultPermissionGroups(orgId, db);

  // Multiple app replicas may bootstrap simultaneously. A transaction-scoped
  // PostgreSQL advisory lock serializes the read/create sequence per org even
  // though the legacy permission_groups table has no matching unique index.
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      // PostgreSQL returns `void` for pg_advisory_xact_lock. Prisma 7 cannot
      // deserialize a raw `void` column, so cast the otherwise-unused result
      // to a supported scalar while keeping the transaction-scoped lock.
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`zalocrm:rbac-defaults:${orgId}`}))::text AS lock_result`,
    );
    return seedDefaultPermissionGroups(orgId, tx as PermissionGroupSeedDb);
  }, { maxWait: 15_000, timeout: 60_000 });
}
/**
 * Upgrade every existing organization in bounded batches. Safe to run at each
 * bootstrap: the seed is idempotent and only writes when a key/action is absent.
 */
export async function backfillDefaultPermissionGroupsForAllOrganizations(options: {
  db?: PermissionGroupBackfillDb;
  batchSize?: number;
} = {}): Promise<BackfillPermissionGroupsResult> {
  const db = options.db ?? prisma;
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 100, 500));
  const result: BackfillPermissionGroupsResult = {
    organizations: 0,
    created: 0,
    existing: 0,
    updated: 0,
    failed: [],
  };
  let cursor: string | undefined;

  while (true) {
    const organizations = await db.organization.findMany({
      select: { id: true },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (organizations.length === 0) break;

    for (const organization of organizations) {
      result.organizations++;
      try {
        const seeded = await seedOrganizationWithUpgradeLock(organization.id, db);
        result.created += seeded.created;
        result.existing += seeded.existing;
        result.updated += seeded.updated;
      } catch (error) {
        result.failed.push({
          orgId: organization.id,
          error: error instanceof Error ? error.message : 'unknown_error',
        });
      }
    }

    cursor = organizations[organizations.length - 1]?.id;
    if (!cursor || organizations.length < batchSize) break;
  }

  return result;
}

/** Map legacy users.role to the default permission group. */
export async function migrateLegacyUsersToPermissionGroups(orgId: string): Promise<{
  ownerCount: number;
  adminCount: number;
  memberCount: number;
}> {
  const [adminGrp, ceoGrp, saleGrp] = await Promise.all([
    prisma.permissionGroup.findFirst({ where: { orgId, name: 'Admin', isSystem: true }, select: { id: true } }),
    prisma.permissionGroup.findFirst({ where: { orgId, name: 'CEO', isSystem: true }, select: { id: true } }),
    prisma.permissionGroup.findFirst({ where: { orgId, name: 'Sale', isSystem: true }, select: { id: true } }),
  ]);
  if (!adminGrp || !ceoGrp || !saleGrp) {
    throw new Error('Default groups chưa seed — chạy seedDefaultPermissionGroups() trước');
  }

  const [ownerRes, adminRes, memberRes] = await Promise.all([
    prisma.user.updateMany({
      where: { orgId, role: 'owner', permissionGroupId: null },
      data: { permissionGroupId: adminGrp.id },
    }),
    prisma.user.updateMany({
      where: { orgId, role: 'admin', permissionGroupId: null },
      data: { permissionGroupId: ceoGrp.id },
    }),
    prisma.user.updateMany({
      where: { orgId, role: 'member', permissionGroupId: null },
      data: { permissionGroupId: saleGrp.id },
    }),
  ]);

  return {
    ownerCount: ownerRes.count,
    adminCount: adminRes.count,
    memberCount: memberRes.count,
  };
}
