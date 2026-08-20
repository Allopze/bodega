import { eq } from "drizzle-orm"
import { db } from "@/db"
import { systemSettings } from "@/db/schema"
import { createNotifications } from "@/lib/services/notification-create"
import { getUserIdsWithPermission } from "@/lib/services/notification-targeting"
import type { DteHealthDomain, DteSyncHealthEvaluation } from "./health"

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

/** Nombre del dominio como lo lee una persona; nadie recibe "chipax_bank". */
const DOMAIN_LABEL: Record<DteHealthDomain["name"], string> = {
  purchases:    "compras",
  sales:        "ventas",
  chipax_sales: "ventas (Chipax)",
  chipax_bank:  "cartolas (Chipax)",
}

/**
 * Motivo legible por código de dominio.
 *
 * Es lo que separa «al libro de compras le faltan documentos» —un incidente— de
 * «hay conciliaciones pendientes», que es el estado normal de trabajo. Con un
 * único texto genérico ambos llegaban con el mismo título, el mismo cuerpo y la
 * misma huella de deduplicación, así que el aviso diario permanente del segundo
 * enterraba al primero.
 */
const CODE_REASON: Record<string, string> = {
  DTE_HEALTH_INGEST_PARTIAL:         "faltan documentos del período (ingesta parcial)",
  DTE_HEALTH_RECONCILIATION_PENDING: "quedan conciliaciones pendientes",
  DTE_HEALTH_RUN_FAILED:             "la corrida falló",
  DTE_HEALTH_BATCH_MISSING:          "no corrió el horario programado",
  DTE_HEALTH_CONFIGURATION:          "falta configuración o credenciales",
}

function domainReason(domain: DteHealthDomain): string {
  return `${DOMAIN_LABEL[domain.name]}: ${CODE_REASON[domain.code] ?? domain.code}`
}

/** Pure dedupe/recovery policy, kept separate from DB/email delivery for tests. */
export function decideDteHealthAlert(
  evaluation: DteSyncHealthEvaluation,
  previous: AlertState | null,
): DteHealthAlertDecision | null {
  const activeDomains = evaluation.domains.filter((domain) =>
    domain.status !== "not_due" && domain.status !== "waiting" && domain.status !== "disabled",
  )
  // El `code` del dominio entra en la huella: dos incidentes distintos con el
  // mismo `status` (ingesta parcial y conciliación pendiente son ambos
  // "degraded") tienen que deduplicarse por separado, o el primero que avise
  // silencia al otro hasta que alguien cambie de estado.
  const fingerprint = `${evaluation.status}:${activeDomains.map((domain) => `${domain.name}:${domain.status}:${domain.code}:${domain.slot ?? "-"}`).sort().join("|")}`

  if (evaluation.status === "critical" || evaluation.status === "degraded") {
    if (previous?.fingerprint === fingerprint) return null
    const problems = activeDomains.filter((domain) => domain.status === "critical" || domain.status === "degraded")
    const reasons = problems.length > 0
      ? problems.map(domainReason).join("; ")
      : evaluation.code
    return {
      kind: "alert",
      fingerprint,
      title: evaluation.status === "critical"
        ? "Sincronización DTE requiere atención"
        : problems.some((domain) => domain.code === "DTE_HEALTH_INGEST_PARTIAL")
          ? "Sincronización DTE incompleta: faltan documentos"
          : "Sincronización DTE con trabajo pendiente",
      body: `La verificación automática informó ${reasons}. Revise las corridas de DTE y ventas.`,
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
