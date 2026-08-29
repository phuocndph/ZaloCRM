import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { reconcileConversationWorkItems } from './conversation-work-item-service.js';
import { sendPushToUser } from '../push/push-service.js';

let cycleRunning = false;
const lastDigestByUser = new Map<string, string>();

function localDateKey(now: Date, offset: string) {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  const minutes = match
    ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
    : 420;
  const local = new Date(now.getTime() + minutes * 60_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;
}

function isDigestWindow(now: Date, offset: string) {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  const minutes = match
    ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
    : 420;
  const local = new Date(now.getTime() + minutes * 60_000);
  return local.getUTCHours() >= 8 && local.getUTCHours() < 9;
}

export async function reconcileAllConversationWorkItems() {
  if (cycleRunning) return { users: 0, candidates: 0, skipped: true };
  cycleRunning = true;
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, orgId: true },
    });
    let candidates = 0;
    for (const user of users) {
      try {
        const rows = await reconcileConversationWorkItems({
          orgId: user.orgId,
          assigneeUserId: user.id,
          privacy: {
            viewerUserId: user.id,
            orgId: user.orgId,
            privacyUnlocked: false,
          },
        });
        candidates += rows.length;
        const due = rows.filter((row) => row.dueAt && row.dueAt.getTime() <= Date.now() && row.priority !== 'low');
        const org = await prisma.organization.findUnique({ where: { id: user.orgId }, select: { timezone: true } });
        const digestKey = `${user.orgId}:${localDateKey(new Date(), org?.timezone || '+07:00')}`;
        if (due.length > 0 && isDigestWindow(new Date(), org?.timezone || '+07:00') && lastDigestByUser.get(user.id) !== digestKey) {
          const first = due[0];
          void sendPushToUser(user.id, {
            title: `${due.length} công việc cần xử lý`,
            body: first.title || first.nextAction,
            data: {
              workItems: '1',
              conversationId: first.conversationId ?? '',
              zaloAccountId: first.zaloAccountId ?? '',
            },
          });
          lastDigestByUser.set(user.id, digestKey);
        }
      } catch (error) {
        logger.error(`[conversation-work-items] reconcile failed user=${user.id}:`, error);
      }
    }
    return { users: users.length, candidates, skipped: false };
  } finally {
    cycleRunning = false;
  }
}

export function startConversationWorkItemCron() {
  const run = async () => {
    try {
      const result = await reconcileAllConversationWorkItems();
      if (!result.skipped && result.candidates > 0) {
        logger.debug(`[conversation-work-items] users=${result.users} active_candidates=${result.candidates}`);
      }
    } catch (error) {
      logger.error('[conversation-work-items] background reconcile failed:', error);
    }
  };

  logger.info('[conversation-work-items] background reconcile started (every 2 minutes)');
  void run();
  cron.schedule('*/2 * * * *', () => void run());
}
