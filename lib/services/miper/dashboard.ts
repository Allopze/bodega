/**
 * Resumen del MIPER (§8.6 del rediseño, F3).
 *
 * Es una **lectura agregada** del mismo modelo que ya existe: no hay tabla ni
 * columna nuevas. Reusa `listMipers`/`listMiperInbox` (la bandeja es la misma
 * condición de rol que ve el resto de la portada, para no reintroducir el bug
 * A-03 de dos reglas paralelas) y deriva el avance con `programProgress`, que es
 * puro, sobre las ocurrencias que lee acá. Nunca se lee ni se guarda una columna
 * de avance: no existe.
 *
 * Este servicio es un modelo de lectura de página: se llama desde `page.tsx`,
 * **nunca dentro de una transacción** (y por eso puede apoyarse en `db` global,
 * igual que sus dos fuentes). El avance se deriva en memoria justamente para no
 * caer en la trampa de PGlite de resolver la conexión global dentro de una
 * transacción —`getProgramHeader`/`getProgramWorkspace` sí la usan por dentro—.
 */
import { and, eq, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionRiskControls, preventionRiskEntries, preventionRiskProgramActions, preventionRiskProgramOccurrenceRecords,
  preventionRiskProgramOccurrences, preventionRiskPrograms,
} from "@/db/schema"
import type { RiskClassification } from "@/lib/prevention/miper/methodology"
import { programProgress, type OccurrenceOutcome, type ProgramProgress } from "@/lib/prevention/miper/progress"
import { todayInChile } from "@/lib/utils"
import { listMiperInbox, listMipers } from "./queries"
import { requireAccess, userNames, type MiperAccess } from "./shared"

const VIEW = "prevention:risk:view"
/** Las dos bandas que la §8.6 llama «Intolerables + Importantes». */
const CRITICAL_CLASSIFICATIONS: RiskClassification[] = ["important", "intolerable"]

export type MiperDashboardFilters = {
  worksiteId?: string
  period?: number
  /** Igual que en la lista: `draft`/`published`/`superseded` o un `review_state`. */
  state?: string
  /** Quién tiene trabajo asignado (actividad del programa **o** medida). */
  responsibleUserId?: string
}

export type MiperDashboardTileKey = "todo" | "critical" | "uncontrolled" | "progress"

/**
 * Tile accionable (regla A1): cada uno lleva a su subconjunto ya filtrado, nunca
 * queda como caja de número suelto.
 */
export type MiperDashboardTile = {
  key: MiperDashboardTileKey
  label: string
  count: number
  hint: string
  href: string
}

/** Cifras secundarias en texto: van en franja (`<dl>`), no en tarjetas. */
export type MiperDashboardStrip = {
  /** MIPER en estado `published`. */
  vigentes: number
  /** MIPER con observaciones por responder (`review_state = observed`). */
  conObservaciones: number
  tolerables: number
  moderados: number
  /** Medidas de control cuyo `status` todavía no es `verified`. */
  medidasPendientes: number
  /** Ocurrencias pendientes con vencimiento pasado. */
  actividadesVencidas: number
}

export type MiperDashboardRow = {
  matrixId: string
  worksiteId: string
  worksiteName: string
  /** Rótulo en español de `status` + `review_state` (nunca el enum crudo). */
  stateLabel: string
  versionNumber: number | null
  classificationCounts: Record<RiskClassification, number>
  uncontrolledCount: number
  /** Derivado con `programProgress` sobre las ocurrencias de esta MIPER. */
  progress: ProgramProgress
  /** Filas Intolerables/Importantes + ocurrencias vencidas + «No se hizo». */
  alertCount: number
  /**
   * Extensión del contrato (campo nuevo, no rompe lo que ya se consume): quién
   * tiene trabajo asignado en esta MIPER, para que la portada pueda aplicar el
   * filtro por responsable también en la pestaña «Todas» con la misma regla.
   */
  responsibleUserIds: string[]
}

export type MiperDashboard = {
  tiles: MiperDashboardTile[]
  strip: MiperDashboardStrip
  rows: MiperDashboardRow[]
  /**
   * Extensión del contrato (no está en el plan): opciones del filtro por
   * responsable. Salen de lo que se está listando —igual que las opciones de
   * faena y período—, para no ofrecer a alguien que llevaría a una lista vacía.
   */
  responsibleOptions: Array<{ id: string; name: string }>
}

/** Ocurrencia tal como la consume `programProgress` (puro). */
type DashboardOccurrence = { outcome: OccurrenceOutcome; dueOn: string; late: boolean }

