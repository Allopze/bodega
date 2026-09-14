/**
 * `RES-001` (auditoría 2026-09-14): la verificación diaria comprueba que el
 * respaldo exista, pese lo suyo y que la passphrase abra el snapshot cifrado;
 * nunca comprobaba que el dump se pudiera **restaurar**. Un dump truncado a
 * mitad de escritura pasa las tres comprobaciones y falla el día del desastre.
 *
 * Esto fija las tres costuras del ensayo: que corra con periodicidad
 * (`backup-scheduler.sh`), que deje su resultado donde el monitoreo lo lea, y
 * que `backup-verify.sh` convierta ese resultado —o su ausencia— en la misma
 * alerta que el resto de los respaldos.
 */
import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, utimesSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const root = path.join(__dirname, "..")
const drill = readFileSync(path.join(root, "scripts/backup-restore-drill.sh"), "utf8")
const scheduler = readFileSync(path.join(root, "scripts/backup-scheduler.sh"), "utf8")

/** Corre backup-verify.sh contra un directorio de respaldos de mentira. */
function runVerify(backupDir: string, env: Record<string, string> = {}) {
  try {
    const stdout = execFileSync("bash", [path.join(root, "scripts/backup-verify.sh"), "--json"], {
      encoding: "utf8",
      env: { ...process.env, BACKUP_DIR: backupDir, STORAGE_PATH: path.join(backupDir, "storage"), DRIVE_BACKUP_ENABLED: "false", ...env },
      stdio: ["ignore", "pipe", "ignore"],
    })
    return { code: 0, json: JSON.parse(stdout) as { status: string; issues: string[] } }
  } catch (error) {
    const err = error as { status: number; stdout: string }
    return { code: err.status, json: JSON.parse(err.stdout) as { status: string; issues: string[] } }
  }
}

/** Un directorio de respaldos con un dump y un snapshot recientes: todo verde salvo lo que se altere. */
function makeBackupDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bodega-drill-"))
  mkdirSync(path.join(dir, "pg"), { recursive: true })
  mkdirSync(path.join(dir, "storage"), { recursive: true })
  mkdirSync(path.join(dir, "snapshots", "2026-09-14"), { recursive: true })
  writeFileSync(path.join(dir, "pg", "bodega-latest.dump"), "PGDMP-falso")
  return dir
}

describe("el ensayo de restauración tiene periodicidad", () => {
  it("el scheduler lo invoca junto al respaldo diario", () => {
    expect(scheduler).toContain("backup-restore-drill.sh")
    expect(scheduler).toMatch(/RESTORE_DRILL_WEEKDAY/)
    // Un fallo del ensayo no puede matar el bucle del respaldo: el respaldo
    // diario tiene que seguir corriendo aunque la restauración salga mal.
    expect(scheduler).toMatch(/"\$DRILL_SCRIPT" \|\| error/)
  })

  it("nunca restaura sobre una base que no sea la desechable", () => {
    // El ensayo hace DROP SCHEMA: la única defensa es que la base venga por una
    // variable propia, jamás por DATABASE_URL.
    expect(drill).toContain("DRILL_DATABASE_URL")
    expect(drill).not.toMatch(/DATABASE_URL:-postgres/)
    expect(drill.includes("${DATABASE_URL")).toBe(false)
  })

  it("ensaya el artefacto que se restauraría de verdad, no uno hecho al momento", () => {
    expect(drill).toContain("bodega-latest.dump")
    expect(drill).not.toContain("pg_dump")
  })
})

describe("el resultado del ensayo llega al canal de backup-verify", () => {
  it("sin ensayo previo, la verificación diaria avisa", () => {
    const dir = makeBackupDir()
    try {
      const { json } = runVerify(dir)
      expect(json.issues.join(" ")).toContain("Nunca se ha ensayado la restauración")
      expect(json.status).not.toBe("OK")
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it("un ensayo reciente y exitoso no genera alerta", () => {
    const dir = makeBackupDir()
    try {
      writeFileSync(path.join(dir, "restore-drill.json"), JSON.stringify({ status: "OK", exit_code: 0, tables_restored: 312, issues: [] }))
      const { json } = runVerify(dir)
      expect(json.issues.join(" ")).not.toContain("ensayo de restauración")
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it("un ensayo fallido es CRITICAL, no un aviso menor", () => {
    const dir = makeBackupDir()
    try {
      writeFileSync(path.join(dir, "restore-drill.json"), JSON.stringify({ status: "CRITICAL", exit_code: 2, issues: ["0 tablas"] }))
      const { code, json } = runVerify(dir)
      expect(json.status).toBe("CRITICAL")
      expect(code).toBe(2)
      expect(json.issues.join(" ")).toContain("no es restaurable")
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it("un ensayo viejo cuenta como no haberlo hecho", () => {
    const dir = makeBackupDir()
    try {
      const file = path.join(dir, "restore-drill.json")
      writeFileSync(file, JSON.stringify({ status: "OK", exit_code: 0, issues: [] }))
      const old = Date.now() / 1000 - 30 * 86400
      utimesSync(file, old, old)
      const { json } = runVerify(dir)
      expect(json.issues.join(" ")).toContain("30 días")
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe("el ensayo deja constancia incluso cuando no puede ejecutarse", () => {
  it("sin base desechable avisa, pero no declara roto el respaldo", () => {
    const dir = makeBackupDir()
    try {
      let code = 0
      try {
        execFileSync("bash", [path.join(root, "scripts/backup-restore-drill.sh")], {
          encoding: "utf8", stdio: "ignore",
          env: { ...process.env, BACKUP_DIR: dir, DRILL_DATABASE_URL: "" },
        })
      } catch (error) { code = (error as { status: number }).status }

      expect(code).toBe(1)
      const result = JSON.parse(readFileSync(path.join(dir, "restore-drill.json"), "utf8"))
      expect(result.status).toBe("WARNING")
      expect(result.issues.join(" ")).toContain("no se ejecutó")
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it("sin dump que ensayar es CRITICAL", () => {
    const dir = makeBackupDir()
    try {
      rmSync(path.join(dir, "pg", "bodega-latest.dump"))
      let code = 0
      try {
        execFileSync("bash", [path.join(root, "scripts/backup-restore-drill.sh")], {
          encoding: "utf8", stdio: "ignore",
          env: { ...process.env, BACKUP_DIR: dir, DRILL_DATABASE_URL: "postgres:///no-existe" },
        })
      } catch (error) { code = (error as { status: number }).status }

      expect(code).toBe(2)
      const result = JSON.parse(readFileSync(path.join(dir, "restore-drill.json"), "utf8"))
      expect(result.status).toBe("CRITICAL")
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
