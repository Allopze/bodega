/**
 * Comparación entre dos versiones MIPER de la misma faena (§Fase 7).
 *
 * Archivo separado, sólo lectura: `prevention-risk-legal.ts` ya es enorme, y
 * un diff no necesita ninguna de sus dependencias de escritura.
 */
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionRiskControls,
  preventionRiskEntries,
  preventionRiskMatrices,
  preventionRiskPositions,
  preventionRiskProcesses,
  preventionRiskTasks,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { riskEntryIdentityKey } from "@/lib/prevention/risk-engine"

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

const DIFF_FIELDS = ["probability", "consequence", "riskMagnitude", "riskClassification", "controls", "responsibleSnapshot", "controlDeadlineText"] as const
type DiffField = (typeof DIFF_FIELDS)[number]

interface RiskEntrySnapshot {
  identityKey: string
  hazardCode: string
  hazard: string
  process: string
  task: string
  position: string
  probability: number | null
  consequence: number | null
  riskMagnitude: number | null
  riskClassification: string | null
  responsibleSnapshot: string
  controlDeadlineText: string | null
  controls: string
}

export interface RiskEntryFieldDiff {
  field: DiffField
  before: unknown
  after: unknown
}

export interface RiskEntryDiffRow {
  identityKey: string
  status: "added" | "removed" | "modified" | "unchanged"
  hazardCode: string
  hazard: string
  base: RiskEntrySnapshot | null
  target: RiskEntrySnapshot | null
  fieldDiffs: RiskEntryFieldDiff[]
}

async function loadMatrixSnapshot(matrixId: string) {
  const [matrix] = await db.select().from(preventionRiskMatrices).where(eq(preventionRiskMatrices.id, matrixId)).limit(1)
  if (!matrix) throw new Error("MIPER no encontrada o fuera de alcance.")
  const rows = await db.select({
    entry: preventionRiskEntries,
    process: preventionRiskProcesses.name,
    task: preventionRiskTasks.name,
    position: preventionRiskPositions.name,
  }).from(preventionRiskEntries)
    .innerJoin(preventionRiskProcesses, eq(preventionRiskProcesses.id, preventionRiskEntries.processId))
    .innerJoin(preventionRiskTasks, eq(preventionRiskTasks.id, preventionRiskEntries.taskId))
    .innerJoin(preventionRiskPositions, eq(preventionRiskPositions.id, preventionRiskEntries.positionId))
    .where(eq(preventionRiskEntries.matrixId, matrixId))
    .orderBy(asc(preventionRiskEntries.hazardCode))
  const controls = rows.length
    ? await db.select().from(preventionRiskControls).where(inArray(preventionRiskControls.riskEntryId, rows.map((row) => row.entry.id))).orderBy(asc(preventionRiskControls.createdAt))
    : []
  const controlsByEntry = new Map<string, typeof controls>()
  for (const control of controls) controlsByEntry.set(control.riskEntryId, [...(controlsByEntry.get(control.riskEntryId) ?? []), control])

  const snapshots = new Map<string, RiskEntrySnapshot>()
  for (const row of rows) {
    const { entry } = row
    const identityKey = riskEntryIdentityKey(entry)
    snapshots.set(identityKey, {
      identityKey,
      hazardCode: entry.hazardCode,
      hazard: entry.hazard,
      process: row.process,
      task: row.task,
      position: row.position,
      probability: entry.probability,
      consequence: entry.consequence,
      riskMagnitude: entry.riskMagnitude,
      riskClassification: entry.riskClassification,
      responsibleSnapshot: entry.responsibleSnapshot,
      controlDeadlineText: entry.controlDeadlineText,
      controls: (controlsByEntry.get(entry.id) ?? []).map((control) => control.description).sort().join(" | "),
    })
  }
  return { matrix, snapshots }
}

function diffFields(base: RiskEntrySnapshot, target: RiskEntrySnapshot): RiskEntryFieldDiff[] {
  const diffs: RiskEntryFieldDiff[] = []
  for (const field of DIFF_FIELDS) {
    if (base[field] !== target[field]) diffs.push({ field, before: base[field], after: target[field] })
  }
  return diffs
}

