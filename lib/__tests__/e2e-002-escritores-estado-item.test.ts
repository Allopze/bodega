/**
 * E2E-002 (auditoría 2026-09-14) — El estado del ítem de solicitud es el único
 * hilo continuo del flujo de adquisiciones y cinco módulos lo escribían sin que
 * hubiera una máquina de estados declarada como única.
 *
 * La disciplina era real (locks, guardas `WHERE status = ...`, historial), pero
 * la verdad estaba repartida entre `ALLOWED_TRANSITIONS`, los `if` de cada
 * servicio y los rollups: cada escritor nuevo tenía que redescubrir las reglas
 * leyendo a los demás, y nada avisaba si aparecía un sexto.
 *
 * Esta prueba es la costura que faltaba: recorre el código fuente y compara los
 * escritores reales de `purchase_request_items.status` contra el registro
 * declarado en `lib/services/item-state-module/writers.ts`. Antes de la
 * corrección no existía ni el registro ni esta comprobación, así que un
 * escritor nuevo entraba en silencio.
 */
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { ITEM_STATUS_WRITERS } from "@/lib/services/item-state-module/writers"

const ROOT = process.cwd()
const SCANNED_DIRS = ["lib", "app"]
const IGNORED_DIR_NAMES = new Set(["node_modules", "__tests__", ".next"])

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(entry.name)) continue
      sourceFiles(path.join(dir, entry.name), acc)
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    if (/\.test\.tsx?$/.test(entry.name)) continue
    acc.push(path.join(dir, entry.name))
  }
  return acc
}

/**
 * Un archivo "escribe el estado" si actualiza `purchaseRequestItems` (o la
 * tabla en SQL crudo) y en esa misma actualización asigna `status`. La ventana
 * es deliberadamente generosa: es preferible un falso positivo —que obliga a
 * declarar el escritor— a dejar pasar uno de verdad.
 */
const UPDATE_PATTERNS = [
  /update\(\s*(?:schema\.)?purchaseRequestItems\s*\)/g,
  /update\s+"?purchase_request_items"?/gi,
]

function writesItemStatus(source: string): boolean {
  for (const pattern of UPDATE_PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      const window = source.slice(match.index, match.index + 400)
      if (/\bstatus\s*[:=]/.test(window)) return true
    }
  }
  return false
}

describe("E2E-002 — la máquina de estados del ítem es única y declarada", () => {
  const actualWriters = SCANNED_DIRS
    .flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
    .filter((file) => writesItemStatus(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(ROOT, file).split(path.sep).join("/"))
    .sort()

  it("no hay ningún escritor del estado que no esté declarado", () => {
    const declared = new Set(ITEM_STATUS_WRITERS.map((writer) => writer.file))
    const undeclared = actualWriters.filter((file) => !declared.has(file))
    // Si esto falla: o la escritura debe pasar por `lib/services/item-state-module`,
    // o es una excepción legítima (rollback) y hay que enumerarla en `writers.ts`
    // explicando por qué no cabe en `ALLOWED_TRANSITIONS`.
    expect(undeclared).toEqual([])
  })

  it("no quedan escritores declarados que ya no escriban: el registro no envejece", () => {
    const actual = new Set(actualWriters)
    const stale = ITEM_STATUS_WRITERS.map((writer) => writer.file).filter((file) => !actual.has(file))
    expect(stale).toEqual([])
  })

  it("toda excepción fuera del módulo declara su motivo", () => {
    const sinMotivo = ITEM_STATUS_WRITERS
      .filter((writer) => writer.kind !== "state_machine")
      .filter((writer) => writer.reason.trim().length < 40 || writer.writes.trim().length === 0)
      .map((writer) => writer.file)
    expect(sinMotivo).toEqual([])
  })

  it("el módulo de estado es el escritor mayoritario y ninguna excepción vive fuera de las enumeradas", () => {
    const delModulo = ITEM_STATUS_WRITERS.filter((writer) => writer.kind === "state_machine")
    expect(delModulo.every((writer) => writer.file.startsWith("lib/services/item-state-module/"))).toBe(true)
    // Ninguna excepción puede declararse dentro del módulo: si vive ahí, es la
    // máquina y no una excepción.
    const excepcionesDentro = ITEM_STATUS_WRITERS
      .filter((writer) => writer.kind !== "state_machine")
      .filter((writer) => writer.file.startsWith("lib/services/item-state-module/"))
    expect(excepcionesDentro).toEqual([])
  })
})
