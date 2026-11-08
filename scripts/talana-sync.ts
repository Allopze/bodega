/**
 * scripts/talana-sync.ts
 *
 * Corre la sincronización de trabajadores con Talana a mano, fuera del cron
 * diario. Pensado para probarla contra una base de desarrollo antes de dejarla
 * correr sola:
 *
 *   npx tsx --env-file=.env.local scripts/talana-sync.ts            # simulación
 *   npx tsx --env-file=.env.local scripts/talana-sync.ts --apply    # aplica
 *
 * Por defecto SIMULA, sin importar `TALANA_SYNC_MODE` (que sólo gobierna al
 * cron): descarga, guarda la copia local y calcula lo que haría, sin tocar
 * trabajadores. `--apply` fuerza el modo `apply`. Necesita `TALANA_API_TOKEN`.
 *
 * Toma el mismo candado que el cron (`talana-workers-sync`), así que no se pisa
 * con una corrida programada. Imprime el estado, la razón del fusible y los
 * contadores, y un resumen de los ítems de la corrida por tipo/resultado/motivo.
 * NUNCA imprime RUT ni nombres: el detalle por persona se revisa en la base.
 *
 * Código de salida: 0 si la corrida terminó (aun `partial` o `blocked`: se leen
 * en lo impreso); 1 si falló, si otra corrida tenía el candado o si falta el token.
 */
import { pathToFileURL } from "node:url"
import { asc, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { talanaSyncRunItems } from "@/db/schema"
import { readTalanaConfig } from "@/lib/integrations/talana/talana-settings"
import {
  runTalanaSync,
  TalanaSyncFailure,
  type TalanaRunMode,
  type TalanaSyncResult,
} from "@/lib/integrations/talana/talana-sync"
import { withCronLock } from "@/lib/services/cron-lock"

interface ItemTally {
  kind: string
  outcome: string
  reasonCode: string | null
  count: number
}

/** Cuántos ítems hay por tipo, resultado y motivo: sólo agregados, sin personas. */
async function tallyRunItems(runId: string): Promise<ItemTally[]> {
  const rows = await db
    .select({
      kind: talanaSyncRunItems.kind,
      outcome: talanaSyncRunItems.outcome,
      reasonCode: talanaSyncRunItems.reasonCode,
      count: sql<number>`count(*)::int`,
    })
    .from(talanaSyncRunItems)
    .where(eq(talanaSyncRunItems.runId, runId))
    .groupBy(talanaSyncRunItems.kind, talanaSyncRunItems.outcome, talanaSyncRunItems.reasonCode)
    .orderBy(asc(talanaSyncRunItems.kind), asc(talanaSyncRunItems.outcome), asc(talanaSyncRunItems.reasonCode))
  return rows
}

function printResult(result: TalanaSyncResult, tally: ItemTally[]) {
  console.log(`\nCorrida ${result.runId}`)
  console.log(`  modo:    ${result.mode}`)
  console.log(`  estado:  ${result.status}`)
  console.log(`  fusible: ${result.fusibleReason ?? "no disparó"}`)
  console.log("\nContadores")
  for (const [name, value] of Object.entries(result.counts)) {
    console.log(`  ${name.padEnd(20)} ${value}`)
  }
  console.log("\nÍtems de la corrida (tipo / resultado / motivo)")
  if (tally.length === 0) console.log("  ninguno")
  for (const row of tally) {
    console.log(`  ${row.kind.padEnd(14)} ${row.outcome.padEnd(9)} ${(row.reasonCode ?? "-").padEnd(32)} ${row.count}`)
  }
}

export async function main(argv = process.argv): Promise<number> {
  const mode: TalanaRunMode = argv.includes("--apply") ? "apply" : "simulate"
  const { token, hasCredentials } = readTalanaConfig()
  if (!hasCredentials) {
    console.error("Falta TALANA_API_TOKEN en el entorno (revisa .env.local).")
    return 1
  }

  console.log(`Sincronización con Talana — modo ${mode}${mode === "simulate" ? " (no toca trabajadores)" : ""}`)
  let outcome: TalanaSyncResult | { skipped: true; reason: string }
  try {
    outcome = await withCronLock("talana-workers-sync", () => runTalanaSync({ trigger: "manual", mode, token }))
  } catch (error) {
    // Sólo el código: un mensaje de error podría arrastrar datos de Talana.
    console.error(`La sincronización falló: ${error instanceof TalanaSyncFailure ? error.code : "TALANA_SYNC_FAILED"}`)
    return 1
  }
  if ("skipped" in outcome) {
    console.error("Otra corrida de Talana tiene el candado (¿el cron?). Reintenta cuando termine.")
    return 1
  }

  printResult(outcome, await tallyRunItems(outcome.runId))
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      // Un error que no es de la corrida (p. ej. la base no responde): sin volcar el stack.
      console.error(error instanceof Error ? error.name : "Error")
      process.exit(1)
    },
  )
}
