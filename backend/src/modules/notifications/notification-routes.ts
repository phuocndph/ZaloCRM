// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Notification routes — computed on-the-fly notifications for the authenticated user.
 * Sources: unreplied conversations, today/tomorrow appointments, disconnected Zalo accounts.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { getZaloScope } from '../zalo/zalo-scope.js';
import { getContactScope } from '../contacts/contact-scope.js';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  detail: string;
  priority: string;
  createdAt: string;
  accountId?: string;
  accountName?: string;
  status?: string;
  disconnectReason?: string | null;
  incidentKey?: string;
  actionUrl?: string;
  actionLabel?: string;
  shouldAlert?: boolean;
}

function disconnectedAccountDetail(status: string, reason: string | null): string {
  if (reason === 'manual') return 'Tài khoản đã được ngắt thủ công';
  if (status === 'qr_pending' || status === 'expired') return 'Phiên đăng nhập đã hết hạn, cần quét QR lại';
  if (status === 'connecting') return 'Hệ thống đang thử kết nối lại';
  return 'Tài khoản đã bị out, cần kết nối lại';
}

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/notifications', async (request) => {
    const user = request.user!;
    const notifications: NotificationItem[] = [];

    // Phase Marketing+Analytics Scope 2026-05-27: scope notification theo viewer
    const [zScope, cScope] = await Promise.all([
      getZaloScope(user.id, user.orgId, user.role),
      getContactScope(user.id, user.orgId, user.role),
    ]);
    const convScope: any = zScope.isOrgAdmin ? {} : { zaloAccountId: { in: zScope.accessibleIds } };
    const apptScope: any =
      !cScope.isOrgAdmin && cScope.accessibleContactIds !== null
        ? { contactId: { in: cScope.accessibleContactIds } }
        : {};
    const accountScope: any = zScope.isOrgAdmin ? {} : { id: { in: zScope.accessibleIds } };

    // 1. Unreplied conversations > 30 min
    const thirtyMinAgo = new Date(Date.now() - 30 * 60000);
    const unreplied = await prisma.conversation.count({
      where: { orgId: user.orgId, ...convScope, deletedAt: null, isReplied: false, lastMessageAt: { lt: thirtyMinAgo } },
    });
    if (unreplied > 0) {
      notifications.push({
        id: 'unreplied',
        type: 'warning',
        priority: 'high',
        title: `${unreplied} cuộc trò chuyện chưa trả lời`,
        detail: 'Có tin nhắn chưa phản hồi quá 30 phút',
        createdAt: new Date().toISOString(),
      });
    }

    // 2. Today's appointments
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const todayApts = await prisma.appointment.findMany({
      where: {
        orgId: user.orgId,
        ...apptScope,
        appointmentDate: { gte: todayStart, lt: todayEnd },
        status: 'scheduled',
      },
      include: { contact: { select: { fullName: true } } },
      take: 5,
    });
    for (const apt of todayApts) {
      notifications.push({
        id: `apt-${apt.id}`,
        type: 'info',
        priority: 'medium',
        title: `Lịch hẹn: ${apt.contact?.fullName || 'KH'}`,
        detail: `${apt.appointmentTime || ''} - ${apt.notes || 'Tái khám'}`,
        createdAt: apt.appointmentDate.toISOString(),
      });
    }

    // 3. Tomorrow's appointments
    const tomorrowStart = new Date(todayEnd);
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

    const tmrApts = await prisma.appointment.count({
      where: {
        orgId: user.orgId,
        ...apptScope,
        appointmentDate: { gte: tomorrowStart, lt: tomorrowEnd },
        status: 'scheduled',
      },
    });
    if (tmrApts > 0) {
      notifications.push({
        id: 'tmr-apts',
        type: 'info',
        priority: 'low',
        title: `${tmrApts} lịch hẹn ngày mai`,
        detail: 'Chuẩn bị cho ngày mai',
        createdAt: new Date().toISOString(),
      });
    }

    // 4. Disconnected Zalo accounts (2026-06-10: ẩn nick đã xóa mềm).
    // Dùng disconnectedAt/createdAt làm mốc CỐ ĐỊNH cho một incident. Trước đây createdAt
    // luôn là new Date() nên FE tưởng đây là cảnh báo mới ở mỗi lần poll và dễ spam toast.
    const accounts = await prisma.zaloAccount.findMany({
      where: { orgId: user.orgId, archivedAt: null, ...accountScope },
      select: {
        id: true,
        displayName: true,
        status: true,
        disconnectReason: true,
        disconnectedAt: true,
        createdAt: true,
      },
    });
    for (const acc of accounts) {
      const status = zaloPool.getStatus(acc.id);
      if (status !== 'connected') {
        const accountName = acc.displayName?.trim() || 'Không tên';
        const incidentAt = acc.disconnectedAt ?? acc.createdAt;
        notifications.push({
          id: `zalo-${acc.id}`,
          type: 'error',
          priority: 'high',
          title: `Tài khoản Zalo "${accountName}" đã bị out`,
          detail: disconnectedAccountDetail(status, acc.disconnectReason),
          createdAt: incidentAt.toISOString(),
          accountId: acc.id,
          accountName,
          status,
          disconnectReason: acc.disconnectReason,
          incidentKey: `${acc.id}:${acc.disconnectedAt?.toISOString() ?? `${acc.status}:${status}`}`,
          actionUrl: `/settings/channels/zalo?reconnect=${encodeURIComponent(acc.id)}`,
          actionLabel: 'Kết nối lại',
          // Sale vừa chủ động ngắt nick đã biết trạng thái này; vẫn hiện trong chuông nhưng
          // không bật toast gây hiểu nhầm là sự cố ngoài ý muốn.
          shouldAlert: acc.disconnectReason !== 'manual' && status !== 'connecting',
        });
      }
    }

    return { notifications };
  });
}
