import { describe, expect, it } from "vitest"
import { buildBackupStatusCards } from "./backup-health"
import type { BackupStats } from "@/lib/services/backups"

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
  cloudreveUploaded: false,
}

describe("buildBackupStatusCards", () => {
  it("no informa verde ni éxito cuando todavía no existe un respaldo", () => {
    const cards = buildBackupStatusCards(emptyStats)

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
        cloudrevePath: "backups/plataforma/2026-08-02",
        cloudreveUploaded: true,
        appVersion: "test",
        hostname: "test",
        totalSizeBytes: 3,
        errorMessage: null,
        errorCode: null,
        trigger: "manual",
        triggeredByUserId: "user-1",
      },
      successfulBackupsLast7Days: 1,
    }, { enabled: true, reachable: true })

    expect(cards.map((card) => card.status)).toEqual(["success", "success", "success"])
  })
})
