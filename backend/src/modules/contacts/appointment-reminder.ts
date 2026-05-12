/**
 * appointment-reminder.ts — Cron job that emits Socket.IO reminders
 * for appointments scheduled tomorrow.
 * Runs daily at 08:00 Vietnam time (01:00 UTC).
 */
import cron from 'node-cron';
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export function startAppointmentReminder(io: Server): void {
  // 01:00 UTC = 08:00 Vietnam time (UTC+7)
  cron.schedule('0 1 * * *', async () => {
    logger.info('[reminder] Checking tomorrow appointments...');

    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const startOfDay = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 0, 0, 0);
      const endOfDay = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59, 999);

      const appointments = await prisma.appointment.findMany({
        where: {
          appointmentDate: { gte: startOfDay, lte: endOfDay },
          status: 'scheduled',
          reminderSent: false,
        },
        include: {
          contact: { select: { fullName: true, phone: true } },
          assignedUser: { select: { id: true, fullName: true } },
        },
      });

      for (const apt of appointments) {
        io.emit('appointment:reminder', {
          appointmentId: apt.id,
          contactName: apt.contact.fullName,
          contactPhone: apt.contact.phone,
          date: apt.appointmentDate,
          time: apt.appointmentTime,
          type: apt.type,
          assignedUserId: apt.assignedUserId,
          assignedUserName: apt.assignedUser?.fullName,
        });

        await prisma.appointment.update({
          where: { id: apt.id },
          data: { reminderSent: true },
        });
      }

      logger.info(`[reminder] Sent ${appointments.length} reminder(s)`);
    } catch (err) {
      logger.error('[reminder] Cron job error:', err);
    }
  });

  logger.info('[reminder] Appointment reminder cron started (daily 01:00 UTC)');

  // Auto-flip scheduled → overdue mỗi 5 phút khi appointmentDate < now.
  // (Trước: 30 min — quá lag. Frontend giờ tính effectiveStatus client-side nhưng
  // cron vẫn cần để DB đồng bộ cho query filter / report.)
  async function flipOverdue() {
    try {
      const now = new Date();
      const result = await prisma.appointment.updateMany({
        where: { status: 'scheduled', appointmentDate: { lt: now } },
        data: { status: 'overdue' },
      });
      if (result.count > 0) {
        logger.info(`[appointment] Auto-flipped ${result.count} scheduled → overdue`);
      }
    } catch (err) {
      logger.error('[appointment] Overdue auto-flip error:', err);
    }
  }

  cron.schedule('*/5 * * * *', flipOverdue);
  // Catch-up ngay khi container start — fix rows quá hạn lúc server xuống
  void flipOverdue();

  logger.info('[appointment] Overdue auto-flip cron started (every 5 min + on-boot)');
}
