/**
 * ai-capabilities.test.ts — Phase 6 (Bảo mật xác thực 2026-06-08)
 * Verify allowlist deny-by-default + audit bot.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  assertAiCapability,
  auditAiAction,
  AiCapabilityError,
  DANGEROUS_ACTIONS,
} from '../../src/modules/ai/ai-capabilities.js';
import { prisma } from '../../src/shared/database/prisma-client.js';
import { hasRealDatabase } from '../test-helpers.js';

const ORG_ID = 'test-ai-org';
// Allowlist là hàm thuần → luôn chạy. Chỉ `auditAiAction` cần Postgres thật.
const HAS_DB = hasRealDatabase();

beforeAll(async () => {
  if (!HAS_DB) return;
  await prisma.activityLog.deleteMany({ where: { orgId: ORG_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.organization.create({ data: { id: ORG_ID, name: 'AI Org' } });
});

afterAll(async () => {
  if (!HAS_DB) return;
  await prisma.activityLog.deleteMany({ where: { orgId: ORG_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.$disconnect();
});

describe('ai-capabilities', () => {
  it('hành động trong allowlist -> pass', () => {
    expect(assertAiCapability('save_ai_message')).toEqual({ requireApproval: false });
    expect(() => assertAiCapability('generate_reply')).not.toThrow();
  });

  it('hành động ngoài allowlist -> throw AiCapabilityError', () => {
    expect(() => assertAiCapability('random_action')).toThrow(AiCapabilityError);
  });

  it('mọi DANGEROUS_ACTIONS đều bị chặn (không trong allowlist)', () => {
    for (const action of DANGEROUS_ACTIONS) {
      expect(() => assertAiCapability(action)).toThrow(AiCapabilityError);
    }
  });

  it.skipIf(!HAS_DB)('auditAiAction ghi ActivityLog actorType=bot', async () => {
    auditAiAction(ORG_ID, 'virtual_chat_reply', { conversationId: 'c1' });
    // Fire-and-forget -> chờ flush.
    await new Promise((r) => setTimeout(r, 200));
    const rows = await prisma.activityLog.findMany({ where: { orgId: ORG_ID, actorType: 'bot' } });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].action).toBe('ai_virtual_chat_reply');
    expect(rows[0].botName).toBe('AI Assistant');
  });
});
