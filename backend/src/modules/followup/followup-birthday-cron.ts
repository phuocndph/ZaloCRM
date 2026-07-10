// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * followup-birthday-cron.ts — tự đưa khách vào chiến dịch sinh nhật đúng ngày.
 *
 * ĐỐI XỬ AN TOÀN (vì bước "Gửi tin" bắn Zalo THẬT):
 *   - OPT-IN tường minh: cron chỉ làm gì đó khi org có chiến dịch `type='birthday'`
 *     đang ở trạng thái `active`. Không có → không quét, không gửi.
 *   - Mỗi khách CHỈ 1 lần / năm (đếm enrollment theo mọi phiên bản, từ đầu năm).
 *   - Khách đang chạy chiến dịch khác → BỎ QUA (không cướp), vì enrollContact mặc định
 *     `onConflict: keep`.
 *   - Chưa là bạn Zalo → bỏ qua (không gửi được, tránh đốt lượt).
 *   - Chạy 08:05 giờ VN, nằm trong khung gửi mặc định 08:00–18:00 của chiến dịch.
 *
 * Không thêm bảng/cột nào: `Contact.birthDate` đã có sẵn; `type` là cột String tự do.
 */
import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { enrollContact } from './followup-engine.js';

const BIRTHDAY_TYPE = 'birthday';

export interface BirthdayScanResult {
  orgsWithCampaign: number;
  candidates: number;
  enrolled: number;
  skipped: { alreadyThisYear: number; noFriendNick: number; inOtherCampaign: number; failed: number };
  dryRun: boolean;
}

/** Ngày/tháng theo giờ VN (cron chạy giờ UTC nên phải quy đổi tường minh). */
function vnMonthDay(now: Date): { month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh', month: 'numeric', day: 'numeric',
  }).formatToParts(now);
  return {
    month: Number(parts.find((p) => p.type === 'month')?.value ?? '1'),
    day: Number(parts.find((p) => p.type === 'day')?.value ?? '1'),
  };
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * Quét và enroll. `dryRun` chỉ đếm, KHÔNG enroll, KHÔNG gửi tin — dùng để kiểm thử.
 */
export async function runBirthdayScan(opts?: { dryRun?: boolean; now?: Date }): Promise<BirthdayScanResult> {
  const dryRun = opts?.dryRun ?? false;
  const now = opts?.now ?? new Date();
  const { month, day } = vnMonthDay(now);
  const year = now.getFullYear();
  const startOfYear = new Date(Date.UTC(year, 0, 1));

  const res: BirthdayScanResult = {
    orgsWithCampaign: 0, candidates: 0, enrolled: 0,
    skipped: { alreadyThisYear: 0, noFriendNick: 0, inOtherCampaign: 0, failed: 0 },
    dryRun,
  };

  // 1) Org nào có chiến dịch sinh nhật ĐANG KÍCH HOẠT? (opt-in)
  const campaigns = await prisma.followupWorkflow.findMany({
    where: { type: BIRTHDAY_TYPE, status: 'active', isLatest: true },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, orgId: true, rootId: true, name: true },
  });
  if (!campaigns.length) return res;

  // 1 chiến dịch / org (bản cập nhật gần nhất) — tránh enroll 2 lần nếu org lỡ bật nhiều cái.
  const byOrg = new Map<string, (typeof campaigns)[number]>();
  for (const c of campaigns) if (!byOrg.has(c.orgId)) byOrg.set(c.orgId, c);
  res.orgsWithCampaign = byOrg.size;

  for (const [orgId, wf] of byOrg) {
    // Mọi phiên bản của chiến dịch → dùng để dò "đã enroll năm nay chưa".
    const rootId = wf.rootId ?? wf.id;
    const versions = await prisma.followupWorkflow.findMany({
      where: { orgId, OR: [{ id: rootId }, { rootId }] },
      select: { id: true },
    });
    const versionIds = versions.map((v) => v.id);

    // 2) Khách có sinh nhật hôm nay. birth_date là DATE → so khớp tháng/ngày.
    //    29/02: năm không nhuận thì chúc vào 01/03 để không bỏ sót.
    const alsoFeb29 = month === 3 && day === 1 && !isLeapYear(year);
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM contacts
      WHERE org_id = ${orgId}
        AND birth_date IS NOT NULL
        AND (
          (EXTRACT(MONTH FROM birth_date) = ${month} AND EXTRACT(DAY FROM birth_date) = ${day})
          OR (${alsoFeb29} AND EXTRACT(MONTH FROM birth_date) = 2 AND EXTRACT(DAY FROM birth_date) = 29)
        )
    `;
    res.candidates += rows.length;

    for (const c of rows) {
      // 3) Đã chúc năm nay chưa? (tính theo mọi phiên bản chiến dịch)
      const already = await prisma.followupEnrollment.count({
        where: { contactId: c.id, workflowId: { in: versionIds }, startedAt: { gte: startOfYear } },
      });
      if (already > 0) { res.skipped.alreadyThisYear++; continue; }

      // 4) Nick nào gửi được? Phải ĐÃ là bạn, nếu không tin sẽ fail.
      const friend = await prisma.friend.findFirst({
        where: { contactId: c.id, friendshipStatus: 'accepted' },
        select: { zaloAccountId: true },
        orderBy: { updatedAt: 'desc' },
      });
      if (!friend) { res.skipped.noFriendNick++; continue; }

      if (dryRun) { res.enrolled++; continue; }

      const r = await enrollContact({
        workflowId: wf.id, contactId: c.id, zaloAccountId: friend.zaloAccountId,
        actorType: 'system', actorName: 'Tự động (sinh nhật)',
      });
      if (r.ok) res.enrolled++;
      else if (r.conflict) res.skipped.inOtherCampaign++;
      else res.skipped.failed++;
    }
  }

  logger.info(
    `[followup-birthday] ${dryRun ? '[DRY-RUN] ' : ''}org=${res.orgsWithCampaign} ứng viên=${res.candidates} ` +
    `enroll=${res.enrolled} bỏ qua: đã chúc=${res.skipped.alreadyThisYear} chưa-kết-bạn=${res.skipped.noFriendNick} ` +
    `đang-chiến-dịch-khác=${res.skipped.inOtherCampaign} lỗi=${res.skipped.failed}`,
  );
  return res;
}

export function startFollowupBirthdayCron(): void {
  // 01:05 UTC = 08:05 giờ VN → nằm trong khung gửi 08:00–18:00 nên tin đi ngay,
  // không phải chờ tới hôm sau.
  cron.schedule('5 1 * * *', async () => {
    try {
      await runBirthdayScan();
    } catch (err) {
      // Cron hỏng KHÔNG được làm sập app.
      logger.error('[followup-birthday] scan lỗi:', err);
    }
  });
  logger.info('[followup-birthday] Đã hẹn lịch quét sinh nhật hằng ngày (01:05 UTC / 08:05 VN)');
}
