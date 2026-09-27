/**
 * PREV-I13-D / PREV-I13-E (tanda T7a): el respaldo del storage de evidencia.
 *
 * I13-D — Un volumen de storage que no montó (vacío o ausente) producía un
 * respaldo "OK" sin un solo archivo, y con retención de 30 días eso termina
 * reemplazando a los respaldos buenos. `backup-storage.sh` además salía con 0
 * cuando le faltaba el destino, así que nadie se enteraba de que no copió nada.
 *
 * I13-E — El ensayo de restauración sólo probaba PostgreSQL. Ahora verifica el
 * tar de storage: sha256 contra el manifiesto, `tar -tzf`, conteo de archivos y
 * que lo que la base restaurada referencia esté dentro del tar.
 *
 * Todo corre contra directorios temporales y binarios de mentira (`pg_dump`,
 * `pg_restore`, `psql`, `docker`, `rclone`) puestos al frente del PATH: estas
 * pruebas nunca tocan una base ni un storage reales.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const root = path.join(__dirname, "..")

let work: string
let bin: string

function stub(name: string, body: string) {
  const file = path.join(bin, name)
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(file, 0o755)
}

beforeEach(() => {
  work = mkdtempSync(path.join(os.tmpdir(), "bodega-i13-"))
  bin = path.join(work, "bin")
  mkdirSync(bin)
  // pg_dump de mentira: deja constancia de que lo llamaron y escribe --file.
  stub("pg_dump", `
echo called >> "${work}/pg_dump.calls"
for arg in "$@"; do case "$arg" in --file=*) printf 'PGDMP-falso' > "\${arg#--file=}" ;; esac; done
exit 0`)
  stub("docker", "exit 1")
  stub("rclone", "exit 1")
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

function run(script: string, env: Record<string, string>, args: string[] = []) {
  const result = spawnSync("bash", [path.join(root, "scripts", script), ...args], {
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      HOME: work,
      TZ: "America/Santiago",
      NODE_ENV: "test",
      ...env,
    },
  })
  return { code: result.status, out: `${result.stdout}${result.stderr}` }
}

function orchestratorEnv(storagePath: string, extra: Record<string, string> = {}) {
  return {
    BACKUP_DIR: path.join(work, "backups"),
    STORAGE_PATH: storagePath,
    // Nunca una base real: el pg_dump de mentira ignora la URL.
    DATABASE_URL: "postgres://stub@127.0.0.1:1/no_existe_test",
    APP_VERSION: "test",
    CLOUDREVE_BACKUP_ENABLED: "false",
    DRIVE_BACKUP_ENABLED: "false",
    BACKUP_ENCRYPTION_PASSPHRASE: "",
    SST_STORAGE_BACKEND: "filesystem",
    ...extra,
  }
}

function latestManifest(): { components: { storage: { file_count: number; sha256: string; file: string } } } {
  const snapshots = path.join(work, "backups", "snapshots")
  const [date] = spawnSync("ls", [snapshots], { encoding: "utf8" }).stdout.trim().split("\n")
  return JSON.parse(readFileSync(path.join(snapshots, date!, "manifest.json"), "utf8"))
}

describe("I13-D — el respaldo no parte con el storage vacío", () => {
  it("storage vacío: aborta ANTES del pg_dump y deja el paso en el estado", () => {
    const storage = path.join(work, "storage")
    mkdirSync(path.join(storage, "pdtp-evidence"), { recursive: true })
    writeFileSync(path.join(storage, ".health-123.tmp"), "x") // no cuenta como archivo

    const { code, out } = run("backup-orchestrator.sh", orchestratorEnv(storage))
    expect(code).not.toBe(0)
    expect(existsSync(path.join(work, "pg_dump.calls"))).toBe(false)
    expect(out).toMatch(/BACKUP_ALLOW_EMPTY_STORAGE/)
    const status = readFileSync(path.join(work, "backups", ".backup-status"), "utf8")
    expect(status).toContain("BACKUP_FAILED_STEP=storage_precondition")
  })

  it("storage ausente: también aborta antes del pg_dump", () => {
    const { code } = run("backup-orchestrator.sh", orchestratorEnv(path.join(work, "no-existe")))
    expect(code).not.toBe(0)
    expect(existsSync(path.join(work, "pg_dump.calls"))).toBe(false)
  })

  it("con BACKUP_ALLOW_EMPTY_STORAGE=true sigue y declara file_count 0", () => {
    const storage = path.join(work, "storage")
    mkdirSync(storage)
    const { code, out } = run("backup-orchestrator.sh", orchestratorEnv(storage, { BACKUP_ALLOW_EMPTY_STORAGE: "true" }))
    expect(code, out).toBe(0)
    expect(existsSync(path.join(work, "pg_dump.calls"))).toBe(true)
    expect(latestManifest().components.storage.file_count).toBe(0)
  })

  it("con archivos, el manifiesto lleva file_count del tar", () => {
    const storage = path.join(work, "storage")
    mkdirSync(path.join(storage, "pdtp-evidence"), { recursive: true })
    mkdirSync(path.join(storage, "risk-map"), { recursive: true })
    writeFileSync(path.join(storage, "pdtp-evidence", "a.pdf"), "A")
    writeFileSync(path.join(storage, "pdtp-evidence", "b.jpg"), "B")
    writeFileSync(path.join(storage, "risk-map", "plano.png"), "P")
    writeFileSync(path.join(storage, ".health-1.tmp"), "x")

    const { code, out } = run("backup-orchestrator.sh", orchestratorEnv(storage))
    expect(code, out).toBe(0)
    const manifest = latestManifest()
    expect(manifest.components.storage.file_count).toBe(3)
    expect(manifest.components.storage.sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("I13-D — backup-storage.sh no calla una copia que no hizo", () => {
  it("sin destino sale con 1", () => {
    const storage = path.join(work, "storage")
    mkdirSync(storage)
    writeFileSync(path.join(storage, "a.pdf"), "A")
    const { code, out } = run("backup-storage.sh", { STORAGE_PATH: storage, RCLONE_DEST: "" })
    expect(code).toBe(1)
    expect(out).toMatch(/RCLONE_DEST/)
  })

  it("sin origen sale con 1", () => {
    const { code } = run("backup-storage.sh", { STORAGE_PATH: path.join(work, "no-existe"), RCLONE_DEST: "remoto:bucket" })
    expect(code).toBe(1)
  })
})

/* ── I13-E ─────────────────────────────────────────────────────────────── */

