/**
 * El respaldo se subía cifrado (BACKUP_ENCRYPTION_PASSPHRASE en
 * backup-orchestrator.sh) mientras catastrophic-restore.sh sólo sabía leer
 * archivos en claro: encender la variable dejaba respaldos que nadie podía
 * abrir. Esto fija la costura entre los dos scripts —nombres, algoritmo y el
 * orden descifrar→verificar, porque los sha256 del manifiesto son los del
 * archivo ANTES de cifrar— y ensaya el descifrado de verdad con gpg.
 */
import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { delimiter } from "node:path"

const root = path.join(__dirname, "..")
const orchestrator = readFileSync(path.join(root, "scripts/backup-orchestrator.sh"), "utf8")
const restore = readFileSync(path.join(root, "scripts/catastrophic-restore.sh"), "utf8")
const restoreAll = readFileSync(path.join(root, "scripts/restore-all.sh"), "utf8")
const compose = readFileSync(path.join(root, "docker-compose.yml"), "utf8")

/** Artefactos que el orchestrator cifra, en el orden en que los recorre. */
const ARTIFACTS = ["postgres.dump", "storage.tar.gz", "env-config.tar.gz"]

/**
 * Los dos scripts de restauración descifran con el mismo bloque. `start`/`end`
 * acotan ese bloque para poder ejecutarlo aislado en el ensayo real de abajo.
 */
const RESTORERS = [
  {
    name: "catastrophic-restore.sh",
    script: restore,
    start: "# ── 5b. Descifrar",
    end: 'log "Manifiesto encontrado',
    verifyMarker: 'verify_sha "${RESTORE_TARGET}/postgres.dump"',
  },
  {
    name: "restore-all.sh",
    script: restoreAll,
    start: "# ── Descifrar el snapshot si viene cifrado",
    end: "# Verificar checksums",
    verifyMarker: 'verify_file "${RESTORE_TARGET}/postgres.dump"',
  },
] as const

