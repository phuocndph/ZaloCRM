// Seed 7 workflow mẫu cho Follow-up (ngành đồ vải khách sạn). Tất cả tạo ở trạng thái
// NHÁP (draft) → không gửi tin cho tới khi user bấm Kích hoạt.
// Chạy: DATABASE_URL=... npx tsx scripts/seed-followup-samples.ts
import { prisma } from '../src/shared/database/prisma-client.js';
import { simulateWorkflow } from '../src/modules/followup/followup-engine.js';

type Step = { key: string; type: string; orderIndex: number; config?: any; nextKey?: string | null };
interface Sample {
  name: string; type: string; description: string;
  goalType: string; goalTag?: string | null; goalTagOnReach?: string | null;
  stopOnPurchase: boolean; stopOnTags: string[]; maxMessages: number;
  nextName?: string; // nối workflow kế tiếp theo TÊN (resolve sau)
  steps: Step[];
}

const S = (i: number, k: string, content: string, next: string | null): Step =>
  ({ key: k, type: 'send', orderIndex: i, config: { content }, nextKey: next });
const W = (i: number, k: string, amount: number, unit: string, next: string | null): Step =>
  ({ key: k, type: 'wait', orderIndex: i, config: { amount, unit }, nextKey: next });
const C = (i: number, k: string, check: string, trueKey: string, falseKey: string, tag?: string): Step =>
  ({ key: k, type: 'condition', orderIndex: i, config: { check, tag, trueKey, falseKey }, nextKey: null });
const T = (i: number, k: string, title: string, next: string | null, note?: string): Step =>
  ({ key: k, type: 'sale_task', orderIndex: i, config: { title, note }, nextKey: next });
const TAG = (i: number, k: string, tag: string, next: string | null): Step =>
  ({ key: k, type: 'tag_add', orderIndex: i, config: { tag }, nextKey: next });

