import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERMISSION_GROUPS,
  RESOURCE_ACTIONS,
  sanitizeGrants,
} from '../src/modules/rbac/permission-types.js';

describe('ai_model approve permission', () => {
  it('is an allowed ai_model action and is granted to the system Admin template', () => {
    expect(RESOURCE_ACTIONS.ai_model).toContain('approve');
    const admin = DEFAULT_PERMISSION_GROUPS.find((group) => group.name === 'Admin');
    expect(admin?.grants.ai_model?.approve).toBe(true);
  });

  it('preserves a valid approve grant while stripping unknown model actions', () => {
    expect(sanitizeGrants({
      ai_model: { access: true, approve: true, bypass_review: true },
    })).toEqual({
      ai_model: { access: true, approve: true },
    });
  });
});
