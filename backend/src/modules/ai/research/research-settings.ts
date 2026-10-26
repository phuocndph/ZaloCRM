// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { prisma } from '../../../shared/database/prisma-client.js';
import { encryptToken, decryptToken } from '../../integrations/_shared/token-encryption.util.js';
import { ResearchError, object, text, type ResearchActor } from './research-domain.js';

const SEARCH_KEY = 'research_serper_api_key';
export async function researchSearchKey(orgId: string) {
  const setting = await prisma.appSetting.findUnique({ where: { orgId_settingKey: { orgId, settingKey: SEARCH_KEY } } });
  if (setting?.valueEncrypted) return decryptToken(Buffer.from(setting.valueEncrypted).toString('utf8'));
  return process.env.RESEARCH_SERPER_API_KEY?.trim() || '';
}
export async function researchCapabilities(orgId: string) {
  const key = await researchSearchKey(orgId);
  const allowedDomains = (process.env.RESEARCH_WEB_ALLOWED_DOMAINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    search: { provider: 'serper_google', configured: !!key },
    publicWeb: { allowedDomains, publicSitesEnabled: true },
    facebook: { automaticGroupReading: false, automaticGroupDiscovery: !!key, manualImport: true },
    formats: ['article', 'zalo_message', 'checklist'],
  };
}
export async function saveResearchSearchKey(actor: ResearchActor, raw: unknown) {
  if (!['owner', 'admin'].includes(actor.role)) throw new ResearchError('Chỉ quản trị được thiết lập kết nối tìm kiếm.', 403, 'RESEARCH_SETTINGS_FORBIDDEN');
  const key = text(object(raw).apiKey, 'Mã kết nối tìm kiếm', 500);
  if (/\s/.test(key)) throw new ResearchError('Mã kết nối tìm kiếm không được chứa khoảng trắng.');
  const blob = Buffer.from(encryptToken(key), 'utf8');
  await prisma.appSetting.upsert({
    where: { orgId_settingKey: { orgId: actor.orgId, settingKey: SEARCH_KEY } },
    create: { orgId: actor.orgId, settingKey: SEARCH_KEY, valueEncrypted: blob },
    update: { valueEncrypted: blob, valuePlain: null },
  });
  // Never return even a masked portion of the credential.
  return { configured: true };
}