const samples: Sample[] = [
  {
    name: '1. Giới thiệu doanh nghiệp',
    type: 'intro',
    description: 'Chạm đầu tiên với chủ khách sạn/homestay chưa biết Joliefam.',
    goalType: 'replied', goalTagOnReach: 'Đã phản hồi',
    stopOnPurchase: true, stopOnTags: ['Không làm phiền'], maxMessages: 2,
    nextName: '2. Follow-up sau báo giá',
    steps: [
      { key: 'start', type: 'start', orderIndex: 0, nextKey: 's1' },
      S(1, 's1', 'Chào anh/chị {{name}}! Em là Phước bên Joliefam, chuyên chăn ga gối nệm, đệm và khăn cho khách sạn, homestay, resort. Vải cotton kháng khuẩn, bền màu sau nhiều lần giặt công nghiệp. Bên mình đang setup phòng mới hay cần thay đồ vải ạ?', 'w1'),
      W(2, 'w1', 2, 'day', 'c1'),
      C(3, 'c1', 'not_replied', 's2', 'end'),
      S(4, 's2', 'Dạ em gửi anh/chị catalogue và bảng giá đồ vải khách sạn Joliefam. Bên em may theo đúng size phòng và gửi hàng mẫu trước khi chốt. Anh/chị cần báo giá cho bao nhiêu phòng ạ?', 'w2'),
      W(5, 'w2', 3, 'day', 'c2'),
      C(6, 'c2', 'not_replied', 't1', 'end'),
      T(7, 't1', 'Gọi điện giới thiệu sản phẩm', 'end', 'Khách chưa phản hồi sau 2 tin nhắn.'),
      { key: 'end', type: 'end', orderIndex: 8 },
    ],
  },
  {
    name: '2. Follow-up sau báo giá',
    type: 'after_quote',
    description: 'Bám đuổi sau khi đã gửi báo giá, mục tiêu chốt đơn.',
    goalType: 'purchased', goalTagOnReach: 'Đã chốt',
    stopOnPurchase: false, stopOnTags: ['Không làm phiền'], maxMessages: 3,
    nextName: '5. Chăm sóc sau bán',
    steps: [
      { key: 'start', type: 'start', orderIndex: 0, nextKey: 's1' },
      S(1, 's1', 'Dạ anh/chị {{name}} đã xem qua báo giá bên em chưa ạ? Nếu cần em điều chỉnh theo số lượng phòng hoặc đổi chất liệu, anh/chị cứ nhắn em nhé.', 'w1'),
      W(2, 'w1', 2, 'day', 'c1'),
      C(3, 'c1', 'not_replied', 's2', 'end'),
      S(4, 's2', 'Dạ bên em đang có ưu đãi cho đơn từ 20 phòng: tặng kèm 2 bộ ga trải và miễn phí vận chuyển. Em giữ mức giá này tới cuối tuần, anh/chị cân nhắc giúp em ạ.', 'w2'),
      W(5, 'w2', 3, 'day', 'c2'),
      C(6, 'c2', 'not_replied', 't1', 'end'),
      T(7, 't1', 'Gọi chốt đơn sau báo giá', 'end', 'Khách im sau 2 lần nhắc.'),
      { key: 'end', type: 'end', orderIndex: 8 },
    ],
  },
  {
    name: '3. Chăm sóc khách hàng',
    type: 'care',
    description: 'Nuôi dưỡng khách đang quan tâm, chưa chốt.',
    goalType: 'replied', goalTagOnReach: 'Đã phản hồi',
    stopOnPurchase: false, stopOnTags: ['Không làm phiền'], maxMessages: 2,
    steps: [
      { key: 'start', type: 'start', orderIndex: 0, nextKey: 's1' },
      S(1, 's1', 'Chào anh/chị {{name}}, bên em chia sẻ một mẹo nhỏ: đồ vải khách sạn nên chọn cotton tỉ trọng cao để chịu được giặt công nghiệp, tránh xù lông sau vài tháng. Anh/chị đang dùng chất liệu nào ạ?', 'w1'),
      W(2, 'w1', 14, 'day', 's2'),
      S(3, 's2', 'Dạ Joliefam vừa cập nhật mẫu chăn ga mới cho mùa cao điểm, form dày dặn hơn mà giá giữ nguyên. Anh/chị cần em gửi mẫu vải tham khảo không ạ?', 'end'),
      { key: 'end', type: 'end', orderIndex: 4 },
    ],
  },
  {
    name: '4. Nhắc mua lại',
    type: 'rebuy',
    description: 'Khách đã mua, nhắc thay mới đồ vải sau chu kỳ sử dụng.',
    goalType: 'replied', goalTagOnReach: 'Có nhu cầu mua lại',
    stopOnPurchase: false, stopOnTags: ['Không làm phiền'], maxMessages: 2,
    steps: [
      { key: 'start', type: 'start', orderIndex: 0, nextKey: 'c0' },
      C(1, 'c0', 'has_tag', 's1', 'end', 'Đã mua'),
      S(2, 's1', 'Chào anh/chị {{name}}, đồ vải khách sạn dùng khoảng 8-12 tháng là nên thay để giữ hình ảnh phòng ạ. Bên em có mẫu cotton mới bền màu hơn, anh/chị cần em gửi mẫu và báo giá thay mới không ạ?', 'w1'),
      W(3, 'w1', 7, 'day', 'c1'),
      C(4, 'c1', 'not_replied', 's2', 'end'),
      S(5, 's2', 'Dạ em gửi anh/chị ưu đãi riêng cho khách cũ: giảm 10% đơn thay mới đồ vải, áp dụng trong tháng này ạ.', 'end'),
      { key: 'end', type: 'end', orderIndex: 6 },
    ],
  },
  {
    name: '5. Chăm sóc sau bán',
    type: 'post_sale',
    description: 'Sau khi giao hàng: hướng dẫn bảo quản + thu phản hồi.',
    goalType: 'none',
    stopOnPurchase: false, stopOnTags: ['Không làm phiền'], maxMessages: 2,
    steps: [
      { key: 'start', type: 'start', orderIndex: 0, nextKey: 's1' },
      S(1, 's1', 'Cảm ơn anh/chị {{name}} đã tin tưởng Joliefam ạ! Em gửi hướng dẫn bảo quản để giữ độ bền và màu vải: giặt nước dưới 40 độ C, không dùng chất tẩy mạnh, phơi tránh nắng gắt. Cần hỗ trợ gì anh/chị cứ nhắn em nhé.', 'w1'),
      W(2, 'w1', 7, 'day', 's2'),
      S(3, 's2', 'Dạ anh/chị {{name}} dùng chăn ga bên em thấy ổn không ạ? Nếu có điểm nào chưa ưng, anh/chị phản hồi giúp em để bên em hỗ trợ đổi hoặc bù ngay ạ.', 'w2'),
      W(4, 'w2', 30, 'day', 'tg1'),
      TAG(5, 'tg1', 'Đã chăm sóc sau bán', 'end'),
      { key: 'end', type: 'end', orderIndex: 6 },
    ],
  },
  {
    name: '6. Khuyến mại',
    type: 'promo',
    description: 'Đẩy chương trình ưu đãi theo đợt.',
    goalType: 'replied', goalTagOnReach: 'Quan tâm khuyến mại',
    stopOnPurchase: true, stopOnTags: ['Không làm phiền'], maxMessages: 2,
    steps: [
      { key: 'start', type: 'start', orderIndex: 0, nextKey: 's1' },
      S(1, 's1', 'Chào anh/chị {{name}}, Joliefam đang có chương trình ưu đãi đồ vải khách sạn: giảm tới 15% cho đơn từ 10 phòng, tặng kèm khăn mặt. Anh/chị quan tâm em gửi báo giá chi tiết nhé!', 'w1'),
      W(2, 'w1', 3, 'day', 'c1'),
      C(3, 'c1', 'not_replied', 's2', 'end'),
      S(4, 's2', 'Dạ chương trình ưu đãi bên em còn 3 ngày nữa là kết thúc. Nếu anh/chị cần em giữ suất, nhắn em một tiếng nhé ạ.', 'end'),
      { key: 'end', type: 'end', orderIndex: 5 },
    ],
  },
  {
    name: '7. Khách lâu không tương tác',
    type: 'reengage',
    description: 'Đánh thức khách nguội; nếu chưa là bạn thì giao Sale kết bạn trước.',
    goalType: 'replied', goalTagOnReach: 'Đã tương tác lại',
    stopOnPurchase: true, stopOnTags: ['Không làm phiền'], maxMessages: 2,
    steps: [
      { key: 'start', type: 'start', orderIndex: 0, nextKey: 'c0' },
      C(1, 'c0', 'is_friend', 's1', 't0'),
      T(2, 't0', 'Kết bạn Zalo với khách trước khi chăm sóc', 'end', 'Chưa là bạn nên không gửi tin được.'),
      S(3, 's1', 'Chào anh/chị {{name}}, lâu rồi em chưa hỏi thăm ạ. Khách sạn/homestay của anh/chị dạo này thế nào? Bên em vừa ra mẫu khăn và đệm mới cho mùa cao điểm, em gửi anh/chị tham khảo nhé.', 'w1'),
      W(4, 'w1', 5, 'day', 'c1'),
      C(5, 'c1', 'not_replied', 's2', 'end'),
      S(6, 's2', 'Dạ nếu hiện tại anh/chị chưa có nhu cầu, em xin phép không làm phiền thêm ạ. Khi nào cần đồ vải khách sạn, anh/chị cứ nhắn em nhé. Chúc anh/chị kinh doanh thuận lợi!', 'tg1'),
      TAG(7, 'tg1', 'Nguội', 'end'),
      { key: 'end', type: 'end', orderIndex: 8 },
    ],
  },
];

