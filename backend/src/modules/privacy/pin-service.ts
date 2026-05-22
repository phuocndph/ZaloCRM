/**
 * pin-service.ts — Phase Riêng Tư 2026-05-22
 *
 * PIN lifecycle: setup, verify, unlock session, lock, rate limit.
 * Anh chốt: PIN 4 số, 5 sai → 5 phút lock, 10 sai → 1h lock.
 * Session 4 mức: 15p / 1h / 12h / 24h + idle timeout 30 phút.
 */
import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../shared/database/prisma-client.js';

// Anh chốt 2026-05-22: 4 mốc thời hạn (thay [15, 60, 720, 1440] cũ):
// 5p (test/nhanh), 15p (khuyến nghị), 8h (ca làm việc), 12h (nửa ngày)
export const DURATIONS_MIN = [5, 15, 480, 720] as const;
export type SessionDuration = (typeof DURATIONS_MIN)[number];

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const PIN_FAIL_LOCKOUT_5 = 5 * 60 * 1000;   // 5 sai → lock 5 phút
const PIN_FAIL_LOCKOUT_10 = 60 * 60 * 1000; // 10 sai → lock 1h
const SESSION_TOKEN_BYTES = 32;

function genToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

function hashIp(ip?: string): string | null {
  if (!ip) return null;
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

/** Validate PIN format: chỉ 4 chữ số */
function validatePinFormat(pin: string): void {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error('PIN phải là 4 chữ số (0-9)');
  }
}

/**
 * Setup PIN lần đầu hoặc đổi PIN.
 * Đổi PIN → revoke all sessions cũ sau 60s grace period (codex review #4).
 */
export async function setupPin(userId: string, newPin: string): Promise<void> {
  validatePinFormat(newPin);
  const hash = await bcrypt.hash(newPin, 10);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { privacyPinHash: true },
    });
    if (!user) throw new Error('User không tồn tại');

    await tx.user.update({
      where: { id: userId },
      data: {
        privacyPinHash: hash,
        privacyFailedCount: 0,
        privacyLockedUntil: null,
      },
    });

    // Đổi PIN (đã có hash cũ): revoke all sessions sau 60s grace
    if (user.privacyPinHash) {
      const graceCutoff = new Date(Date.now() + 60 * 1000);
      await tx.userPrivacySession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: graceCutoff },
      });
    }
  });
}

/**
 * Unlock: verify PIN, tạo session token, return.
 * Rate limit: 5 sai → 5p lock, 10 sai → 1h lock.
 */
export async function unlock(input: {
  userId: string;
  pin: string;
  durationMinutes: SessionDuration;
  ip?: string;
  userAgent?: string;
}): Promise<{ sessionToken: string; expiresAt: Date }> {
  if (!DURATIONS_MIN.includes(input.durationMinutes)) {
    throw new Error('Duration phải là 15, 60, 720 hoặc 1440 phút');
  }
  validatePinFormat(input.pin);

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      privacyPinHash: true,
      privacyFailedCount: true,
      privacyLockedUntil: true,
    },
  });
  if (!user) throw new Error('User không tồn tại');
  if (!user.privacyPinHash) throw new Error('Chưa setup PIN — gọi /privacy/setup-pin trước');

  if (user.privacyLockedUntil && user.privacyLockedUntil > new Date()) {
    const secs = Math.ceil((user.privacyLockedUntil.getTime() - Date.now()) / 1000);
    throw new Error(`PIN đang khoá. Thử lại sau ${secs}s.`);
  }

  const valid = await bcrypt.compare(input.pin, user.privacyPinHash);
  if (!valid) {
    // CODEX REVIEW P1 #3 FIX: atomic increment race-safe.
    // 2 parallel wrong-PIN request không thể ghi đè cùng count snapshot cũ.
    const updated = await prisma.user.update({
      where: { id: input.userId },
      data: { privacyFailedCount: { increment: 1 } },
      select: { privacyFailedCount: true },
    });
    const failed = updated.privacyFailedCount;
    let lockedUntil: Date | null = null;
    if (failed >= 10) lockedUntil = new Date(Date.now() + PIN_FAIL_LOCKOUT_10);
    else if (failed >= 5) lockedUntil = new Date(Date.now() + PIN_FAIL_LOCKOUT_5);
    if (lockedUntil) {
      await prisma.user.update({
        where: { id: input.userId },
        data: { privacyLockedUntil: lockedUntil },
      });
    }
    throw new Error(
      failed >= 10
        ? 'PIN sai 10 lần — khoá 1h. Liên hệ admin nếu cần reset.'
        : failed >= 5
          ? `PIN sai ${failed} lần — khoá 5 phút.`
          : `PIN sai. Còn ${10 - failed} lần thử trước khi khoá.`,
    );
  }

  // Verified: reset fail counter, tạo session.
  // Anh chốt 2026-05-22: revoke ALL prior active sessions trước khi tạo mới —
  // tránh orphan sessions khi user re-unlock với duration khác. Nhờ vậy
  // activeSessionCount luôn ≤ 1 cho mỗi user, lock badge revoke đúng 1 session
  // duy nhất → click lock = thật sự lock.
  const expiresAt = new Date(Date.now() + input.durationMinutes * 60 * 1000);
  const sessionToken = genToken();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.userId },
      data: { privacyFailedCount: 0, privacyLockedUntil: null },
    });
    await tx.userPrivacySession.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.userPrivacySession.create({
      data: {
        userId: input.userId,
        sessionToken,
        expiresAt,
        ipHash: hashIp(input.ip),
        userAgent: input.userAgent?.slice(0, 200),
      },
    });
  });

  return { sessionToken, expiresAt };
}

