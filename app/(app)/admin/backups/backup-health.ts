import type { BackupStats } from "@/lib/services/backups"

export type BackupCardStatus = "success" | "failed" | "running" | "warning" | "none"

export interface BackupStatusCard {
  label: string
  value: string
  status: BackupCardStatus
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return ""
  const hours = Math.floor((Date.now() - new Date(dateStr).getTime()) / 3_600_000)
  if (hours < 1) return "hace menos de 1 hora"
  if (hours < 24) return `hace ${hours} h`
  return `hace ${Math.floor(hours / 24)} días`
}

export interface CloudreveDestinationStatus {
  enabled: boolean
  reachable: boolean | null
}

/** Cloudreve es el único destino remoto: sin él, la copia sólo vive en el servidor. */
function getRemoteDestinationCard(
  cloudreve: CloudreveDestinationStatus | null | undefined,
): BackupStatusCard {
  if (cloudreve?.enabled) {
    if (cloudreve.reachable === true) {
      return { label: "Destino remoto", value: "Cloudreve accesible", status: "success" }
    }
    if (cloudreve.reachable === false) {
      return { label: "Destino remoto", value: "Cloudreve configurado, pero no accesible", status: "failed" }
    }
    return { label: "Destino remoto", value: "Cloudreve activado; sin verificación reciente", status: "warning" }
  }
  return { label: "Destino remoto", value: "Sin destino remoto: la copia queda sólo en el servidor", status: "warning" }
}

/**
 * Presenta únicamente condiciones que cambian una decisión operativa. No se
 * deduce salud desde la ausencia de fallos: una copia nunca ejecutada falla el
 * contrato de recuperabilidad y debe mostrarse como alerta.
 */
export function buildBackupStatusCards(
  stats: BackupStats,
  cloudreve?: CloudreveDestinationStatus | null,
): BackupStatusCard[] {
  const latest = stats.lastBackup
  const lastBackupCard: BackupStatusCard = !latest
    ? {
        label: "Estado de respaldos",
        value: "Nunca se ha ejecutado un respaldo",
        status: "failed",
      }
    : latest.status === "success"
      ? {
          label: "Estado de respaldos",
          value: `Último respaldo exitoso: ${latest.backupDate} (${timeAgo(latest.startedAt)})`,
          status: "success",
        }
      : latest.status === "running"
        ? {
            label: "Estado de respaldos",
            value: `Respaldo en curso desde ${timeAgo(latest.startedAt)}`,
            status: "running",
          }
        : {
            label: "Estado de respaldos",
            value: `El último respaldo falló: ${latest.errorMessage ?? latest.backupDate}`,
            status: "failed",
          }

  const cadenceCard: BackupStatusCard = stats.successfulBackupsLast7Days > 0
    ? {
        label: "Cobertura reciente",
        value: `${stats.successfulBackupsLast7Days} respaldo${stats.successfulBackupsLast7Days === 1 ? "" : "s"} exitoso${stats.successfulBackupsLast7Days === 1 ? "" : "s"} en 7 días`,
        status: "success",
      }
    : {
        label: "Cobertura reciente",
        value: "Sin respaldo exitoso en los últimos 7 días",
        status: "failed",
      }

  return [lastBackupCard, cadenceCard, getRemoteDestinationCard(cloudreve)]
}