/** Kiểm mọi nextKey/trueKey/falseKey đều trỏ tới 1 bước có thật + có start/end. */
function validate(s: Sample): string[] {
  const keys = new Set(s.steps.map((x) => x.key));
  const errs: string[] = [];
  if (!s.steps.some((x) => x.type === 'start')) errs.push('thiếu bước start');
  if (!s.steps.some((x) => x.type === 'end')) errs.push('thiếu bước end');
  const sends = s.steps.filter((x) => x.type === 'send').length;
  if (sends > s.maxMessages) errs.push(`có ${sends} bước gửi > trần ${s.maxMessages} tin`);
  for (const st of s.steps) {
    if (st.nextKey && !keys.has(st.nextKey)) errs.push(`${st.key}.nextKey -> "${st.nextKey}" không tồn tại`);
    if (st.type === 'condition') {
      const c = st.config ?? {};
      if (!c.trueKey || !keys.has(c.trueKey)) errs.push(`${st.key}.trueKey -> "${c.trueKey}" không tồn tại`);
      if (!c.falseKey || !keys.has(c.falseKey)) errs.push(`${st.key}.falseKey -> "${c.falseKey}" không tồn tại`);
      if ((c.check === 'has_tag' || c.check === 'no_tag') && !c.tag) errs.push(`${st.key}: check ${c.check} thiếu tag`);
    }
    if (st.type === 'send' && !st.config?.content?.trim()) errs.push(`${st.key}: nội dung tin rỗng`);
  }
  return errs;
}

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true, orgId: true, fullName: true } });
  if (!user) throw new Error('no user');
  const { orgId } = user;

  // Validate trước khi ghi DB
  let bad = 0;
  for (const s of samples) {
    const errs = validate(s);
    if (errs.length) { bad++; console.error(`✗ ${s.name}:`, errs.join('; ')); }
  }
  if (bad) { console.error(`\n${bad} workflow lỗi cấu trúc → KHÔNG seed.`); process.exit(1); }
  console.log('✓ Validate cấu trúc: 7/7 workflow hợp lệ (nhánh trỏ đúng, có start/end, số tin ≤ trần).\n');

  const created: Record<string, string> = {};
  for (const s of samples) {
    const existing = await prisma.followupWorkflow.findFirst({ where: { orgId, name: s.name } });
    if (existing) { console.log(`- bỏ qua (đã có): ${s.name}`); created[s.name] = existing.id; continue; }
    const wf = await prisma.followupWorkflow.create({
      data: {
        orgId, createdById: user.id, createdByName: user.fullName ?? null,
        name: s.name, description: s.description, type: s.type, status: 'draft',
        goalType: s.goalType, goalTag: s.goalTag ?? null, goalTagOnReach: s.goalTagOnReach ?? null,
        stopOnPurchase: s.stopOnPurchase, stopOnTags: s.stopOnTags, maxMessages: s.maxMessages,
        sendWindowStart: 480, sendWindowEnd: 1080, minGapMinutes: 1440, timezone: 'Asia/Ho_Chi_Minh',
      },
    });
    await prisma.followupWorkflow.update({ where: { id: wf.id }, data: { rootId: wf.id } });
    await prisma.followupStep.createMany({
      data: s.steps.map((st) => ({
        workflowId: wf.id, key: st.key, type: st.type, orderIndex: st.orderIndex,
        config: (st.config ?? {}) as any, nextKey: st.nextKey ?? null,
      })),
    });
    created[s.name] = wf.id;
    console.log(`+ tạo: ${s.name}  (${s.steps.length} bước, trần ${s.maxMessages} tin)`);
  }

  // Nối workflow kế tiếp
  for (const s of samples) {
    if (!s.nextName) continue;
    const from = created[s.name], to = created[s.nextName];
    if (from && to) {
      await prisma.followupWorkflow.update({ where: { id: from }, data: { nextWorkflowId: to } });
      console.log(`→ nối: "${s.name}" đạt Goal ⇒ chuyển "${s.nextName}"`);
    }
  }

  // Dry-run từng workflow trên 1 contact thật (không gửi, không ghi)
  const contact = await prisma.contact.findFirst({ where: { orgId }, select: { id: true, fullName: true } });
  if (contact) {
    console.log(`\n=== DRY-RUN (contact: ${contact.fullName}) ===`);
    for (const s of samples) {
      const sim = await simulateWorkflow(created[s.name], contact.id);
      console.log(`\n▸ ${s.name}: ${sim.steps.length} bước chạy → ${sim.endReason}`);
      for (const st of sim.steps) console.log(`   • ${st.label}${st.note ? '  (' + st.note + ')' : ''}`);
    }
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error('SEED FAIL:', e); await prisma.$disconnect(); process.exit(1); });
