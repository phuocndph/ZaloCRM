import { describe, expect, it } from 'vitest';
import {
  inferAutomaticGroupProfile,
  isSupportedBusinessGroup,
} from '../../src/modules/zalo/group-monitoring-policy.js';

describe('group monitoring policy', () => {
  it('always excludes communities reported by the SDK', () => {
    expect(inferAutomaticGroupProfile({
      name: 'Cộng đồng bán hàng',
      sdkType: 2,
      current: {
        groupCategory: 'sales',
        groupMonitoringEnabled: true,
        groupClassificationSource: 'manual',
      },
    })).toMatchObject({
      groupSdkType: 2,
      groupCategory: 'community',
      groupMonitoringEnabled: false,
      groupClassificationSource: 'sdk',
    });
  });

  it('enables a clearly named standard sales group', () => {
    expect(inferAutomaticGroupProfile({ name: 'Nhóm bán hàng và chốt đơn', sdkType: 1 })).toMatchObject({
      groupCategory: 'sales',
      groupMonitoringEnabled: true,
      groupClassificationSource: 'rule',
    });
  });

  it('requires an enabled sales or customer-care category', () => {
    expect(isSupportedBusinessGroup({
      threadType: 'group',
      groupSdkType: 1,
      groupCategory: 'customer_care',
      groupMonitoringEnabled: true,
    })).toBe(true);
    expect(isSupportedBusinessGroup({
      threadType: 'group',
      groupSdkType: 2,
      groupCategory: 'sales',
      groupMonitoringEnabled: true,
    })).toBe(false);
  });

  it('preserves the classified-at timestamp when automatic classification is unchanged', () => {
    const classifiedAt = new Date('2026-08-30T00:00:00.000Z');
    expect(inferAutomaticGroupProfile({
      name: 'Nhóm bán hàng và chốt đơn',
      sdkType: 1,
      now: new Date('2026-08-31T00:00:00.000Z'),
      current: {
        groupSdkType: 1,
        groupCategory: 'sales',
        groupMonitoringEnabled: true,
        groupClassificationSource: 'rule',
        groupClassificationConfidence: 0.88,
        groupClassifiedAt: classifiedAt,
      },
    }).groupClassifiedAt).toBe(classifiedAt);
  });
});
