/**
 * scripts/np-recalcular-estados.ts
 *
 * Lleva las notas de pedido (NP) anteriores a la migración 0405 al estado que corresponde a sus líneas con las reglas nuevas
 * (`aceptada`, `recibida_parcial`; ADR mantención 0001, 2026-11-27). Se corre UNA vez, DESPUÉS del despliegue (migración 0405 →
 * `db:sync-rbac` → servidor → este script → app del teléfono). Detalle de qué toca en
 * `lib/services/mantencion/parts-notes/recalc-legacy.ts`.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/np-recalcular-estados.ts            # simulación (por defecto): no escribe nada
 *   npx tsx --env-file-if-exists=.env.local scripts/np-recalcular-estados.ts --apply    # escribe
 *
 * - Sólo notas de la plataforma (las importadas de CHOME ERP no) y no anuladas.
 * - Idempotente: la segunda corrida no cambia nada. Cada cambio deja un evento automático (sin actor) con el motivo
 *   «Recálculo por estados nuevos (0405)».
 * - Se conecta con el `db` del repo (DATABASE_URL).
 */
import { pathToFileURL } from "node:url"
import { db } from "@/db"
import { recalcLegacyNoteStatuses, type LegacyRecalcResult } from "@/lib/services/mantencion/parts-notes/recalc-legacy"

export function parseArgs(argv: string[]): { apply: boolean } {
  const unknown = argv.slice(2).filter((arg) => arg.startsWith("--") && arg !== "--apply")
  if (unknown.length) throw new Error(`Opción desconocida: ${unknown.join(", ")}.`)
  return { apply: argv.includes("--apply") }
}

export function formatSummary(result: LegacyRecalcResult): string {
  const lines = [
    `Notas revisadas: ${result.total}`,
    `${result.applied ? "Notas actualizadas" : "Notas que se actualizarían"}: ${result.changed.length}`,
  ]
  for (const change of result.changed) lines.push(`  ${change.code}: ${change.from} -> ${change.to}`)
  return lines.join("\n")
}

export async function main(argv = process.argv) {
  const { apply } = parseArgs(argv)
  console.log(`Recálculo de estados de notas de pedido (0405) — ${apply ? "ESCRIBIENDO" : "simulación (no se guarda nada)"}`)
  const result = await recalcLegacyNoteStatuses(db, { apply })
  console.log(`\n${formatSummary(result)}`)
  console.log(apply ? "\nAplicado." : "\nSimulación terminada: no se escribió nada. Vuelve a correr con --apply para guardar.")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}