export async function getMiperDashboard(access: MiperAccess, filters: MiperDashboardFilters = {}): Promise<MiperDashboard> {
  requireAccess(access, VIEW)
  const today = todayInChile()

  /* La lista se pide al mismo servicio de la portada: el filtro de estado tiene
   * la misma semántica (status vs. review_state) y el alcance se aplica en SQL. */
  const listed = await listMipers(access, { worksiteId: filters.worksiteId, period: filters.period, state: filters.state })

  /* El filtro por responsable es una UNIÓN: una persona cuenta si tiene una
   * actividad del programa o una medida asignada —quién tiene trabajo
   * encargado, no quién firmó—. Se resuelve en memoria sobre lo ya listado. */
  const responsibleByMatrix = await responsibleIdsByMatrix(listed.map((row) => row.id))
  const rows = filters.responsibleUserId
    ? listed.filter((row) => (responsibleByMatrix.get(row.id) ?? []).includes(filters.responsibleUserId!))
    : listed
  const matrixIds = rows.map((row) => row.id)

  const [inbox, criticalByMatrix, uncontrolledByMatrix, pendingControlsByMatrix, occurrencesByMatrix, responsibleNames] = await Promise.all([
    // «Por hacer» es exactamente la bandeja: una sola condición de rol para las
    // dos pantallas (review 3 del plan).
    listMiperInbox(access),
    countEntriesByMatrix(matrixIds, inArray(preventionRiskEntries.classification, CRITICAL_CLASSIFICATIONS)),
    countEntriesByMatrix(matrixIds, and(eq(preventionRiskEntries.controlledStatus, "no"), ne(preventionRiskEntries.classification, "tolerable"))),
    countPendingControlsByMatrix(matrixIds),
    occurrencesByMatrixOf(matrixIds),
    userNames(db, [...new Set(Array.from(responsibleByMatrix.values()).flat())]),
  ])

  const occurrences = matrixIds.flatMap((matrixId) => occurrencesByMatrix.get(matrixId) ?? [])
  const progress = programProgress(occurrences, today)
  const critical = sum(criticalByMatrix)
  const uncontrolled = sum(uncontrolledByMatrix)

  const dashboardRows: MiperDashboardRow[] = rows.map((row) => {
    const matrixProgress = programProgress(occurrencesByMatrix.get(row.id) ?? [], today)
    return {
      matrixId: row.id,
      worksiteId: row.worksiteId,
      worksiteName: row.worksiteName,
      stateLabel: row.label,
      versionNumber: row.versionNumber,
      classificationCounts: row.classificationCounts,
      uncontrolledCount: uncontrolledByMatrix.get(row.id) ?? 0,
      progress: matrixProgress,
      /* «Importante sin medida» y «medida sin responsable o plazo» son
       * indicadores de la matriz y de `getPreventionAttention` (§9.1): no son
       * alertas que le lleguen a alguien, así que no entran acá. */
      alertCount: (criticalByMatrix.get(row.id) ?? 0) + matrixProgress.overdue + matrixProgress.failed,
      responsibleUserIds: responsibleByMatrix.get(row.id) ?? [],
    }
  })

  const tiles: MiperDashboardTile[] = [
    { key: "todo", label: "Por hacer", count: inbox.length, hint: "Esperan tu revisión, tu firma o tu respuesta", href: "?tab=porhacer" },
    { key: "critical", label: "Intolerables e Importantes", count: critical, hint: "Riesgos que exigen medida y seguimiento", href: "?tab=todas&clasificacion=grave" },
    { key: "uncontrolled", label: "Sin controlar", count: uncontrolled, hint: "Riesgos no tolerables sin control declarado", href: "?tab=todas&control=no" },
    { key: "progress", label: "Avance del programa", count: progress.done, hint: `${progress.done} de ${progress.planned} actividades realizadas`, href: "?tab=todas&vista=avance" },
  ]

  const strip: MiperDashboardStrip = {
    vigentes: rows.filter((row) => row.status === "published").length,
    conObservaciones: rows.filter((row) => row.reviewState === "observed").length,
    tolerables: rows.reduce((total, row) => total + row.classificationCounts.tolerable, 0),
    moderados: rows.reduce((total, row) => total + row.classificationCounts.moderate, 0),
    medidasPendientes: sum(pendingControlsByMatrix),
    actividadesVencidas: progress.overdue,
  }

  return {
    tiles,
    strip,
    rows: dashboardRows,
    responsibleOptions: [...responsibleNames.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es-CL")),
  }
}

function sum(counts: Map<string, number>): number {
  let total = 0
  for (const value of counts.values()) total += value
  return total
}

/** Filas de `preventionRiskEntries` que cumplen `condition`, agrupadas por MIPER. */
async function countEntriesByMatrix(matrixIds: string[], condition: SQL | undefined): Promise<Map<string, number>> {
  if (matrixIds.length === 0) return new Map()
  const rows = await db.select({ matrixId: preventionRiskEntries.matrixId, count: sql<number>`count(*)::int` })
    .from(preventionRiskEntries)
    .where(and(inArray(preventionRiskEntries.matrixId, matrixIds), condition))
    .groupBy(preventionRiskEntries.matrixId)
  return new Map(rows.map((row) => [row.matrixId, row.count]))
}

/** Medidas sin verificar de cada MIPER (la medida cuelga de una fila). */
async function countPendingControlsByMatrix(matrixIds: string[]): Promise<Map<string, number>> {
  if (matrixIds.length === 0) return new Map()
  const rows = await db.select({ matrixId: preventionRiskEntries.matrixId, count: sql<number>`count(*)::int` })
    .from(preventionRiskControls)
    .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId))
    .where(and(inArray(preventionRiskEntries.matrixId, matrixIds), ne(preventionRiskControls.status, "verified")))
    .groupBy(preventionRiskEntries.matrixId)
  return new Map(rows.map((row) => [row.matrixId, row.count]))
}

