/**
 * cleanup-ghost-nicks.ts — Dọn thẻ nick MA cũ (Anh chốt 2026-06-13, fix nick-ghost).
 *
 * Bối cảnh: login Zalo treo đẻ ra nhiều "thẻ nick ma" (record ZaloAccount trùng cho cùng
 * 1 tài khoản Zalo). Mỗi thẻ ma sinh 1 Friend row → /contacts hiện "3 Evo Sport / 1 KH".
 * Các fix code (Fix 0-4) CHẶN ghost MỚI; script này DỌN ghost ĐÃ CÓ trong DB (local + VPS).
 *
 * Hành vi (Anh chốt):
 *   • XÓA CỨNG Friend row trỏ thẻ ma (Tension 3). Cascade kéo FriendTag (schema:1167).
 *   • ẨN thẻ ma (archivedAt) — không hard-delete account để giữ lịch sử/audit.
 *
 * CHỐT AN TOÀN (chạy được trên production):
 *   1. CHỈ thẻ đã xác định là ma: zaloUid=null + status IN (qr_pending,disconnected) +
 *      archivedAt=null + lastConnectedAt=null. lastConnectedAt=null PHÂN BIỆT thẻ ma với
 *      nick THẬT CŨ qua luồng "Xóa khỏi CRM" (purge nhả uid=null nhưng GIỮ lastConnectedAt)
 *      → KHÔNG đụng nick từng online (Codex #8 cảnh báo).
 *   2. DRY-RUN mặc định: chỉ in, KHÔNG ghi. Phải truyền --apply mới xóa thật.
 *      Dry-run in kèm conversations/FriendTag/lastConnectedAt để Anh duyệt mắt từng thẻ.
 *
 * Dùng:
 *   Dry-run (mặc định, an toàn):  npx tsx backend/scripts/cleanup-ghost-nicks.ts
 *   Chạy thật:                    npx tsx backend/scripts/cleanup-ghost-nicks.ts --apply
 *   Đổi ngưỡng tuổi (phút):       npx tsx backend/scripts/cleanup-ghost-nicks.ts --stale-min=15
 *
 * Trên VPS: BẮT BUỘC chạy dry-run trước, Anh duyệt danh sách, rồi mới --apply.
 */
import { prisma } from '../src/shared/database/prisma-client.js';
import { runSystemQuery } from '../src/shared/tenant/tenant-context.js';

interface GhostRow {
  id: string;
  orgId: string;
  displayName: string | null;
  phone: string | null;
  status: string;
  createdAt: Date;
  conversations: number;
  friends: number;
  friendTags: number;
}

/** Tìm thẻ ma đủ điều kiện dọn (chốt an toàn #1). */
async function findStaleGhosts(staleMinutes: number): Promise<GhostRow[]> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000);
  return runSystemQuery(async () => {
    const accounts = await prisma.zaloAccount.findMany({
      where: {
        zaloUid: null,
        archivedAt: null,
        lastConnectedAt: null, // chưa từng online → loại nick thật cũ qua purge
        status: { in: ['qr_pending', 'disconnected'] },
        createdAt: { lt: cutoff },
      },
      select: {
        id: true,
        orgId: true,
        displayName: true,
        phone: true,
        status: true,
        createdAt: true,
        _count: { select: { conversations: true, friends: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Đếm FriendTag sẽ bị cascade (báo cho Anh biết mất bao nhiêu lịch sử tag).
    const rows: GhostRow[] = [];
    for (const a of accounts) {
      const friendTags = await prisma.friendTag.count({
        where: { friend: { zaloAccountId: a.id } },
      });
      rows.push({
        id: a.id,
        orgId: a.orgId,
        displayName: a.displayName,
        phone: a.phone,
        status: a.status,
        createdAt: a.createdAt,
        conversations: a._count.conversations,
        friends: a._count.friends,
        friendTags,
      });
    }
    return rows;
  });
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const staleArg = args.find((a) => a.startsWith('--stale-min='));
  const staleMinutes = staleArg ? Number(staleArg.split('=')[1]) || 15 : 15;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  DỌN THẺ NICK MA  —  ${apply ? '🔴 CHẠY THẬT (--apply)' : '🟢 DRY-RUN (chỉ in, không ghi)'}`);
  console.log(`  Ngưỡng tuổi: thẻ ma cũ hơn ${staleMinutes} phút`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const ghosts = await findStaleGhosts(staleMinutes);

  if (ghosts.length === 0) {
    console.log('✅ Không tìm thấy thẻ ma nào đủ điều kiện dọn. Sạch.');
    return;
  }

  console.log(`Tìm thấy ${ghosts.length} thẻ ma đủ điều kiện:\n`);
  let totalFriends = 0;
  let totalTags = 0;
  let totalConv = 0;
  for (const g of ghosts) {
    totalFriends += g.friends;
    totalTags += g.friendTags;
    totalConv += g.conversations;
    console.log(`  • [${g.id}] "${g.displayName ?? '(chưa tên)'}" phone=${g.phone ?? '—'} status=${g.status}`);
    console.log(`      tạo: ${g.createdAt.toISOString()} | org: ${g.orgId}`);
    console.log(`      → sẽ XÓA ${g.friends} Friend row (kéo ${g.friendTags} FriendTag) | hội thoại gắn: ${g.conversations}`);
    if (g.conversations > 0) {
      console.log(`      ⚠️  CÓ ${g.conversations} hội thoại — kiểm kỹ trước khi --apply (có thể là nick thật bị lẫn).`);
    }
    console.log('');
  }
  console.log(`TỔNG: ${ghosts.length} thẻ ma | ${totalFriends} Friend sẽ xóa | ${totalTags} FriendTag bị cascade | ${totalConv} hội thoại gắn.\n`);

  if (!apply) {
    console.log('🟢 DRY-RUN — KHÔNG ghi gì. Kiểm danh sách trên, nếu đúng thì chạy lại với --apply.');
    return;
  }

  console.log('🔴 ÁP DỤNG — xóa cứng Friend + ẩn thẻ ma...\n');
  const ids = ghosts.map((g) => g.id);
  await runSystemQuery(async () => {
    // Xóa cứng Friend của thẻ ma (cascade FriendTag). Anh chốt: xóa cứng (Tension 3).
    const delFriends = await prisma.friend.deleteMany({ where: { zaloAccountId: { in: ids } } });
    console.log(`  ✓ Xóa ${delFriends.count} Friend row.`);
    // Ẩn thẻ ma (giữ record để audit), nhả session để pool ngừng auto-reconnect.
    const arch = await prisma.zaloAccount.updateMany({
      where: { id: { in: ids } },
      data: { archivedAt: new Date(), status: 'disconnected' },
    });
    console.log(`  ✓ Ẩn ${arch.count} thẻ ma (archivedAt set).`);
  });
  console.log('\n✅ Xong. /contacts sẽ hết thẻ ma sau khi reload.');
}

main()
  .catch((err) => {
    console.error('❌ Lỗi:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
