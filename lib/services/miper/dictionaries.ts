import { and, asc, eq, isNotNull } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import {
  preventionRiskControls, preventionRiskEntries, preventionRiskLocations, preventionRiskMatrices,
  preventionRiskPositions, preventionRiskProcesses, preventionRiskTasks,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { cleanMiperName, normalizeMiperName } from "@/lib/prevention/miper/names"
import type { Client } from "./shared"

export type DictionaryKind = "activity" | "task" | "position" | "location"

/**
 * Autocompletado que no obliga (§8.2): un nombre nuevo se crea, uno existente
 * —comparado por nombre normalizado— se reutiliza. Carrera entre dos pestañas:
 * `onConflictDoNothing` sobre el índice único y re-lectura.
 */
export async function resolveDictionaryId(client: Client, kind: DictionaryKind, worksiteId: string, raw: string | null | undefined): Promise<string | null> {
  const name = cleanMiperName(raw)
  if (!name) return null
  const normalizedName = normalizeMiperName(name)
  const suffix = nanoid(8)
  if (kind === "activity") {
    const table = preventionRiskProcesses
    await client.insert(table).values({ id: `riskprocess-${suffix}`, worksiteId, code: `A-${suffix}`, name, normalizedName })
      .onConflictDoNothing({ target: [table.worksiteId, table.normalizedName] })
    const [row] = await client.select({ id: table.id }).from(table).where(and(eq(table.worksiteId, worksiteId), eq(table.normalizedName, normalizedName))).limit(1)
    return row?.id ?? null
  }
  if (kind === "task") {
    const table = preventionRiskTasks
    await client.insert(table).values({ id: `risktask-${suffix}`, worksiteId, processId: null, code: `T-${suffix}`, name, normalizedName })
      .onConflictDoNothing({ target: [table.worksiteId, table.normalizedName] })
    const [row] = await client.select({ id: table.id }).from(table).where(and(eq(table.worksiteId, worksiteId), eq(table.normalizedName, normalizedName))).limit(1)
    return row?.id ?? null
  }
  if (kind === "position") {
    const table = preventionRiskPositions
    await client.insert(table).values({ id: `riskposition-${suffix}`, worksiteId, taskId: null, code: `P-${suffix}`, name, normalizedName })
      .onConflictDoNothing({ target: [table.worksiteId, table.normalizedName] })
    const [row] = await client.select({ id: table.id }).from(table).where(and(eq(table.worksiteId, worksiteId), eq(table.normalizedName, normalizedName))).limit(1)
    return row?.id ?? null
  }
  const table = preventionRiskLocations
  await client.insert(table).values({ id: `risklocation-${suffix}`, worksiteId, name, normalizedName })
    .onConflictDoNothing({ target: [table.worksiteId, table.normalizedName] })
  const [row] = await client.select({ id: table.id }).from(table).where(and(eq(table.worksiteId, worksiteId), eq(table.normalizedName, normalizedName))).limit(1)
  return row?.id ?? null
}

export async function listDictionaryNames(client: Client, worksiteId: string) {
  const [activities, tasks, positions, locations] = await Promise.all([
    client.select({ name: preventionRiskProcesses.name }).from(preventionRiskProcesses)
      .where(and(eq(preventionRiskProcesses.worksiteId, worksiteId), eq(preventionRiskProcesses.isActive, true), isNotNull(preventionRiskProcesses.normalizedName))).orderBy(asc(preventionRiskProcesses.name)),
    client.select({ name: preventionRiskTasks.name }).from(preventionRiskTasks)
      .where(and(eq(preventionRiskTasks.worksiteId, worksiteId), eq(preventionRiskTasks.isActive, true), isNotNull(preventionRiskTasks.normalizedName))).orderBy(asc(preventionRiskTasks.name)),
    client.select({ name: preventionRiskPositions.name }).from(preventionRiskPositions)
      .where(and(eq(preventionRiskPositions.worksiteId, worksiteId), eq(preventionRiskPositions.isActive, true), isNotNull(preventionRiskPositions.normalizedName))).orderBy(asc(preventionRiskPositions.name)),
    client.select({ name: preventionRiskLocations.name }).from(preventionRiskLocations)
      .where(and(eq(preventionRiskLocations.worksiteId, worksiteId), eq(preventionRiskLocations.isActive, true))).orderBy(asc(preventionRiskLocations.name)),
  ])
  const names = (rows: Array<{ name: string }>) => rows.map((row) => row.name)
  return { activities: names(activities), tasks: names(tasks), positions: names(positions), locations: names(locations) }
}

/** Valores ya escritos en MIPER no legacy de la faena, para sugerir sin obligar. */
export async function listFreeTextSuggestions(client: Client, worksiteId: string) {
  const inWorksite = and(eq(preventionRiskMatrices.worksiteId, worksiteId), eq(preventionRiskMatrices.isLegacy, false))
  const distinct = async (column: AnyPgColumn) => (await client.selectDistinct({ value: column }).from(preventionRiskEntries)
    .innerJoin(preventionRiskMatrices, eq(preventionRiskMatrices.id, preventionRiskEntries.matrixId))
    .where(and(inWorksite, isNotNull(column))).orderBy(asc(column)).limit(500)).map((row) => String(row.value))
  const [hazards, risks, damages, measures] = await Promise.all([
    distinct(preventionRiskEntries.hazard),
    distinct(preventionRiskEntries.risk),
    distinct(preventionRiskEntries.probableDamage),
    client.selectDistinct({ value: preventionRiskControls.description }).from(preventionRiskControls)
      .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId))
      .innerJoin(preventionRiskMatrices, eq(preventionRiskMatrices.id, preventionRiskEntries.matrixId))
      .where(inWorksite).orderBy(asc(preventionRiskControls.description)).limit(500).then((rows) => rows.map((row) => row.value)),
  ])
  return { hazards, risks, damages, measures }
}