function hasGpg(): boolean {
  try {
    execFileSync("gpg", ["--version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

describe("costura de cifrado entre backup-orchestrator y catastrophic-restore", () => {
  it("ambos scripts nombran los mismos artefactos con sufijo .gpg", () => {
    const encryptLoop = /for plain in ([^\n;]+); do/.exec(orchestrator)
    expect(encryptLoop, "no se encontró el bucle de cifrado en el orchestrator").toBeTruthy()
    expect(encryptLoop![1]!.trim().split(/\s+/)).toEqual(ARTIFACTS)

    for (const { name, script } of RESTORERS) {
      const decryptList = /SNAPSHOT_FILES=\(([^)]*)\)/.exec(script)
      expect(decryptList, `${name} no declara SNAPSHOT_FILES`).toBeTruthy()
      expect(decryptList![1]!.trim().split(/\s+/)).toEqual(ARTIFACTS)
      expect(script, name).toContain('enc="${RESTORE_TARGET}/${plain}.gpg"')
    }

    expect(orchestrator).toContain('--output "${_UPLOAD_TMP}/${plain}.gpg"')
  })

  it("ambos usan gpg simétrico AES256 con la passphrase por fd 0", () => {
    for (const script of [orchestrator, restore, restoreAll]) {
      expect(script).toContain("--passphrase-fd 0 --pinentry-mode loopback")
      expect(script).toContain("printf '%s' \"${BACKUP_ENCRYPTION_PASSPHRASE}\"")
    }
    expect(orchestrator).toContain("--symmetric --cipher-algo AES256")
    expect(restore).toContain("--decrypt")
  })

  it.each(RESTORERS)("$name descifra ANTES de verificar checksums", ({ script, verifyMarker }) => {
    const decryptAt = script.indexOf("Descifrando snapshot antes de verificar checksums")
    const verifyAt = script.indexOf(verifyMarker)
    expect(decryptAt).toBeGreaterThan(0)
    expect(verifyAt).toBeGreaterThan(0)
    // Al revés todos los checksums fallarían en falso: el manifiesto guarda los
    // sha256 del archivo en claro. En restore-all además se reportaban como
    // "ARCHIVO FALTANTE", porque con snapshot cifrado el plano ni existe.
    expect(decryptAt).toBeLessThan(verifyAt)
  })

  it("el orchestrator comprueba que puede volver a abrir lo que cifró, antes de subirlo", () => {
    const encryptAt = orchestrator.indexOf("--symmetric --cipher-algo AES256")
    const rehearsalAt = orchestrator.indexOf('--output /dev/null "${_UPLOAD_TMP}/${plain}.gpg"')
    const uploadAt = orchestrator.indexOf('rclone copy "${UPLOAD_SRC}/"')
    expect(rehearsalAt, "falta el ensayo de descifrado previo a la subida").toBeGreaterThan(encryptAt)
    expect(rehearsalAt).toBeLessThan(uploadAt)
    expect(orchestrator).toContain("NO se sube un snapshot ilegible")
  })

  it("docker-compose entrega la passphrase a los DOS servicios que respaldan", () => {
    // Sin esto la variable existe en el host y no dentro del contenedor: el
    // snapshot sube EN CLARO mientras la configuración dice que va cifrado.
    // Son dos servicios, no uno: `backup-scheduler` corre el respaldo diario y
    // `app` corre el manual del panel de Administración. Con la variable en uno
    // solo, media copia queda en claro y la configuración afirma lo contrario.
    const lines = [...compose.matchAll(/^ +- BACKUP_ENCRYPTION_PASSPHRASE=.*$/gm)]
    expect(lines.length, "docker-compose.yml no pasa BACKUP_ENCRYPTION_PASSPHRASE").toBeGreaterThan(0)
    for (const line of lines) {
      // Passthrough, jamás un valor literal versionado.
      expect(line[0].trim()).toBe("- BACKUP_ENCRYPTION_PASSPHRASE=${BACKUP_ENCRYPTION_PASSPHRASE:-}")
    }

    /** Rango [inicio, fin) del bloque de un servicio de primer nivel. */
    const serviceRange = (name: string): [number, number] => {
      const start = compose.indexOf(`\n  ${name}:`)
      expect(start, `docker-compose.yml no define el servicio ${name}`).toBeGreaterThanOrEqual(0)
      const rest = compose.slice(start + 1)
      const next = rest.search(/\n {2}[a-z][\w-]*:\n/)
      return [start, next === -1 ? compose.length : start + 1 + next]
    }

    for (const service of ["app", "backup-scheduler"]) {
      const [start, end] = serviceRange(service)
      const dentro = lines.some((line) => line.index! > start && line.index! < end)
      expect(dentro, `el servicio ${service} no recibe BACKUP_ENCRYPTION_PASSPHRASE`).toBe(true)
    }
  })

  it("la passphrase nunca entra a la whitelist del .env respaldado", () => {
    const whitelist = /ENV_WHITELIST=\(([\s\S]*?)\n\)/.exec(orchestrator)?.[1] ?? ""
    expect(whitelist).not.toContain("BACKUP_ENCRYPTION_PASSPHRASE")
  })

  it("el .env físico se respalda sin la passphrase que cifra ese mismo respaldo", () => {
    expect(orchestrator, "un `cp` del .env mete la llave dentro del candado")
      .not.toContain('cp /srv/bodega/.env "${_CONFIG_TMP}/.env"')

    const pattern = /grep -Ev '([^']+)'/.exec(orchestrator)?.[1]
    expect(pattern, "el orchestrator ya no filtra el .env").toBeTruthy()

    // El patrón es lo que carga el peso: se ejercita contra un .env de mentira.
    const dir = mkdtempSync(path.join(os.tmpdir(), "bodega-env-"))
    try {
      const envFile = path.join(dir, ".env")
      writeFileSync(envFile, [
        "DATABASE_URL=postgres:///bodega",
        "BACKUP_ENCRYPTION_PASSPHRASE=secreto-de-verdad",
        "  export BACKUP_ENCRYPTION_PASSPHRASE=secreto-de-verdad",
        "BACKUP_ENCRYPTION_PASSPHRASE_HINT=caja-fuerte",
        "AUTH_SECRET=abc",
        "",
      ].join("\n"))
      const filtered = execFileSync("bash", ["-c", `grep -Ev '${pattern}' "$1" || true`, "bash", envFile], {
        encoding: "utf8",
      })
      expect(filtered).not.toContain("secreto-de-verdad")
      expect(filtered).toContain("DATABASE_URL=postgres:///bodega")
      expect(filtered).toContain("AUTH_SECRET=abc")
      // El _HINT no es la llave: no hay que perderlo de paso.
      expect(filtered).toContain("BACKUP_ENCRYPTION_PASSPHRASE_HINT=caja-fuerte")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("el .env.example documenta la variable sin un valor real", () => {
    const example = readFileSync(path.join(root, ".env.example"), "utf8")
    expect(example).toContain("BACKUP_ENCRYPTION_PASSPHRASE=\n")
  })

  it("backup-verify.sh --json escribe JSON puro en stdout", () => {
    // app/api/backups/status/route.ts hace JSON.parse(stdout): cualquier línea
    // legible mezclada ahí (las nuestras del ensayo de descifrado incluidas)
    // dejaba el estado de los respaldos fuera de la UI.
    const dir = mkdtempSync(path.join(os.tmpdir(), "bodega-verify-"))
    let stdout = ""
    try {
      // El contrato debe funcionar también en hosts mínimos donde jq no está
      // instalado. Si jq existe, se oculta sólo para esta prueba y se conserva
      // el resto del PATH para no convertirla en un test de otro binario.
      const jqPath = (() => {
        try {
          return execFileSync("bash", ["-c", "command -v jq || true"], { encoding: "utf8" }).trim()
        } catch {
          return ""
        }
      })()
      const jqDir = jqPath ? path.dirname(jqPath) : null
      const pathWithoutJq = (process.env.PATH ?? "")
        .split(delimiter)
        .filter((entry) => !jqDir || entry !== jqDir)
        .join(delimiter)
      stdout = execFileSync("bash", [path.join(root, "scripts/backup-verify.sh"), "--json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, PATH: pathWithoutJq, BACKUP_DIR: dir, STORAGE_PATH: path.join(dir, "storage") },
      })
    } catch (err) {
      // Sin respaldos sale con 2 (CRITICAL); el stdout sigue siendo el JSON.
      stdout = (err as { stdout?: string }).stdout ?? ""
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    const parsed = JSON.parse(stdout)
    expect(parsed.status).toBe("CRITICAL")
    expect(parsed.exit_code).toBe(2)
  })
})

describe.runIf(hasGpg()).each(RESTORERS)("ensayo real de descifrado — $name", ({ name, script, start: startMarker, end: endMarker }) => {
  /** Bloque de descifrado del script real, ejecutado con dependencias mínimas. */
  function runDecryptBlock(dir: string, passphrase: string | null): { code: number; out: string } {
    const start = script.indexOf(startMarker)
    const end = script.indexOf(endMarker, start)
    expect(start, `cambió el marcador del bloque de descifrado en ${name}`).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)

    const harness = [
      "set -uo pipefail",
      "log()   { echo \"[log] $*\"; }",
      "error() { echo \"[ERROR] $*\"; }",
      "DRY_RUN=false",
      'RESTORE_DATE="2026-08-20"',
      'ORIGINAL_ARGS="--service-account-json /tmp/sa.json"',
      `RESTORE_TARGET=${JSON.stringify(dir)}`,
      'MANIFEST="${RESTORE_TARGET}/manifest.json"',
      script.slice(start, end),
    ].join("\n")

    const harnessPath = path.join(dir, "..", "harness.sh")
    writeFileSync(harnessPath, harness)
    try {
      const out = execFileSync("bash", [harnessPath], {
        encoding: "utf8",
        env: passphrase === null
          ? { ...process.env, BACKUP_ENCRYPTION_PASSPHRASE: undefined }
          : { ...process.env, BACKUP_ENCRYPTION_PASSPHRASE: passphrase },
      })
      return { code: 0, out }
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string }
      return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }
    }
  }

  /** Fabrica un snapshot igual al que sube el orchestrator. */
  function makeSnapshot(passphrase: string | null): string {
    const base = mkdtempSync(path.join(os.tmpdir(), "bodega-snapshot-"))
    const dir = path.join(base, "restore")
    execFileSync("mkdir", ["-p", dir])
    const shas: Record<string, string> = {}
    for (const name of ARTIFACTS) {
      const plain = path.join(base, name)
      writeFileSync(plain, `contenido-de-${name}`)
      shas[name] = createHash("sha256").update(readFileSync(plain)).digest("hex")
      if (passphrase === null) {
        execFileSync("cp", [plain, path.join(dir, name)])
      } else {
        execFileSync(
          "bash",
          ["-c",
            `printf '%s' "$PASS" | gpg --batch --quiet --yes --symmetric --cipher-algo AES256 ` +
            `--passphrase-fd 0 --pinentry-mode loopback --output ${JSON.stringify(path.join(dir, `${name}.gpg`))} ` +
            JSON.stringify(plain)],
          { env: { ...process.env, PASS: passphrase } },
        )
      }
    }
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
      components: {
        postgres: { sha256: shas["postgres.dump"] },
        storage:  { sha256: shas["storage.tar.gz"] },
        config:   { sha256: shas["env-config.tar.gz"] },
      },
      upload: { encrypted: passphrase !== null },
    }))
    return dir
  }

  it("descifra el snapshot y deja los archivos en claro con permisos 600", () => {
    const dir = makeSnapshot("passphrase-de-prueba")
    try {
      const { code, out } = runDecryptBlock(dir, "passphrase-de-prueba")
      expect(out).toContain("descifrado")
      expect(code).toBe(0)
      for (const name of ARTIFACTS) {
        expect(readFileSync(path.join(dir, name), "utf8")).toBe(`contenido-de-${name}`)
        expect(statSync(path.join(dir, name)).mode & 0o777).toBe(0o600)
      }
    } finally {
      rmSync(path.join(dir, ".."), { recursive: true, force: true })
    }
  })

  it("sin la passphrase aborta diciendo qué falta y dónde está guardada", () => {
    const dir = makeSnapshot("passphrase-de-prueba")
    try {
      const { code, out } = runDecryptBlock(dir, null)
      expect(code).toBe(1)
      expect(out).toContain("IRRECUPERABLE")
      expect(out).toContain("Gestor de secretos corporativo")
      expect(out).toContain("RESPALDOS_Y_RESTAURACION.md")
      expect(out).not.toContain("gpg: decryption failed")
      expect(existsSync(path.join(dir, "postgres.dump"))).toBe(false)
    } finally {
      rmSync(path.join(dir, ".."), { recursive: true, force: true })
    }
  })

  it("con la passphrase equivocada aborta y no deja un dump a medio descifrar", () => {
    const dir = makeSnapshot("passphrase-de-prueba")
    try {
      const { code, out } = runDecryptBlock(dir, "la-que-se-rotó-ayer")
      expect(code).toBe(1)
      expect(out).toContain("no corresponde a ESTE snapshot")
      expect(existsSync(path.join(dir, "postgres.dump"))).toBe(false)
    } finally {
      rmSync(path.join(dir, ".."), { recursive: true, force: true })
    }
  })

  it("un snapshot en claro sigue restaurándose igual que antes", () => {
    const dir = makeSnapshot(null)
    try {
      const { code, out } = runDecryptBlock(dir, "passphrase-de-prueba")
      expect(code).toBe(0)
      expect(out).not.toContain("Descifrando snapshot")
    } finally {
      rmSync(path.join(dir, ".."), { recursive: true, force: true })
    }
  })

  it("si falta un .gpg no restaura a ciegas", () => {
    const dir = makeSnapshot("passphrase-de-prueba")
    try {
      rmSync(path.join(dir, "storage.tar.gz.gpg"))
      const { code, out } = runDecryptBlock(dir, "passphrase-de-prueba")
      expect(code).toBe(1)
      expect(out).toContain("Snapshot incompleto")
    } finally {
      rmSync(path.join(dir, ".."), { recursive: true, force: true })
    }
  })
})
