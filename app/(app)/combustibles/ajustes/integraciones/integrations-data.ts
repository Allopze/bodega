import { settle } from "@/lib/async-settle"
import { readCopecAdminStatus, summarizeCopecStatus, type CopecAdminStatus } from "@/lib/combustibles/copec-settings"
import {
  readVisionLinkAdminStatus,
  summarizeVisionLinkStatus,
  type VisionLinkAdminStatus,
} from "@/lib/integrations/visionlink/visionlink-settings"
import { getCronJobHealth } from "@/lib/services/cron-lock"
import { credentialsOriginText, INTEGRATION_JOBS, type IntegrationKey, type IntegrationRun } from "./integration-status"

export interface IntegrationConfigView<S> {
  hasCredentials: boolean
  syncEnabled: boolean
  /** «guardadas en la plataforma», «del servidor»…; `null` sin credenciales. */
  credentialsOrigin: string | null
  /** DTO seguro para el diálogo: banderas, orígenes y valores no secretos; jamás un secreto. */
  status: S
}

export interface IntegrationsData {
  runs: Record<IntegrationKey, IntegrationRun | null>
  /** `null` si la lectura de corridas falló: la pantalla dice «no se pudo leer» en vez de «sin corridas». */
  runsFailed: boolean
  copec: IntegrationConfigView<CopecAdminStatus>
  visionlink: IntegrationConfigView<VisionLinkAdminStatus>
  degraded: string[]
}

/** Lecturas de «Integraciones». Nunca devuelve un valor secreto: sólo banderas, orígenes y fechas. */
export async function loadIntegrationsData(): Promise<IntegrationsData> {
  const failed = Symbol("failed")
  const [health, copecStatus, visionStatus] = await Promise.all([
    settle<Awaited<ReturnType<typeof getCronJobHealth>> | typeof failed>(getCronJobHealth(30), failed, "ajustes-integraciones-corridas"),
    readCopecAdminStatus(),
    readVisionLinkAdminStatus(),
  ])

  const byJob = new Map((health === failed ? [] : health).map((row) => [row.jobName, row]))
  const run = (key: IntegrationKey): IntegrationRun | null => {
    const row = byJob.get(INTEGRATION_JOBS[key])
    return row ? { startedAt: row.lastStartedAt, outcome: row.lastOutcome } : null
  }

  const copecFields = copecStatus.fields
  const visionFields = visionStatus.fields

  return {
    runs: { copec: run("copec"), visionlink: run("visionlink") },
    runsFailed: health === failed,
    copec: {
      ...summarizeCopecStatus(copecStatus),
      credentialsOrigin: credentialsOriginText([copecFields.username.source, copecFields.password.source, copecFields.clientRut.source]),
      status: copecStatus,
    },
    visionlink: {
      ...summarizeVisionLinkStatus(visionStatus),
      credentialsOrigin: credentialsOriginText([visionFields.clientId.source, visionFields.clientSecret.source]),
      status: visionStatus,
    },
    degraded: health === failed ? ["corridas de las integraciones"] : [],
  }
}
