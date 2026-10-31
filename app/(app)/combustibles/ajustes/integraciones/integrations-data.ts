import { eq } from "drizzle-orm"
import { db } from "@/db"
import { systemSettings } from "@/db/schema"
import { settle } from "@/lib/async-settle"
import { ARAMCO_SETTING_KEYS, readAramcoAdminStatus, type AramcoAdminStatus } from "@/lib/combustibles/aramco-settings"
import { copecSource, type CopecSource } from "@/lib/combustibles/copec-ws"
import { readVisionLinkConfig } from "@/lib/integrations/visionlink/visionlink-settings"
import { getCronJobHealth } from "@/lib/services/cron-lock"
import { INTEGRATION_JOBS, type IntegrationKey, type IntegrationRun } from "./integration-status"

export interface IntegrationsData {
  runs: Record<IntegrationKey, IntegrationRun | null>
  /** `null` si la lectura de corridas falló: la pantalla dice «no se pudo leer» en vez de «sin corridas». */
  runsFailed: boolean
  copecSource: CopecSource
  aramco: AramcoAdminStatus
  /** Cuándo se guardaron las credenciales de Aramco en la aplicación (no cuáles son). */
  aramcoConfiguredAt: string | null
  visionlink: { hasCredentials: boolean; syncEnabled: boolean }
  degraded: number
}

const EMPTY_ARAMCO: AramcoAdminStatus = {
  syncEnabled: false,
  fields: { documentNumber: { configured: false, source: "missing" }, password: { configured: false, source: "missing" } },
  hasStoredSettings: false,
  canStoreSecrets: false,
}

/** Lecturas de «Integraciones». Nunca devuelve un valor secreto: sólo banderas y fechas. */
export async function loadIntegrationsData(): Promise<IntegrationsData> {
  const failed = Symbol("failed")
  const [health, aramco, passwordRow] = await Promise.all([
    settle<Awaited<ReturnType<typeof getCronJobHealth>> | typeof failed>(getCronJobHealth(30), failed, "ajustes-integraciones-corridas"),
    settle<AramcoAdminStatus | typeof failed>(readAramcoAdminStatus(), failed, "ajustes-integraciones-aramco"),
    settle<Array<{ updatedAt: string }> | typeof failed>(
      db.select({ updatedAt: systemSettings.updatedAt }).from(systemSettings).where(eq(systemSettings.key, ARAMCO_SETTING_KEYS.password)).limit(1),
      failed,
      "ajustes-integraciones-aramco-fecha",
    ),
  ])

  const byJob = new Map((health === failed ? [] : health).map((row) => [row.jobName, row]))
  const run = (key: IntegrationKey): IntegrationRun | null => {
    const row = byJob.get(INTEGRATION_JOBS[key])
    return row ? { startedAt: row.lastStartedAt, outcome: row.lastOutcome } : null
  }
  const vision = readVisionLinkConfig()

  return {
    runs: { copec: run("copec"), aramco: run("aramco"), visionlink: run("visionlink") },
    runsFailed: health === failed,
    copecSource: copecSource(),
    aramco: aramco === failed ? EMPTY_ARAMCO : aramco,
    aramcoConfiguredAt: passwordRow === failed ? null : passwordRow[0]?.updatedAt ?? null,
    visionlink: { hasCredentials: vision.hasCredentials, syncEnabled: vision.syncEnabled },
    degraded: [health, aramco, passwordRow].filter((value) => value === failed).length,
  }
}
