// Phase 7 Engine — bootstrap. Imported by app.ts on startup.
//
// Wires:
//   1. Event-bus listener → campaign materializer (event → tasks)
//   2. Default action handler registrations (stubs for now; Phase G real impls)
//   3. Task worker startup (polls queued tasks)
//
// Safe to import multiple times — guards via isStarted flag.

import { logger } from '../../../shared/utils/logger.js';
import { automationEventBus } from './event-bus.js';
import { materializeFromEvent } from './campaign-materializer.js';
import { registerActionHandler } from './action-dispatcher.js';
import {
  requestFriendHandler,
  sendMessageHandler,
  updateStatusHandler,
} from './action-handlers/index.js';

let isStarted = false;

export function startAutomationEngine(): void {
  if (isStarted) {
    logger.warn('[automation.engine] already started');
    return;
  }
  isStarted = true;

  // 1. Wire event bus → materializer
  automationEventBus.on(async (event) => {
    try {
      await materializeFromEvent(event);
    } catch (err) {
      logger.error('[automation.engine] materializer error:', err);
    }
  });

  // 2. Register action handlers (Phase G stubs / real impls)
  registerActionHandler('update_status', updateStatusHandler);
  registerActionHandler('request_friend', requestFriendHandler);
  registerActionHandler('send_message', sendMessageHandler);

  // 3. (XÓA 2026-06-12) startTaskWorker() — task-worker.ts là DB-polling worker dựa
  //    trên AutomationTask (đã drop), đọc stub→[] → no-op vĩnh viễn. Runtime giờ là
  //    BullMQ (sequence-step-worker + friend-invite-worker, start ở app.ts).

  // 4. Start cron event scheduler (birthday + scheduled_cron triggers)
  void (async () => {
    try {
      const { startCronEventScheduler } = await import('./cron-event-scheduler.js');
      await startCronEventScheduler();
    } catch (err) {
      logger.error('[automation.engine] cron scheduler boot failed:', err);
    }
  })();

  // 5. Start engagement sweeper (Wave 1 #12 seen_no_reply + #13 silent_x_days)
  void (async () => {
    try {
      const { startEngagementSweeper } = await import('./engagement-trigger-sweeper.js');
      startEngagementSweeper();
    } catch (err) {
      logger.error('[automation.engine] engagement sweeper boot failed:', err);
    }
  })();

  logger.info('[automation.engine] started — event bus + 3 action handlers + cron + engagement-sweeper (runtime via BullMQ workers)');
}

export { automationEventBus } from './event-bus.js';
export { materializeFromEvent } from './campaign-materializer.js';
