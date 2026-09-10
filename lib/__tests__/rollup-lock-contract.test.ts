/**
 * DAT-1 se cerró moviendo el lock del padre a los callers de
 * `rollupRequestStatus`. Eso deja la corrección repartida en 6 archivos, así
 * que es exactamente el tipo de invariante que se rompe sola: quien agregue una
 * transición de ítem nueva copiará el `await rollupRequestStatus(...)` del
 * vecino y no el `await lockRequestsForRollupTx(...)` que va arriba.
 *
 * `rollup-concurrency-postgres.test.ts` prueba que la carrera está cerrada,
 * pero sólo para el camino de aprobación y sólo contra Postgres real (está
 * detrás de un gate de entorno). Este test es el contrato estático que cubre a
 * todos los callers en cada corrida.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const repoRoot = process.cwd()

/** El propio módulo del rollup define ambas funciones; no es un caller. */
const SELF = "lib/services/item-state-module/rollup.ts"

function collectFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return collectFiles(full)
    return /\.ts$/.test(entry) && !/\.test\.ts$/.test(entry) ? [full] : []
  })
}

function countIn(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0
}

const rollupCallers = collectFiles(path.join(repoRoot, "lib"))
  .map((file) => ({
    relative: path.relative(repoRoot, file).replaceAll(path.sep, "/"),
    source: readFileSync(file, "utf8"),
  }))
  .filter(({ relative }) => relative !== SELF)
  .map((entry) => ({
    ...entry,
    rollups: countIn(entry.source, /await rollupRequestStatus\(/g),
    locks: countIn(entry.source, /await lockRequestsForRollupTx\(/g),
  }))
  .filter(({ rollups }) => rollups > 0)
  .sort((a, b) => a.relative.localeCompare(b.relative))

describe("contrato del lock del rollup (DAT-1)", () => {
  it("todo archivo que hace rollup del padre lo lockea antes, y al menos tantas veces", () => {
    const offenders = rollupCallers
      .filter(({ rollups, locks }) => locks < rollups)
      .map(({ relative, rollups, locks }) => `${relative}: ${rollups} rollup(s) y ${locks} lock(s)`)

    expect(
      offenders,
      "un caller del rollup sin su lock reabre DAT-1: el padre queda con un estado derivado obsoleto",
    ).toEqual([])
  })

  it("los callers conocidos siguen siendo los mismos (si aparece uno nuevo, revisa su orden de locks)", () => {
    // El orden de locks es siempre ítems → padre (ver `cancelRequest`), y entre
    // solicitudes, léxico. Invertirlo en un caller nuevo deadlockea contra los
    // demás, así que esta lista existe para que agregar uno sea una decisión
    // consciente y no un copy-paste.
    expect(rollupCallers.map(({ relative }) => relative)).toEqual([
      "lib/services/item-state-module/approval.ts",
      "lib/services/item-state-module/purchase-order.ts",
      "lib/services/item-state-module/receiving.ts",
      "lib/services/purchasing-module/purchase-orders-delete.ts",
      "lib/services/purchasing-module/purchase-orders-status.ts",
      "lib/services/purchasing-module/receiving.ts",
      // Caller nuevo: el reconciliador de estados, que corre en el deploy.
      // Lockea el padre y **no** los ítems, porque no los muta: sólo los lee
      // para derivar. Eso no reabre DAT-1 ni puede deadlockear contra los
      // otros. El ciclo necesitaría que este caller esperara algo que otro
      // tiene, y no espera nada: toma `FOR UPDATE` del padre antes de
      // cualquier lectura, y el `SELECT` de ítems del rollup no bloquea bajo
      // MVCC. Un `approval.ts` concurrente que tenga los ítems y espere el
      // padre simplemente espera a que este termine y suelte.
      "lib/services/request-status-reconciliation.ts",
    ])
  })
})
