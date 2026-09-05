export const GROUP_CATEGORIES = [
  'sales',
  'customer_care',
  'internal',
  'supplier',
  'community',
  'unknown',
] as const;

export type GroupCategory = typeof GROUP_CATEGORIES[number];

export type GroupMonitoringProfile = {
  groupSdkType?: number | null;
  groupCategory: GroupCategory;
  groupMonitoringEnabled: boolean;
  groupClassificationSource: 'sdk' | 'rule' | 'manual' | 'unclassified';
  groupClassificationConfidence: number | null;
  groupClassifiedAt: Date | null;
};

const CUSTOMER_CARE_PATTERN = /\b(cskh|cham soc|bao hanh|ho tro|khieu nai|support|after sale)\b/i;
const SALES_PATTERN = /\b(ban hang|sales?|khach hang|chot don|don hang|bao gia|tu van|dai ly|si le|booking|order)\b/i;
const INTERNAL_PATTERN = /\b(noi bo|nhan vien|giao ban|ke toan|hanh chinh|team|cong ty|phong ban|kho noi bo)\b/i;
const SUPPLIER_PATTERN = /\b(nha cung cap|xuong|van chuyen|logistics|xuat nhap|doi tac cung ung|giao nhan)\b/i;

export function normalizeGroupText(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFD')
    .toLocaleLowerCase('vi-VN')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSupportedBusinessGroup(profile: {
  threadType?: string | null;
  isPrivate?: boolean;
  groupSdkType?: number | null;
  groupCategory?: string | null;
  groupMonitoringEnabled?: boolean;
}) {
  return profile.threadType === 'group'
    && !profile.isPrivate
    && profile.groupSdkType !== 2
    && profile.groupMonitoringEnabled === true
    && ['sales', 'customer_care'].includes(String(profile.groupCategory ?? ''));
}

export function inferAutomaticGroupProfile(input: {
  name?: string | null;
  sdkType?: number | null;
  current?: Partial<GroupMonitoringProfile> | null;
  now?: Date;
}): GroupMonitoringProfile {
  const now = input.now ?? new Date();
  const sdkType = Number.isFinite(input.sdkType) ? Number(input.sdkType) : input.current?.groupSdkType ?? null;

  // Exact SDK type always wins. A community can never be enabled manually or by heuristics.
  if (sdkType === 2) {
    const classificationUnchanged = input.current?.groupSdkType === 2
      && input.current?.groupCategory === 'community'
      && input.current?.groupClassificationSource === 'sdk';
    return {
      groupSdkType: 2,
      groupCategory: 'community',
      groupMonitoringEnabled: false,
      groupClassificationSource: 'sdk',
      groupClassificationConfidence: 1,
      groupClassifiedAt: classificationUnchanged && input.current?.groupClassifiedAt
        ? input.current.groupClassifiedAt
        : now,
    };
  }

  if (input.current?.groupClassificationSource === 'manual') {
    return {
      groupSdkType: sdkType,
      groupCategory: GROUP_CATEGORIES.includes(input.current.groupCategory as GroupCategory)
        ? input.current.groupCategory as GroupCategory
        : 'unknown',
      groupMonitoringEnabled: input.current.groupMonitoringEnabled === true,
      groupClassificationSource: 'manual',
      groupClassificationConfidence: input.current.groupClassificationConfidence ?? 1,
      groupClassifiedAt: input.current.groupClassifiedAt ?? now,
    };
  }

  const normalizedName = normalizeGroupText(input.name);
  let groupCategory: GroupCategory = 'unknown';
  let confidence: number | null = null;
  if (CUSTOMER_CARE_PATTERN.test(normalizedName)) {
    groupCategory = 'customer_care';
    confidence = 0.92;
  } else if (SALES_PATTERN.test(normalizedName)) {
    groupCategory = 'sales';
    confidence = 0.88;
  } else if (INTERNAL_PATTERN.test(normalizedName)) {
    groupCategory = 'internal';
    confidence = 0.86;
  } else if (SUPPLIER_PATTERN.test(normalizedName)) {
    groupCategory = 'supplier';
    confidence = 0.82;
  }

  const source = groupCategory === 'unknown' ? 'unclassified' : 'rule';
  const classificationUnchanged = input.current?.groupCategory === groupCategory
    && input.current?.groupClassificationSource === source;
  return {
    groupSdkType: sdkType,
    groupCategory,
    groupMonitoringEnabled: groupCategory === 'sales' || groupCategory === 'customer_care',
    groupClassificationSource: source,
    groupClassificationConfidence: confidence,
    groupClassifiedAt: groupCategory === 'unknown'
      ? null
      : classificationUnchanged && input.current?.groupClassifiedAt
        ? input.current.groupClassifiedAt
        : now,
  };
}