/**
 * Compara dos versiones MIPER de la MISMA faena, emparejando entradas por
 * `riskEntryIdentityKey()` — el mismo criterio que usa `repointRiskMapMarkers`
 * al publicar, para que el mapa de riesgos y esta comparación nunca diverjan
 * sobre qué cuenta como "el mismo peligro" entre dos revisiones.
 */
export async function compareRiskMatrices(args: { baseMatrixId: string; targetMatrixId: string; scope: WorksiteScope; permissions: readonly string[] }) {
  if (!args.permissions.includes("prevention:risk:view")) throw new Error("MIPER no encontrada o fuera de alcance.")
  if (args.baseMatrixId === args.targetMatrixId) throw new Error("Selecciona dos versiones distintas para comparar.")
  const [base, target] = await Promise.all([loadMatrixSnapshot(args.baseMatrixId), loadMatrixSnapshot(args.targetMatrixId)])
  if (!scopeAllows(args.scope, base.matrix.worksiteId) || !scopeAllows(args.scope, target.matrix.worksiteId)) throw new Error("MIPER no encontrada o fuera de alcance.")
  if (base.matrix.worksiteId !== target.matrix.worksiteId) throw new Error("Sólo se comparan versiones de la misma faena.")

  const keys = new Set([...base.snapshots.keys(), ...target.snapshots.keys()])
  const entries: RiskEntryDiffRow[] = []
  for (const identityKey of keys) {
    const baseEntry = base.snapshots.get(identityKey) ?? null
    const targetEntry = target.snapshots.get(identityKey) ?? null
    if (baseEntry && !targetEntry) {
      entries.push({ identityKey, status: "removed", hazardCode: baseEntry.hazardCode, hazard: baseEntry.hazard, base: baseEntry, target: null, fieldDiffs: [] })
      continue
    }
    if (!baseEntry && targetEntry) {
      entries.push({ identityKey, status: "added", hazardCode: targetEntry.hazardCode, hazard: targetEntry.hazard, base: null, target: targetEntry, fieldDiffs: [] })
      continue
    }
    const fieldDiffs = diffFields(baseEntry!, targetEntry!)
    entries.push({
      identityKey,
      status: fieldDiffs.length > 0 ? "modified" : "unchanged",
      hazardCode: targetEntry!.hazardCode,
      hazard: targetEntry!.hazard,
      base: baseEntry,
      target: targetEntry,
      fieldDiffs,
    })
  }
  entries.sort((a, b) => a.hazardCode.localeCompare(b.hazardCode))

  const summary = {
    added: entries.filter((row) => row.status === "added").length,
    removed: entries.filter((row) => row.status === "removed").length,
    modified: entries.filter((row) => row.status === "modified").length,
    unchanged: entries.filter((row) => row.status === "unchanged").length,
  }
  return { base: base.matrix, target: target.matrix, summary, entries }
}

/**
 * Para el selector de "comparar contra": la matriz que se está viendo, más el
 * resto de las versiones de su misma faena (la comparación sólo tiene
 * sentido dentro de una faena — ver el rechazo en `compareRiskMatrices`).
 */
export async function listComparableMatrixVersions(args: { matrixId: string; scope: WorksiteScope; permissions: readonly string[] }) {
  if (!args.permissions.includes("prevention:risk:view")) throw new Error("MIPER no encontrada o fuera de alcance.")
  const [current] = await db.select().from(preventionRiskMatrices).where(eq(preventionRiskMatrices.id, args.matrixId)).limit(1)
  if (!current || !scopeAllows(args.scope, current.worksiteId)) throw new Error("MIPER no encontrada o fuera de alcance.")
  const others = await db.select().from(preventionRiskMatrices)
    .where(and(eq(preventionRiskMatrices.worksiteId, current.worksiteId), ne(preventionRiskMatrices.id, current.id)))
    .orderBy(desc(preventionRiskMatrices.matrixVersion))
  return { current, others }
}