/** Un directorio de respaldos con dump, snapshot y tar de storage coherentes. */
function makeDrillBackup(files: Record<string, string>, opts: { manifestSha?: string; manifestCount?: number; corruptTar?: boolean } = {}) {
  const backupDir = path.join(work, "backups")
  const snap = path.join(backupDir, "snapshots", "2026-09-26")
  mkdirSync(path.join(backupDir, "pg"), { recursive: true })
  mkdirSync(snap, { recursive: true })
  writeFileSync(path.join(backupDir, "pg", "bodega-latest.dump"), "PGDMP-falso")

  const staging = path.join(work, "staging")
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(staging, "storage", rel)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  mkdirSync(path.join(staging, "storage"), { recursive: true })
  const tar = path.join(snap, "storage.tar.gz")
  if (opts.corruptTar) writeFileSync(tar, "esto no es un gzip")
  else spawnSync("tar", ["-czf", tar, "-C", staging, "storage"])
  const sha = createHash("sha256").update(readFileSync(tar)).digest("hex")
  writeFileSync(path.join(snap, "manifest.json"), JSON.stringify({
    components: { storage: { file: "storage.tar.gz", sha256: opts.manifestSha ?? sha, file_count: opts.manifestCount ?? Object.keys(files).length } },
  }))
  return backupDir
}

/** psql/pg_restore de mentira: una base restaurada con `refs` como referencias. */
function stubRestoredDatabase(refs: string[]) {
  writeFileSync(path.join(work, "refs.txt"), refs.join("\n") + (refs.length ? "\n" : ""))
  stub("pg_restore", "exit 0")
  stub("psql", `
all="$*"
case "$all" in
  *"SELECT 1"*) echo 1 ;;
  *information_schema.tables*) echo 120 ;;
  *"FROM users"*) echo 3 ;;
  *pdtp_executions*) cat "${work}/refs.txt" ;;
  *) : ;;
esac
exit 0`)
}

