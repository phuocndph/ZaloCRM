// Phase Friend Invite Queue 2026-05-28 — FNV-1a 64-bit hash for advisory lock keys.
//
// Postgres `pg_try_advisory_lock(bigint)` needs deterministic int64 key per nick.
// FNV-1a 64-bit là deterministic + fast + low collision cho short strings.
// Memory: `feedback_design_pattern_check_before_ui.md` — não dùng cryptographic
// hash vì advisory lock chỉ cần consistency, không cần security.

// FNV-1a 64-bit constants
const FNV_OFFSET_BASIS_64 = 14695981039346656037n;
const FNV_PRIME_64 = 1099511628211n;

/**
 * Compute FNV-1a 64-bit hash of input string, return as Postgres bigint string.
 * Wraps to signed bigint range (Postgres advisory lock accepts signed int64).
 */
export function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET_BASIS_64;
  for (let i = 0; i < input.length; i++) {
    hash = (hash ^ BigInt(input.charCodeAt(i))) & 0xffffffffffffffffn;
    hash = (hash * FNV_PRIME_64) & 0xffffffffffffffffn;
  }
  // Postgres advisory lock uses signed int64; wrap to signed range
  if (hash >= 0x8000000000000000n) {
    return hash - 0x10000000000000000n;
  }
  return hash;
}

/**
 * Generate advisory lock key for nick worker spawn.
 * Pattern: `nick-worker:${nickId}` → bigint.
 */
export function nickWorkerLockKey(nickId: string): bigint {
  return fnv1a64(`nick-worker:${nickId}`);
}
