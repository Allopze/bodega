/**
 * lib/services/prevention-ops-alerts.ts
 *
 * PREV-I13 (alertas). La decisión D28 dejó las alertas de Prevención en logs:
 * una evidencia perdida o un cron caído sólo se veían si alguien leía el log
 * del contenedor. Esto las lleva a la infraestructura de avisos que ya usa el
 * resto de la plataforma —`createNotifications` deja la notificación en la
 * campana y manda el correo por `lib/email/smtp.ts`, respetando el interruptor
 * global `emails_enabled` y la preferencia `email_notifications` de cada
 * persona—. No se agregó proveedor ni ajuste nuevo.
 *
 * Destinatarios (permisos existentes, ajustables en `/admin/roles`):
 *
 * - **Integridad de la evidencia** → `admin:backups` ("Gestionar respaldos y
 *   restauración"; administrador y jefatura por defecto). Un archivo perdido se
 *   recupera del respaldo, y es el mismo grupo que ya recibe la alerta de
 *   `backup-health`.
 * - **Cron de Prevención fallido** → `admin:ops_settings` ("parámetros
 *   operativos avanzados"; administrador). Es un problema de operación de la
 *   plataforma, no del programa.
 *
 * Deduplicación: la `dedupeKey` de la notificación lleva el job y el día
 * chileno, así que se avisa **como máximo una vez por job y por día** mientras
 * el problema dure (el mismo criterio que `backup-health`). El índice parcial
 * `(user_id, dedupe_key)` y `createNotifications` evitan también el correo
 * repetido.
 *
 * Nada de esto puede tumbar lo que observa: cada función atrapa y registra sus
 * propios errores. Sin correo configurado, la notificación igual queda en la
 * plataforma y se deja un `warn` en el log.
 */
import { logger } from "@/lib/logger"
import { todayInChile } from "@/lib/utils"
import { createNotifications } from "@/lib/services/notification-create"
import { getUserIdsWithPermission } from "@/lib/services/notification-targeting"
import { getEmailsEnabled } from "@/lib/services/system-settings"
import type { PdtpEvidenceIntegrityResult } from "@/lib/services/pdtp/evidence-integrity"

/**
 * Crons de Prevención (los que agenda `scripts/cron-runner.mjs` para el
 * módulo). `deadline-reminders` entra porque dos de sus tres barridos son de
 * Prevención (revisión de la MIPER y solicitudes de privacidad).
 */
export const PREVENTION_ALERT_JOBS = [
  "pdtp-weekly-reminders",
  "pdtp-fulfillment-reconcile",
  "pdtp-evidence-integrity",
  "pdtp-evidence-gc",
  "prevention-capa-reminders",
  "prevention-training-reminders",
  "prevention-cphs-alerts",
  "prevention-incident-reminders",
  "prevention-inspection-programs",
  "prevention-document-ack-reminders",
  "sst-weekly-alerts",
  "deadline-reminders",
] as const

const PREVENTION_JOB_SET = new Set<string>(PREVENTION_ALERT_JOBS)

export const CRON_FAILURE_RECIPIENT_PERMISSION = "admin:ops_settings"
export const EVIDENCE_INTEGRITY_RECIPIENT_PERMISSION = "admin:backups"

/** Rutas de muestra en el cuerpo: el detalle completo está en el log del escaneo. */
const SAMPLE_SIZE = 5
const ERROR_MAX = 300

async function warnIfEmailUnavailable(context: string): Promise<void> {
  if (!process.env.RESEND_API_KEY?.trim()) {
    logger.warn(`[prevention-alerts] ${context}: correo no configurado (RESEND_API_KEY ausente); la alerta queda sólo en la plataforma`)
    return
  }
  if (!(await getEmailsEnabled())) {
    logger.warn(`[prevention-alerts] ${context}: correo no configurado (envío de correos desactivado); la alerta queda sólo en la plataforma`)
  }
}

async function notify(input: {
  context: string
  permission: string
  title: string
  body: string
  entityType: string
  entityId: string
  entityHref: string
  dedupeKey: string
}): Promise<void> {
  const recipients = await getUserIdsWithPermission(input.permission)
  if (recipients.length === 0) {
    logger.error(`[prevention-alerts] ${input.context}: nadie a quien avisar, ningún usuario activo tiene ${input.permission}`)
    return
  }
  await warnIfEmailUnavailable(input.context)
  await createNotifications(recipients, {
    type: "system_alert",
    title: input.title,
    body: input.body,
    entityType: input.entityType,
    entityId: input.entityId,
    entityHref: input.entityHref,
    dedupeKey: input.dedupeKey,
  })
}

/** Llamada por `withCronLock` cuando una corrida termina en `failed`. */
export async function alertPreventionCronFailure(jobName: string, error: unknown): Promise<void> {
  if (!PREVENTION_JOB_SET.has(jobName)) return
  try {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, ERROR_MAX)
    await notify({
      context: `cron/${jobName}`,
      permission: CRON_FAILURE_RECIPIENT_PERMISSION,
      title: `Falló el cron de Prevención «${jobName}»`,
      body: `La corrida terminó con error: ${message}. Revisa el log del contenedor y la bitácora cron_runs; los avisos y recordatorios que dependen de este job no salieron.`,
      entityType: "cron_run",
      entityId: jobName,
      entityHref: "/admin",
      dedupeKey: `prevention-cron-failed:${jobName}:${todayInChile()}`,
    })
  } catch (err) {
    logger.error(`[prevention-alerts] no se pudo avisar la falla de cron/${jobName}`, err)
  }
}

type IntegrityFindings = Pick<PdtpEvidenceIntegrityResult, "missingCount" | "checksumMismatchCount" | "missing" | "checksumMismatches">

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/** Llamada por la ruta del cron `pdtp-evidence-integrity` después del escaneo. */
export async function alertPdtpEvidenceIntegrityIssues(result: Partial<IntegrityFindings>): Promise<void> {
  const missingCount = result.missingCount ?? 0
  const mismatchCount = result.checksumMismatchCount ?? 0
  if (missingCount === 0 && mismatchCount === 0) return
  try {
    const sample = [
      ...(result.missing ?? []).map((item) => item.path),
      ...(result.checksumMismatches ?? []).map((item) => item.path),
    ].slice(0, SAMPLE_SIZE).map((file) => file.split("/").pop() ?? file)
    const parts = [
      missingCount > 0 ? plural(missingCount, "archivo perdido", "archivos perdidos") : null,
      mismatchCount > 0 ? plural(mismatchCount, "alterado (sha256 distinto)", "alterados (sha256 distinto)") : null,
    ].filter(Boolean).join(" y ")
    await notify({
      context: "cron/pdtp-evidence-integrity",
      permission: EVIDENCE_INTEGRITY_RECIPIENT_PERMISSION,
      title: "Evidencia del programa preventivo con archivos perdidos o alterados",
      body: `El escaneo diario encontró ${parts}. Muestra: ${sample.join(", ")}. El detalle completo, con la ejecución dueña de cada archivo, está en el log del escaneo; recupéralos desde el respaldo.`,
      entityType: "pdtp_evidence_integrity",
      entityId: "pdtp-evidence-integrity",
      entityHref: "/admin/backups",
      dedupeKey: `pdtp-evidence-integrity:${todayInChile()}`,
    })
  } catch (err) {
    logger.error("[prevention-alerts] no se pudo avisar el resultado del escaneo de integridad", err)
  }
}
