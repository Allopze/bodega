import { eq } from "drizzle-orm"
import { db } from "@/db"
import { systemSettings } from "@/db/schema"
import { createNotifications } from "@/lib/services/notification-create"
import { getUserIdsWithPermission } from "@/lib/services/notification-targeting"
import type { DteSyncHealthEvaluation } from "./health"

const ALERT_STATE_KEY = "dte.sync_health_alert_state.v1"

interface AlertState {
  fingerprint: string
  status: "healthy" | "disabled" | "degraded" | "critical"
}

export interface DteHealthAlertDecision {
  kind: "alert" | "recovery"
  fingerprint: string
  title: string
  body: string
}

/** Pure dedupe/recovery policy, kept separate from DB/email delivery for tests. */
export function decideDteHealthAlert(
  evaluation: DteSyncHealthEvaluation,
  previous: AlertState | null,
): DteHealthAlertDecision | null {
  const activeDomains = evaluation.domains.filter((domain) =>
    domain.status !== "not_due" && domain.status !== "waiting" && domain.status !== "disabled",
  )
  const fingerprint = `${evaluation.status}:${activeDomains.map((domain) => `${domain.name}:${domain.status}:${domain.slot ?? "-"}`).sort().join("|")}`

  if (evaluation.status === "critical" || evaluation.status === "degraded") {
    if (previous?.fingerprint === fingerprint) return null
    return {
      kind: "alert",
      fingerprint,
      title: evaluation.status === "critical"
        ? "Sincronización DTE requiere atención"
        : "Sincronización DTE con trabajo pendiente",
      body: `La verificación automática informó ${evaluation.code}. Revise las corridas de DTE y ventas.`,
    }
  }

  const measuredSuccess = activeDomains.some((domain) => domain.status === "healthy")
  if (evaluation.status === "healthy" && measuredSuccess && (previous?.status === "critical" || previous?.status === "degraded")) {
    return {
      kind: "recovery",
      fingerprint,
      title: "Sincronización DTE recuperada",
      body: "La última verificación automática completó los períodos actual y anterior.",
    }
  }
  return null
}

/**
 * Sends one alert per changed due-slot state and a recovery only after a
 * measured successful slot. Notification creation respects each recipient's
 * existing mail preference; no provider payload or credential is included.
 */
export async function notifyDteSyncHealthChange(evaluation: DteSyncHealthEvaluation): Promise<void> {
  const previous = await readAlertState()
  const decision = decideDteHealthAlert(evaluation, previous)
  if (!decision) return

  if (decision.kind === "alert") {
    const recipients = await getUserIdsWithPermission("admin:dte_sync")
    await createNotifications(recipients, {
      type: "system_alert",
      title: decision.title,
      body: decision.body,
      entityType: "dte_sync_health",
      entityId: decision.fingerprint,
      entityHref: "/admin/dte",
      dedupeKey: `dte-sync-health:${decision.fingerprint}`,
    })
    await writeAlertState({ fingerprint: decision.fingerprint, status: evaluation.status })
    return
  }

  const recipients = await getUserIdsWithPermission("admin:dte_sync")
  await createNotifications(recipients, {
    type: "system_alert",
    title: decision.title,
    body: decision.body,
    entityType: "dte_sync_health",
    entityId: decision.fingerprint,
    entityHref: "/admin/dte",
    dedupeKey: `dte-sync-health:recovery:${decision.fingerprint}`,
  })
  await writeAlertState({ fingerprint: decision.fingerprint, status: "healthy" })
}

async function readAlertState(): Promise<AlertState | null> {
  const [row] = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, ALERT_STATE_KEY))
    .limit(1)
  if (!row) return null
  try {
    const parsed = JSON.parse(row.value) as Partial<AlertState>
    if (typeof parsed.fingerprint !== "string") return null
    if (parsed.status !== "healthy" && parsed.status !== "disabled" && parsed.status !== "degraded" && parsed.status !== "critical") return null
    return { fingerprint: parsed.fingerprint, status: parsed.status }
  } catch {
    return null
  }
}

async function writeAlertState(state: AlertState): Promise<void> {
  const now = new Date().toISOString()
  await db.insert(systemSettings).values({
    key: ALERT_STATE_KEY,
    value: JSON.stringify(state),
    updatedAt: now,
  }).onConflictDoUpdate({
    target: systemSettings.key,
    set: { value: JSON.stringify(state), updatedAt: now },
  })
}
