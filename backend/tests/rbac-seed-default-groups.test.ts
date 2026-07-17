import { describe, expect, it } from 'vitest';
import {
  backfillDefaultPermissionGroupsForAllOrganizations,
  mergeDefaultSystemGrants,
  seedDefaultPermissionGroups,
} from '../src/modules/rbac/seed-default-groups.js';
import { DEFAULT_PERMISSION_GROUPS, type GrantsJson } from '../src/modules/rbac/permission-types.js';

interface StoredGroup {
  id: string;
  orgId: string;
  name: string;
  isSystem: boolean;
  grants: GrantsJson;
}

function createMemoryDb(orgIds: string[], initialGroups: StoredGroup[]) {
  const groups = initialGroups.map((group) => ({ ...group, grants: structuredClone(group.grants) }));

  const db = {
    organization: {
      async findMany(args: any) {
        const ordered = [...orgIds].sort();
        const start = args.cursor ? ordered.indexOf(args.cursor.id) + (args.skip ?? 0) : 0;
        return ordered.slice(start, start + args.take).map((id) => ({ id }));
      },
    },
    permissionGroup: {
      async findFirst(args: any) {
        return groups.find((group) => (
          group.orgId === args.where.orgId
          && group.name === args.where.name
          && group.isSystem === args.where.isSystem
        )) ?? null;
      },
      async update(args: any) {
        const group = groups.find((item) => item.id === args.where.id);
        if (!group) throw new Error('group_not_found');
        group.grants = structuredClone(args.data.grants);
        return group;
      },
      async create(args: any) {
        const group: StoredGroup = {
          id: args.data.id,
          orgId: args.data.orgId,
          name: args.data.name,
          isSystem: args.data.isSystem,
          grants: structuredClone(args.data.grants),
        };
        groups.push(group);
        return { id: group.id, name: group.name, isSystem: group.isSystem };
      },
    },
  };

  return { db, groups };
}

function systemGroup(orgId: string, name: string, grants: GrantsJson): StoredGroup {
  return { id: `${orgId}-${name}`, orgId, name, isSystem: true, grants };
}

describe('RBAC default group upgrades', () => {
  it('adds missing Admin actions while preserving explicit false customization', () => {
    const result = mergeDefaultSystemGrants(
      {
        ai_model: { access: true, edit: false, manage_secret: false },
      },
      {
        ai_model: { access: true, create: true, edit: true, delete: true, manage_secret: true },
      },
      { mergeMissingActions: true },
    );

    expect(result.changed).toBe(true);
    expect(result.grants.ai_model).toEqual({
      access: true,
      create: true,
      edit: false,
      delete: true,
      manage_secret: false,
    });
  });

  it('upgrades an old system Admin without granting AI to non-Admin groups', async () => {
    const { db, groups } = createMemoryDb(['org-old'], [
      systemGroup('org-old', 'Admin', {
        settings: { access: true, edit: false },
        ai_model: { access: true, manage_secret: false },
      }),
      systemGroup('org-old', 'CEO', {
        settings: { access: true },
      }),
    ]);

    const result = await seedDefaultPermissionGroups('org-old', db as never);
    const admin = groups.find((group) => group.name === 'Admin')!;
    const ceo = groups.find((group) => group.name === 'CEO')!;

    expect(result.updated).toBeGreaterThanOrEqual(1);
    expect(admin.grants.settings?.edit).toBe(false);
    expect(admin.grants.ai_model?.manage_secret).toBe(false);
    expect(admin.grants.ai_model?.create).toBe(true);
    expect(admin.grants.ai_deployment?.deploy).toBe(true);
    expect(Object.keys(ceo.grants).some((resource) => resource.startsWith('ai'))).toBe(false);
  });

  it('backfills every existing organization in batches and is idempotent', async () => {
    const oldGroups = ['org-a', 'org-b'].flatMap((orgId) => (
      DEFAULT_PERMISSION_GROUPS.map((template) => systemGroup(
        orgId,
        template.name,
        template.name === 'Admin'
          ? { settings: { access: true } }
          : structuredClone(template.grants as GrantsJson),
      ))
    ));
    const { db, groups } = createMemoryDb(['org-a', 'org-b'], oldGroups);

    const first = await backfillDefaultPermissionGroupsForAllOrganizations({
      db: db as never,
      batchSize: 1,
    });
    const snapshot = JSON.stringify(groups);
    const second = await backfillDefaultPermissionGroupsForAllOrganizations({
      db: db as never,
      batchSize: 1,
    });

    expect(first.organizations).toBe(2);
    expect(first.failed).toEqual([]);
    expect(first.updated).toBe(2);
    expect(second.organizations).toBe(2);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.failed).toEqual([]);
    expect(JSON.stringify(groups)).toBe(snapshot);
  });
});
