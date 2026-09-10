import { describe, expect, it } from "vitest"
import { buildBackupStatusCards } from "./backup-health"
import type { BackupStats, DriveHealth } from "@/lib/services/backups"

const emptyStats: BackupStats = {
  lastBackup: null,
  lastSuccess: null,
  lastFailed: null,
  totalBackups: 0,
  successCount: 0,
  failedCount: 0,
  runningCount: 0,
  backupsLast7Days: 0,
  successfulBackupsLast7Days: 0,
  totalSizeBytes: null,
  driveUploaded: false,
  cloudreveUploaded: false,
}

const healthyDrive: DriveHealth = {
  rcloneInstalled: true,
  remoteConfigured: true,
  saJsonPresent: true,
  saValid: true,
  saEmail: "backups@example.test",
  saPath: "/run/secrets/backups.json",
  saDetail: "Cuenta de servicio válida",
  reachable: true,
  lastChecked: "2026-08-02T00:00:00.000Z",
  rcloneConfPath: "/run/rclone.conf",
}

describe("buildBackupStatusCards", () => {
  it("no informa verde ni éxito cuando todavía no existe un respaldo", () => {
    const cards = buildBackupStatusCards(emptyStats, null)

    expect(cards).toHaveLength(3)
    expect(cards[0]).toMatchObject({
      label: "Estado de respaldos",
      value: "Nunca se ha ejecutado un respaldo",
      status: "failed",
    })
    expect(cards[1]).toMatchObject({ status: "failed" })
    expect(cards[2]).toMatchObject({ status: "warning" })
  })

  it("sólo presenta cobertura y destino como exitosos con evidencia positiva", () => {
    const cards = buildBackupStatusCards({
      ...emptyStats,
      lastBackup: {
        id: "backup-1",
        status: "success",
        backupDate: "2026-08-02",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        pgSizeBytes: 1,
        pgSha256: "pg",
        storageSizeBytes: 1,
        storageSha256: "storage",
        configSizeBytes: 1,
        configSha256: "config",
        manifestSha256: "manifest",
        drivePath: "gdrive-backups:/2026-08-02",
        driveUploaded: true,
        cloudrevePath: null,
        cloudreveUploaded: null,
        appVersion: "test",
        hostname: "test",
        totalSizeBytes: 3,
        errorMessage: null,
        errorCode: null,
        trigger: "manual",
        triggeredByUserId: "user-1",
      },
      successfulBackupsLast7Days: 1,
    }, healthyDrive)

    expect(cards.map((card) => card.status)).toEqual(["success", "success", "success"])
  })
})
