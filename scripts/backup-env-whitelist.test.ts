/**
 * El respaldo de configuración se generó durante meses desde una whitelist a
 * mano que nunca incluyó `DTE_SETTINGS_KEYRING`: guardaba los sobres cifrados
 * del dump y descartaba la llave que los abre. Mantenerla a mano es lo que
 * produjo el hueco, así que esto falla si el compose gana una variable que el
 * respaldo no guardaría.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

const root = path.join(__dirname, "..")

/** Nombres de variable que docker-compose.yml inyecta al servicio `app`. */
function composeAppEnvVars(): string[] {
  const compose = readFileSync(path.join(root, "docker-compose.yml"), "utf8").split("\n")
  const start = compose.findIndex((line) => line === "  app:")
  expect(start).toBeGreaterThanOrEqual(0)
  const end = compose.findIndex((line, index) => index > start && /^ {2}[a-z][\w-]*:$/.test(line))
  const names = new Set<string>()
  for (const line of compose.slice(start, end === -1 ? compose.length : end)) {
    const match = /^ {6}- ([A-Z0-9_]+)=/.exec(line)
    if (match) names.add(match[1]!)
  }
  return [...names]
}

function orchestratorWhitelist(): string[] {
  const script = readFileSync(path.join(root, "scripts/backup-orchestrator.sh"), "utf8")
  const block = /ENV_WHITELIST=\(([\s\S]*?)\n\)/.exec(script)
  expect(block).not.toBeNull()
  return block![1]!
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .flatMap((line) => (line ? line.split(/\s+/) : []))
}

/**
 * Variables que el compose SÍ inyecta y el respaldo NO debe guardar. Excluir
 * algo de aquí exige una razón de seguridad, no comodidad: cada nombre en esta
 * lista es una variable que se pierde en un restore y hay que reponer a mano.
 */
const DELIBERADAMENTE_FUERA: Record<string, string> = {
  // Es la llave con la que se cifra el propio snapshot: guardarla dentro de lo
  // que cifra anula el cifrado. Vive en el gestor de secretos, no en el tar.
  BACKUP_ENCRYPTION_PASSPHRASE:
    "cifra el snapshot: no puede viajar dentro de él (ver docs/deploy/RESPALDOS_Y_RESTAURACION.md)",
}

describe("backup-orchestrator ENV_WHITELIST", () => {
  it("cubre todas las variables que el compose inyecta al servicio app", () => {
    const whitelist = new Set(orchestratorWhitelist())
    const missing = composeAppEnvVars()
      .filter((name) => !(name in DELIBERADAMENTE_FUERA))
      .filter((name) => !whitelist.has(name))

    expect(missing).toEqual([])
  })

  it("las exclusiones deliberadas no están en la whitelist por descuido", () => {
    const whitelist = new Set(orchestratorWhitelist())
    const coladas = Object.keys(DELIBERADAMENTE_FUERA).filter((name) => whitelist.has(name))

    expect(coladas).toEqual([])
  })

  it("no guarda la passphrase con la que se cifra el propio snapshot", () => {
    expect(orchestratorWhitelist()).not.toContain("BACKUP_ENCRYPTION_PASSPHRASE")
  })
})
