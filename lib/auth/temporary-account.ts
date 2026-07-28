/**
 * Temporary substitute accounts have a hard authorization deadline. This is
 * intentionally evaluated at authentication time as well as by the cleanup
 * job, so a delayed cron run cannot extend delegated access.
 */
export function isTemporaryAccountExpired(
  user: { isTemporary: boolean; validUntil: string | null },
  nowMs = Date.now(),
) {
  if (!user.isTemporary) return false
  if (!user.validUntil) return true

  const validUntilMs = Date.parse(user.validUntil)
  return !Number.isFinite(validUntilMs) || validUntilMs <= nowMs
}
