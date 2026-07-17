import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  DEFAULT_PERMISSION_GROUPS,
  RESOURCES,
  RESOURCE_ACTIONS,
  sanitizeGrants,
} from '../src/modules/rbac/permission-types.js';

describe('AI RBAC resources', () => {
  it('exposes distinct control-plane resources and sensitive actions', () => {
    expect(RESOURCES).toEqual(expect.arrayContaining([
      'ai',
      'ai_model',
      'ai_learning',
      'ai_evaluation',
      'ai_auto_reply',
      'ai_deployment',
      'ai_audit',
    ]));
    expect(ACTIONS).toEqual(expect.arrayContaining([
      'approve',
      'deploy',
      'rollback',
      'manage_secret',
      'emergency_stop',
      'export',
    ]));
    expect(RESOURCE_ACTIONS.ai_deployment).toEqual([
      'access', 'create', 'approve', 'deploy', 'rollback',
    ]);
  });

  it('keeps the default Admin group fully privileged for every AI resource', () => {
    const admin = DEFAULT_PERMISSION_GROUPS.find((group) => group.name === 'Admin');
    expect(admin).toBeDefined();
    for (const resource of RESOURCES.filter((item) => item.startsWith('ai'))) {
      for (const action of RESOURCE_ACTIONS[resource]) {
        expect(admin?.grants[resource]?.[action]).toBe(true);
      }
    }
  });

  it('strips unknown resources and actions from persisted grants', () => {
    const sanitized = sanitizeGrants({
      ai_deployment: { access: true, deploy: true, backdoor: true },
      ai_model: { manage_secret: true },
      root: { deploy: true },
    });
    expect(sanitized).toEqual({
      ai_deployment: { access: true, deploy: true },
      ai_model: { manage_secret: true },
    });
  });
});