/**
 * Ocurrencias del programa de cada MIPER, ya en la forma que `programProgress`
 * consume. El resultado vigente es el del registro actual; sin registro, el
 * resumen de la ocurrencia: mismo criterio que `getProgramWorkspace` (F2).
 */
async function occurrencesByMatrixOf(matrixIds: string[]): Promise<Map<string, DashboardOccurrence[]>> {
  const byMatrix = new Map<string, DashboardOccurrence[]>()
  if (matrixIds.length === 0) return byMatrix
  const rows = await db.select({
    matrixId: preventionRiskPrograms.matrixId,
    occurrenceOutcome: preventionRiskProgramOccurrences.outcome,
    dueOn: preventionRiskProgramOccurrences.dueOn,
    recordId: preventionRiskProgramOccurrenceRecords.id,
    recordOutcome: preventionRiskProgramOccurrenceRecords.outcome,
    late: preventionRiskProgramOccurrenceRecords.late,
  }).from(preventionRiskProgramOccurrences)
    .innerJoin(preventionRiskProgramActions, eq(preventionRiskProgramActions.id, preventionRiskProgramOccurrences.actionId))
    .innerJoin(preventionRiskPrograms, eq(preventionRiskPrograms.id, preventionRiskProgramActions.programId))
    .leftJoin(preventionRiskProgramOccurrenceRecords, eq(preventionRiskProgramOccurrenceRecords.id, preventionRiskProgramOccurrences.currentRecordId))
    .where(inArray(preventionRiskPrograms.matrixId, matrixIds))

  for (const row of rows) {
    const list = byMatrix.get(row.matrixId) ?? []
    list.push({
      outcome: (row.recordId ? row.recordOutcome : row.occurrenceOutcome) as OccurrenceOutcome,
      dueOn: row.dueOn,
      late: row.recordId ? row.late ?? false : false,
    })
    byMatrix.set(row.matrixId, list)
  }
  return byMatrix
}

/** Unión de responsables: actividades del programa + medidas de control. */
async function responsibleIdsByMatrix(matrixIds: string[]): Promise<Map<string, string[]>> {
  const byMatrix = new Map<string, string[]>()
  if (matrixIds.length === 0) return byMatrix
  const [fromActions, fromControls] = await Promise.all([
    db.selectDistinct({ matrixId: preventionRiskPrograms.matrixId, userId: preventionRiskProgramActions.responsibleUserId })
      .from(preventionRiskProgramActions)
      .innerJoin(preventionRiskPrograms, eq(preventionRiskPrograms.id, preventionRiskProgramActions.programId))
      .where(and(inArray(preventionRiskPrograms.matrixId, matrixIds), isNotNull(preventionRiskProgramActions.responsibleUserId))),
    db.selectDistinct({ matrixId: preventionRiskEntries.matrixId, userId: preventionRiskControls.responsibleUserId })
      .from(preventionRiskControls)
      .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId))
      .where(and(inArray(preventionRiskEntries.matrixId, matrixIds), isNotNull(preventionRiskControls.responsibleUserId))),
  ])
  for (const row of [...fromActions, ...fromControls]) {
    if (!row.userId) continue
    const list = byMatrix.get(row.matrixId) ?? []
    if (!list.includes(row.userId)) list.push(row.userId)
    byMatrix.set(row.matrixId, list)
  }
  return byMatrix
}
