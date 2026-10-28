import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  buildOrchestratorEnv,
  describeFailedStep,
  parseBackupStatusFile,
  readBackupStatusForRun,
  successfulBackupCompletion,
} from "./backup-run"

describe("buildOrchestratorEnv", () => {
  it("reenvía el keyring DTE y las llaves que el respaldo debe guardar", () => {
    // El botón no pasaba DTE_SETTINGS_KEYRING: la subida a Cloudreve no podía
    // descifrar sus credenciales y el respaldo abortaba con exit 2.
    const env = buildOrchestratorEnv({
      DTE_SETTINGS_KEYRING: "k",
      AUTH_SECRET: "a",
      PREVENTION_DATA_ENCRYPTION_KEY: "p",
      TZ: "America/Santiago",
    }, {})

    expect(env).toMatchObject({
      DTE_SETTINGS_KEYRING: "k",
      AUTH_SECRET: "a",
      PREVENTION_DATA_ENCRYPTION_KEY: "p",
      TZ: "America/Santiago",
    })
  })

  it("no reenvía variables fuera de la whitelist ni las vacías", () => {
    const env = buildOrchestratorEnv({ SOME_OTHER_SECRET: "x", AUTH_SECRET: "" }, {})

    expect(env).not.toHaveProperty("SOME_OTHER_SECRET")
    expect(env).not.toHaveProperty("AUTH_SECRET")
    expect(env.PATH).toBeTruthy()
    expect(env.HOME).toBeTruthy()
  })

  it("lo que fija quien invoca gana sobre el entorno", () => {
    const env = buildOrchestratorEnv({ RETENTION_DAYS: "30" }, { RETENTION_DAYS: "7", BACKUP_RUN_ID: "r1" })

    expect(env.RETENTION_DAYS).toBe("7")
    expect(env.BACKUP_RUN_ID).toBe("r1")
  })
})

describe("describeFailedStep", () => {
  it("explica la falta de credenciales de Cloudreve (exit 2)", () => {
    const failure = describeFailedStep(parseBackupStatusFile(
      "BACKUP_STATUS=FAILED\nBACKUP_ERROR=exit_code_2\nBACKUP_FAILED_STEP=upload_cloudreve\n",
    ))

    expect(failure.code).toBe("STEP_UPLOAD_CLOUDREVE")
    expect(failure.message).toMatch(/Cloudreve.*credenciales/)
  })

  it("sin estado de la corrida no inventa un paso", () => {
    expect(describeFailedStep(null)).toEqual({
      code: "BACKUP_FAILED",
      message: expect.stringMatching(/sin indicar en qué paso/),
    })
  })

  it("un paso desconocido se nombra tal cual", () => {
    expect(describeFailedStep({ BACKUP_FAILED_STEP: "nuevo_paso" }).message).toContain("nuevo_paso")
  })
})

describe("estado y manifiesto de una corrida", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "backup-run-"))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("ignora el .backup-status de otra corrida", async () => {
    await writeFile(path.join(dir, ".backup-status"), "BACKUP_STATUS=OK\nBACKUP_RUN_ID=anterior\n")

    expect(await readBackupStatusForRun(dir, "esta")).toBeNull()
    expect(await readBackupStatusForRun(dir, "anterior")).toMatchObject({ BACKUP_STATUS: "OK" })
  })

  it("arma las métricas desde el manifiesto y las subidas desde el estado", async () => {
    await mkdir(path.join(dir, "snapshots", "2026-10-26"), { recursive: true })
    await writeFile(path.join(dir, "snapshots", "2026-10-26", "manifest.json"), JSON.stringify({
      backup: { hostname: "srv" },
      components: {
        postgres: { size_bytes: 10, sha256: "pg" },
        storage: { size_bytes: 20, sha256: "st" },
        config: { size_bytes: 3, sha256: "cf" },
      },
      total_size_bytes: 33,
    }))

    const result = await successfulBackupCompletion({
      backupDir: dir,
      status: {
        BACKUP_STATUS: "OK",
        BACKUP_DATE: "2026-10-26",
        BACKUP_MANIFEST_SHA256: "mf",
        BACKUP_CLOUDREVE_UPLOADED: "true",
      },
      cloudrevePath: "backups/plataforma",
      appVersion: "v1",
    })

    expect(result).toMatchObject({
      status: "success",
      pgSizeBytes: 10,
      storageSha256: "st",
      totalSizeBytes: 33,
      manifestSha256: "mf",
      cloudreveUploaded: true,
      cloudrevePath: "backups/plataforma/2026-10-26",
      hostname: "srv",
    })
  })
})
