// Seed chiến dịch Follow-up mẫu vào 1 org, ở trạng thái NHÁP (không gửi tin).
//
// NGUỒN DUY NHẤT là src/modules/followup/followup-templates.ts (Kho chiến dịch mẫu).
// Trước đây script này hardcode 7 mẫu → trùng lặp với kho. Nay chỉ import lại.
//
// Chạy: DATABASE_URL=... npx tsx scripts/seed-followup-samples.ts [key1 key2 ...]
//   không truyền key → seed toàn bộ kho.
import { prisma } from '../src/shared/database/prisma-client.js';
import { simulateWorkflow } from '../src/modules/followup/followup-engine.js';
import { createWorkflow } from '../src/modules/followup/followup-service.js';
import {
  FOLLOWUP_TEMPLATES, getTemplate, templateToWorkflowInput,
  validateAllTemplates, estimateDurationDays, countSteps,
} from '../src/modules/followup/followup-templates.js';

async function main() {
  // 1) Validate kho TRƯỚC khi chạm DB.
  const bad = validateAllTemplates();
  if (Object.keys(bad).length) {
    for (const [k, errs] of Object.entries(bad)) console.error(`✗ ${k}: ${errs.join('; ')}`);
    console.error(`\n${Object.keys(bad).length} mẫu lỗi cấu trúc → KHÔNG seed.`);
    process.exit(1);
  }
  console.log(`✓ Validate: ${FOLLOWUP_TEMPLATES.length}/${FOLLOWUP_TEMPLATES.length} mẫu hợp lệ.\n`);

  const user = await prisma.user.findFirst({ select: { id: true, orgId: true, fullName: true } });
  if (!user) throw new Error('không tìm thấy user/org');
  const { orgId } = user;

  const wanted = process.argv.slice(2);
  const templates = wanted.length
    ? wanted.map((k) => { const t = getTemplate(k); if (!t) throw new Error(`không có mẫu "${k}"`); return t; })
    : FOLLOWUP_TEMPLATES;

  const created: Record<string, string> = {};
  for (const t of templates) {
    const existing = await prisma.followupWorkflow.findFirst({ where: { orgId, name: t.name } });
    if (existing) { console.log(`- bỏ qua (đã có): ${t.name}`); created[t.key] = existing.id; continue; }
    const wf = await createWorkflow(orgId, { id: user.id, fullName: user.fullName ?? undefined }, templateToWorkflowInput(t));
    created[t.key] = (wf as { id: string }).id;
    console.log(`+ tạo: ${t.name}  (${countSteps(t)} bước, ~${estimateDurationDays(t)} ngày, trần ${t.config.maxMessages} tin)`);
  }

  // 2) Dry-run từng chiến dịch trên 1 contact thật (không gửi, không ghi).
  const contact = await prisma.contact.findFirst({ where: { orgId }, select: { id: true, fullName: true } });
  if (contact) {
    console.log(`\n=== DRY-RUN (contact: ${contact.fullName}) ===`);
    for (const t of templates) {
      const sim = await simulateWorkflow(created[t.key], contact.id);
      console.log(`\n▸ ${t.name}: ${sim.steps.length} bước → ${sim.endReason}`);
      for (const s of sim.steps) console.log(`   • ${s.label}${s.note ? '  (' + s.note + ')' : ''}`);
    }
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error('SEED FAIL:', e); await prisma.$disconnect(); process.exit(1); });