/** Revoke 1 session by token (sale chủ động lock). */
export async function lock(sessionToken: string): Promise<void> {
  await prisma.userPrivacySession.updateMany({
    where: { sessionToken, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revoke ALL active sessions của user (vd: owner reset PIN). */
export async function revokeAllSessions(userId: string): Promise<number> {
  const result = await prisma.userPrivacySession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/**
 * Resolve session token → user nếu active, valid, idle <30 phút.
 * Hot path: cache layer ở privacy-middleware để giảm DB load.
 * Update lastActivityAt với throttle 60s (codex review style — không write mọi req).
 */
const lastActivityCache = new Map<string, number>(); // token → last update timestamp
const ACTIVITY_UPDATE_THROTTLE_MS = 60 * 1000;

export async function resolveSession(sessionToken: string): Promise<{
  userId: string;
  expiresAt: Date;
} | null> {
  if (!sessionToken) return null;
  const now = new Date();

  // CODEX REVIEW P2 #4 FIX: atomic conditional read — re-verify active status
  // ngay tại thời điểm decide. Tránh race với /lock hoặc revokeAll giữa read và return.
  const session = await prisma.userPrivacySession.findFirst({
    where: {
      sessionToken,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    select: {
      userId: true,
      expiresAt: true,
      lastActivityAt: true,
    },
  });
  if (!session) return null;

  // Idle timeout check
  const idleMs = now.getTime() - session.lastActivityAt.getTime();
  if (idleMs > IDLE_TIMEOUT_MS) {
    // Auto-revoke stale session — conditional update để không đè revoke khác
    await prisma.userPrivacySession.updateMany({
      where: { sessionToken, revokedAt: null },
      data: { revokedAt: now },
    }).catch(() => {});
    return null;
  }

  // Throttled last_activity update (60s) — conditional để tránh resurrect session đã revoke
  const lastUpdate = lastActivityCache.get(sessionToken) ?? 0;
  if (now.getTime() - lastUpdate > ACTIVITY_UPDATE_THROTTLE_MS) {
    lastActivityCache.set(sessionToken, now.getTime());
    void prisma.userPrivacySession.updateMany({
      where: { sessionToken, revokedAt: null, expiresAt: { gt: now } },
      data: { lastActivityAt: now },
    }).catch(() => {});
  }

  return { userId: session.userId, expiresAt: session.expiresAt };
}

/**
 * Owner reset PIN cho user (forgot PIN flow).
 * Clear hash + fail counter + lockout. Sale phải setup lại lần kế.
 */
export async function adminResetPin(targetUserId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: targetUserId },
      data: {
        privacyPinHash: null,
        privacyFailedCount: 0,
        privacyLockedUntil: null,
      },
    });
    await tx.userPrivacySession.updateMany({
      where: { userId: targetUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });
}

/**
 * Status of user PIN — có hash chưa, đang lock, session active nào.
 */
export async function getStatus(userId: string): Promise<{
  hasPin: boolean;
  lockedUntil: Date | null;
  activeSessionCount: number;
  activeSessions: Array<{ id: string; expiresAt: Date; userAgent: string | null; unlockedAt: Date }>;
}> {
  const [user, sessions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { privacyPinHash: true, privacyLockedUntil: true },
    }),
    prisma.userPrivacySession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, expiresAt: true, userAgent: true, unlockedAt: true },
      orderBy: { unlockedAt: 'desc' },
    }),
  ]);

  return {
    hasPin: !!user?.privacyPinHash,
    lockedUntil: user?.privacyLockedUntil ?? null,
    activeSessionCount: sessions.length,
    activeSessions: sessions,
  };
}
