import { settle } from "@/lib/async-settle"
import { readVisionLinkConfig } from "@/lib/integrations/visionlink/visionlink-settings"
import { getCronJobHealth } from "@/lib/services/cron-lock"
import { INTEGRATION_JOBS, type IntegrationKey, type IntegrationRun } from "./integration-status"

export interface IntegrationsData {
  runs: Record<IntegrationKey, IntegrationRun | null>
  /** `null` si la lectura de corridas falló: la pantalla dice «no se pudo leer» en vez de «sin corridas». */
  runsFailed: boolean
  visionlink: { hasCredentials: boolean; syncEnabled: boolean }
  degraded: number
}

/** Lecturas de «Integraciones». Nunca devuelve un valor secreto: sólo banderas y fechas. */
export async function loadIntegrationsData(): Promise<IntegrationsData> {
  const failed = Symbol("failed")
  const health = await settle<Awaited<ReturnType<typeof getCronJobHealth>> | typeof failed>(getCronJobHealth(30), failed, "ajustes-integraciones-corridas")

  const byJob = new Map((health === failed ? [] : health).map((row) => [row.jobName, row]))
  const run = (key: IntegrationKey): IntegrationRun | null => {
    const row = byJob.get(INTEGRATION_JOBS[key])
    return row ? { startedAt: row.lastStartedAt, outcome: row.lastOutcome } : null
  }
  const vision = readVisionLinkConfig()

  return {
    runs: { copec: run("copec"), visionlink: run("visionlink") },
    runsFailed: health === failed,
    visionlink: { hasCredentials: vision.hasCredentials, syncEnabled: vision.syncEnabled },
    degraded: health === failed ? 1 : 0,
  }
}