function drill(backupDir: string, env: Record<string, string> = {}) {
  const { code, out } = run("backup-restore-drill.sh", { BACKUP_DIR: backupDir, DRILL_DATABASE_URL: "", ...env })
  const result = JSON.parse(readFileSync(path.join(backupDir, "restore-drill.json"), "utf8")) as {
    status: string
    issues: string[]
    storage: { files: number; sha256_ok: boolean; references_checked: number; references_missing: number }
  }
  return { code, out, result }
}

describe("I13-E — el ensayo de restauración verifica el tar de storage", () => {
  it("un tar sano con su sha y su conteo no agrega problemas de storage", () => {
    const backupDir = makeDrillBackup({ "pdtp-evidence/a.pdf": "A", "risk-map/p.png": "P" })
    const { code, result } = drill(backupDir)
    // Sin base de ensayo el resultado es WARNING (no se restauró la base),
    // pero el storage sí se verificó.
    expect(code).toBe(1)
    expect(result.storage).toMatchObject({ files: 2, sha256_ok: true })
    expect(result.issues.join(" ")).not.toMatch(/storage/i)
  })

  it("un sha distinto al del manifiesto es CRITICAL", () => {
    const backupDir = makeDrillBackup({ "pdtp-evidence/a.pdf": "A" }, { manifestSha: "0".repeat(64) })
    const { code, result } = drill(backupDir)
    expect(code).toBe(2)
    expect(result.status).toBe("CRITICAL")
    expect(result.storage.sha256_ok).toBe(false)
    expect(result.issues.join(" ")).toMatch(/sha256/i)
  })

  it("un tar que tar -tzf no puede listar es CRITICAL", () => {
    const backupDir = makeDrillBackup({ "pdtp-evidence/a.pdf": "A" }, { corruptTar: true })
    const { code, result } = drill(backupDir)
    expect(code).toBe(2)
    expect(result.issues.join(" ")).toMatch(/tar -tzf/)
  })

  it("un conteo distinto al file_count del manifiesto es CRITICAL", () => {
    const backupDir = makeDrillBackup({ "pdtp-evidence/a.pdf": "A" }, { manifestCount: 5 })
    const { code, result } = drill(backupDir)
    expect(code).toBe(2)
    expect(result.issues.join(" ")).toMatch(/file_count/)
  })

  it("sin tar de storage que ensayar es CRITICAL", () => {
    const backupDir = makeDrillBackup({ "pdtp-evidence/a.pdf": "A" })
    rmSync(path.join(backupDir, "snapshots", "2026-09-26", "storage.tar.gz"))
    const { code, result } = drill(backupDir)
    expect(code).toBe(2)
    expect(result.issues.join(" ")).toMatch(/storage/i)
  })

  it("cruza las referencias de la base restaurada contra el tar", () => {
    const backupDir = makeDrillBackup({ "pdtp-evidence/a.pdf": "A", "risk-map/p.png": "P" })
    stubRestoredDatabase(["storage/pdtp-evidence/a.pdf", "storage/risk-map/p.png"])
    const { code, out, result } = drill(backupDir, { DRILL_DATABASE_URL: "postgres://stub@127.0.0.1:1/drill_test", DRILL_MIN_TABLES: "10" })
    expect(code, out).toBe(0)
    expect(result.storage).toMatchObject({ references_checked: 2, references_missing: 0 })
  })

  it("una referencia que el tar no trae se informa como WARNING con muestra", () => {
    const backupDir = makeDrillBackup({ "pdtp-evidence/a.pdf": "A" })
    stubRestoredDatabase(["storage/pdtp-evidence/a.pdf", "storage/pdtp-evidence/perdida.pdf"])
    const { code, result } = drill(backupDir, { DRILL_DATABASE_URL: "postgres://stub@127.0.0.1:1/drill_test", DRILL_MIN_TABLES: "10" })
    expect(code).toBe(1)
    expect(result.status).toBe("WARNING")
    expect(result.storage).toMatchObject({ references_checked: 2, references_missing: 1 })
    expect(result.issues.join(" ")).toContain("perdida.pdf")
  })
})
