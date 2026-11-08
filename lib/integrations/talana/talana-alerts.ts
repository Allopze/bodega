/**
 * Avisos de la sincronización con Talana a quienes tienen `admin:workers_hr`.
 *
 * Las fallas de integraciones no avisaban a nadie (sólo quedaban en `cron_runs`).
 * Acá: una falla, un bloqueo del fusible o una corrida parcial avisa como máximo
 * una vez al día por motivo, mientras dure; al volver a una corrida limpia se
 * avisa una sola vez que se recuperó. Nunca lleva datos de personas.
 */
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { systemSettings } from "@/db/schema"
import { logger } from "@/lib/logger"
import { createNotifications } from "@/lib/services/notification-create"
import { getGlobalUserIdsWithPermission } from "@/lib/services/notification-targeting"
import type { FusibleReason } from "./talana-snapshot"

const ALERT_STATE_KEY = "talana.sync_alert_state.v1"

interface AlertState {
  status: "ok" | "problem"
  fingerprint: string
}

export interface TalanaRunOutcome {
  runId: string
  status: "success" | "partial" | "blocked" | "failed"
  /** Código de error (`failed`) o motivo del fusible (`blocked`). */
  reason: string | null
  failedPeople: number
}

export interface TalanaAlertDecision {
  kind: "alert" | "recovery"
  fingerprint: string
  title: string
  body: string
  dedupeKey: string
}

const FUSIBLE_TEXT: Record<FusibleReason, string> = {
  no_active_contracts: "Talana devolvió cero contratos activos",
  active_drop: "los contratos activos cayeron sin finiquitos que lo expliquen",
  mass_altas: "la corrida traía demasiadas altas de una vez",
}

const ERROR_TEXT: Record<string, string> = {
  TALANA_AUTH_FAILED: "Talana rechazó el token (revisar TALANA_API_TOKEN o los permisos de la cuenta)",
  TALANA_RATE_LIMITED: "Talana limitó las consultas; se reintenta mañana",
  TALANA_TIMEOUT: "Talana no respondió a tiempo",
  TALANA_SNAPSHOT_INCOMPLETE: "la descarga de Talana vino incompleta",
  TALANA_BAD_RESPONSE: "Talana respondió con un formato inesperado",
}

/** Política pura de aviso y recuperación, separada del envío para probarla. */
export function decideTalanaAlert(outcome: TalanaRunOutcome, previous: AlertState | null, today: string): TalanaAlertDecision | null {
  if (outcome.status === "success") {
    if (previous?.status !== "problem") return null
    return {
      kind: "recovery",
      fingerprint: "ok",
      title: "Sincronización con Talana recuperada",
      body: "La última corrida terminó sin problemas.",
      dedupeKey: `talana-sync:recovery:${outcome.runId}`,
    }
  }
  const fingerprint = `${outcome.status}:${outcome.reason ?? "-"}`
  let title: string
  let body: string
  if (outcome.status === "blocked") {
    const text = FUSIBLE_TEXT[outcome.reason as FusibleReason] ?? "la respuesta de Talana se veía anómala"
    title = "Sincronización con Talana detenida por el fusible"
    body = `No se aplicó ningún cambio: ${text}. Revise y, si corresponde, rearme el fusible en Sincronización Talana.`
  } else if (outcome.status === "failed") {
    title = "Sincronización con Talana falló"
    body = `La corrida no terminó: ${ERROR_TEXT[outcome.reason ?? ""] ?? `código ${outcome.reason ?? "desconocido"}`}. Nada cambió en Chome.`
  } else {
    title = "Sincronización con Talana incompleta"
    body = `${outcome.failedPeople} persona(s) no se pudieron actualizar; el resto se aplicó. Revise la corrida en Sincronización Talana.`
  }
  return { kind: "alert", fingerprint, title, body, dedupeKey: `talana-sync:${fingerprint}:${today}` }
}

async function readAlertState(): Promise<AlertState | null> {
  const [row] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, ALERT_STATE_KEY)).limit(1)
  if (!row) return null
  try {
    const parsed = JSON.parse(row.value) as Partial<AlertState>
    if ((parsed.status !== "ok" && parsed.status !== "problem") || typeof parsed.fingerprint !== "string") return null
    return { status: parsed.status, fingerprint: parsed.fingerprint }
  } catch {
    return null
  }
}

async function writeAlertState(state: AlertState): Promise<void> {
  const now = new Date().toISOString()
  await db.insert(systemSettings).values({ key: ALERT_STATE_KEY, value: JSON.stringify(state), updatedAt: now })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: JSON.stringify(state), updatedAt: now } })
}

/** Nunca lanza: un aviso que no sale no debe tumbar la corrida. */
export async function notifyTalanaRunOutcome(outcome: TalanaRunOutcome, today: string): Promise<void> {
  try {
    const previous = await readAlertState()
    const decision = decideTalanaAlert(outcome, previous, today)
    if (!decision) return
    const recipients = await getGlobalUserIdsWithPermission("admin:workers_hr")
    await createNotifications(recipients, {
      type: "system_alert",
      title: decision.title,
      body: decision.body,
      entityType: "talana_sync_run",
      entityId: outcome.runId,
      entityHref: "/admin/talana",
      dedupeKey: decision.dedupeKey,
    })
    await writeAlertState(decision.kind === "alert" ? { status: "problem", fingerprint: decision.fingerprint } : { status: "ok", fingerprint: "ok" })
  } catch (error) {
    logger.error("[talana] no se pudo avisar el resultado de la corrida", { code: error instanceof Error ? error.name : "unknown" })
  }
}
