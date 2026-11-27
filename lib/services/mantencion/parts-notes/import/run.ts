import type { DB } from "@/db"
import { applyPlannedNotes, type ApplyResult, type ImportActor } from "./apply"
import type { CargoTable } from "./cargos"
import { loadCatalogs, loadExistingNotes } from "./catalogs"
import { parseErpFile } from "./parse"
import { planNotes, type ImportPlan } from "./plan"
import { buildResolvers } from "./resolvers"
import { DEFAULT_EXCLUSION_RULE, type ExclusionRule } from "./types"

export interface RunOptions {
  /** `false` = simulación: lee los maestros y calcula el plan, pero no escribe NADA (ni siquiera consume folios). */
  apply: boolean
  /** Quien corre la importación (obligatorio para aplicar: queda en la auditoría y como quien resolvió las líneas). */
  actor: ImportActor | null
  cargos: CargoTable
  rule?: ExclusionRule
}

export interface RunResult {
  plan: ImportPlan
  /** `null` en simulación. */
  applied: ApplyResult | null
}

/** Lee el archivo ya parseado de JSON, lo planifica contra los maestros y, sólo con `apply`, lo escribe. */
export async function runNoteImport(client: DB, json: unknown, options: RunOptions): Promise<RunResult> {
  if (options.apply && !options.actor) throw new Error("Aplicar la importación exige un responsable (actor).")
  const { notes, invalid } = parseErpFile(json)
  const [catalogs, existing] = await Promise.all([
    loadCatalogs(client),
    loadExistingNotes(client, notes.map((note) => note.externalRef)),
  ])
  const plan = planNotes({
    notes, invalid, existing, rule: options.rule ?? DEFAULT_EXCLUSION_RULE, resolvers: buildResolvers(catalogs, options.cargos),
  })
  if (!options.apply) return { plan, applied: null }
  return { plan, applied: await applyPlannedNotes(client, plan.toImport, options.actor!) }
}
