/**
 * Modelo de datos puro del documento RE-36 (Programa de Trabajo Preventivo
 * SG-SST) para una faena. Es el formato que la faena manda al mandante y que
 * firma Legal: cabecera con indicadores, banda de objetivos, 12 meses × 4
 * semanas × (Planeado, Ejecutado), totales, firmas, control de cambios y
 * glosario — ver `PDTP_INTERFAZ_DESDE_EXCEL_2026-09-16.md` §2.
 *
 * Esta tarea (1.5) construye SOLO el objeto TypeScript: nada de ExcelJS aquí.
 * El renderizador a Excel y el enchufe a la ruta de descarga son las tareas
 * 1.6/1.7. El informe de la tarea documenta, campo por campo, de qué fuente
 * sale cada bloque — léase antes de tocar el renderizador.
 */
import { and, asc, eq, gt, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivities,
  pdtpActivityWorksiteExclusions,
  pdtpChangeLog,
  pdtpDocumentHistory,
  pdtpResponsibleCatalog,
  pdtpRoleLegendEntries,
  pdtpSheetActivities,
  pdtpSheets,
  users,
  worksites,
} from "@/db/schema"
import { listPdtpApprovalSteps } from "./approval-flow"
import { effectiveApprovedExecutionsByCell, getPdtpComplianceIndicators } from "./compliance"
import { assertWorksiteAccess, loadProgramScheduleAndExecutions, type WorksiteScope } from "./helpers"
import { listPdtpObjectives } from "./objectives"
import { filterPdtpRowsFromActivation } from "./period"
import { getPdtpProgram } from "./programs"
import { listPdtpProgramSheets } from "./sheet-management"

const MONTHS = 12
const WEEKS_PER_MONTH = 4
const CELL_COUNT = MONTHS * WEEKS_PER_MONTH

/** Índice 0-based dentro de `PdtpRe36Row.cells` para un mes (1-12) y semana (1-4) dados. */
function cellIndex(month: number, week: number): number {
  return (month - 1) * WEEKS_PER_MONTH + (week - 1)
}

export type PdtpRe36Cell = { p: number | null; e: number | null; note?: string }

export type PdtpRe36Row = {
  activityId: string
  n: number
  objectiveCode: string | null
  objectiveName: string | null
  program: string
  activity: string
  responsibles: string
  /** Fase 5: nombres resueltos de los ejecutores acreditadores asignados a la
   * actividad. Vacío hasta esa fase — el campo se declara ahora para que el
   * tipo no cambie cuando se llene. */
  assigneeNames: string[]
  scheduleMode: "scheduled" | "on_demand" | "triggered"
  /** 48 celdas: `(month-1)*4 + (week-1)`, mes 1-12, semana 1-4. */
  cells: PdtpRe36Cell[]
}

export type PdtpRe36Band = { code: string | null; name: string; fromRow: number; toRow: number }

export type PdtpRe36Sheet = { code: string; label: string; rows: PdtpRe36Row[]; bands: PdtpRe36Band[] }

export type PdtpRe36DeviationRow = {
  n: number
  activity: string
  month: number
  week: number
  kind: string
  reason: string
  targetMonth: number | null
  targetWeek: number | null
  recordedBy: string
  recordedAt: string
}

export type PdtpRe36Document = {
  program: {
    id: string
    year: number
    version: number
    title: string
    documentCode: string
    documentRevision: string | null
    indicatorName: string | null
    indicatorType: string | null
    indicatorFormula: string | null
    indicatorPeriodicity: string | null
    measurementOwner: string | null
    complianceTarget: number
    annualPercent: number | null
  }
  worksite: { id: string; name: string; code: string }
  cutoff: { asOf: string; year: number; month: number | null }
  sheets: PdtpRe36Sheet[]
  platformIndicators: {
    monthly: Array<{ month: number; planned: number; executed: number; percent: number | null; zeroActivities: number }>
    quarterly: Array<{ quarter: number; planned: number; executed: number; percent: number | null }>
  }
  signatures: {
    elaboratedBy: { name: string; title: string; at: string | null }
    reviewedByJdpr: { name: string; title: string; at: string } | null
    approvedByLegal: { name: string; title: string; at: string } | null
  }
  changeControl: Array<{ at: string; description: string; actor: string | null }>
  glossary: Array<{ code: string; label: string }>
  legend: { onDemand: string; e0: string; eGte1: string }
  /** Fase 3: desvíos (reprogramaciones, incumplimientos justificados). Vacío
   * hasta esa fase — declarado ahora para que el tipo no cambie cuando se
   * llene. */
  deviations: PdtpRe36DeviationRow[]
}

type ActivityRow = typeof pdtpActivities.$inferSelect
type SheetRow = typeof pdtpSheets.$inferSelect

/**
 * Construye el documento RE-36 completo de un programa para una faena. No
 * renderiza nada: devuelve el modelo puro que la tarea 1.6 convierte a Excel.
 */
export async function buildPdtpRe36Document(input: {
  programId: string
  worksiteId: string
  scope: WorksiteScope
  sheetCodes?: string[]
}): Promise<PdtpRe36Document> {
  assertWorksiteAccess(input.worksiteId, input.scope)

  const program = await getPdtpProgram(input.programId)
  if (!program) throw new Error("Programa PDTP no encontrado.")

  const [worksiteRow] = await db.select({ id: worksites.id, name: worksites.name, code: worksites.code })
    .from(worksites).where(eq(worksites.id, input.worksiteId)).limit(1)
  if (!worksiteRow) throw new Error("Faena no encontrada.")

  // Una hoja por código: un código puede tener fila plantilla (programId
  // NULL) y fila program-scoped; se prefiere la program-scoped, mismo
  // criterio que `resolveSheetForProgram` (helpers.ts).
  const rawSheets = await listPdtpProgramSheets(input.programId)
  const sheetByCode = new Map<string, SheetRow>()
  for (const sheet of rawSheets) {
    const existing = sheetByCode.get(sheet.code)
    if (!existing || (existing.programId === null && sheet.programId !== null)) {
      sheetByCode.set(sheet.code, sheet)
    }
  }
  let resolvedSheets = [...sheetByCode.values()].sort((a, b) => a.code.localeCompare(b.code))
  if (input.sheetCodes) {
    const wanted = new Set(input.sheetCodes)
    resolvedSheets = resolvedSheets.filter((sheet) => wanted.has(sheet.code))
  }

  const membershipsBySheet = new Map<string, Array<typeof pdtpSheetActivities.$inferSelect>>()
  const allActivityIdsSet = new Set<string>()
  for (const sheet of resolvedSheets) {
    const memberships = await db.select().from(pdtpSheetActivities)
      .where(eq(pdtpSheetActivities.sheetId, sheet.id))
      .orderBy(asc(pdtpSheetActivities.displayOrder))
    membershipsBySheet.set(sheet.id, memberships)
    for (const membership of memberships) allActivityIdsSet.add(membership.activityId)
  }
  const allActivityIds = [...allActivityIdsSet]

  const activityRows = allActivityIds.length > 0
    ? await db.select().from(pdtpActivities)
        .where(and(inArray(pdtpActivities.id, allActivityIds), eq(pdtpActivities.programId, input.programId)))
    : []
  const activityById = new Map(activityRows.map((activity) => [activity.id, activity]))

  // R4: una actividad excluida de la faena no aporta al denominador ni al
  // ejecutado — y tampoco debe aparecer como fila del documento (no solo con
  // celdas vacías): `loadProgramScheduleAndExecutions` ya filtra sus celdas,
  // pero la fila misma hay que quitarla aquí.
  const exclusionRows = allActivityIds.length > 0
    ? await db.select({ activityId: pdtpActivityWorksiteExclusions.activityId }).from(pdtpActivityWorksiteExclusions)
        .where(and(
          inArray(pdtpActivityWorksiteExclusions.activityId, allActivityIds),
          eq(pdtpActivityWorksiteExclusions.worksiteId, input.worksiteId),
        ))
    : []
  const excludedActivityIds = new Set(exclusionRows.map((row) => row.activityId))

  // Única costura para overrides/exclusiones/vigencia (D del brief): no se
  // reimplementa nada de eso aquí.
  const loaded = await loadProgramScheduleAndExecutions(allActivityIds, program.year, input.worksiteId)
  // Mismo recorte de vigencia que `getPdtpComplianceIndicators` (activación del
  // programa): sin este filtro, un programa con `activatedAt` posterior al
  // inicio del cronograma mostraría en el documento celdas que el indicador ya
  // descartó, rompiendo la coherencia Σp === indicators.annual.planned.
  const scheduleRows = filterPdtpRowsFromActivation(loaded.scheduleRows, program.activatedAt)
  const executionRows = filterPdtpRowsFromActivation(loaded.executionRows, program.activatedAt)

  // Coherencia dura: `E` cuenta solo ejecuciones aprobadas, con la misma
  // deduplicación por celda que el indicador (`effectiveApprovedExecutionsByCell`).
  // La vista de hoja (`sheets.ts`) suma cualquier estado — no se usa aquí.
  const approvedExecutionRows = executionRows.filter((row) => row.status === "approved")
  const effectiveExecutions = effectiveApprovedExecutionsByCell(approvedExecutionRows)

  const plannedByCell = new Map<string, number>()
  for (const row of scheduleRows) {
    const key = `${row.activityId}:${row.month}:${row.week}`
    plannedByCell.set(key, (plannedByCell.get(key) ?? 0) + row.plannedQuantity)
  }
  const executedByCell = new Map<string, number>()
  for (const cell of effectiveExecutions) {
    const key = `${cell.activityId}:${cell.month}:${cell.week}`
    executedByCell.set(key, (executedByCell.get(key) ?? 0) + cell.executedQuantity)
  }

  const objectives = await listPdtpObjectives(input.programId)
  const objectiveById = new Map(objectives.map((objective) => [objective.id, objective]))
  const hasObjectives = objectives.length > 0

  const responsibleSlugsUsed = new Set<string>()

  const sheets: PdtpRe36Sheet[] = resolvedSheets.map((sheet) => {
    const memberships = membershipsBySheet.get(sheet.id) ?? []
    const candidateActivities = memberships
      .map((membership) => activityById.get(membership.activityId))
      .filter((activity): activity is ActivityRow => Boolean(activity) && !excludedActivityIds.has(activity!.id))

    const orderedActivities = hasObjectives
      ? [...candidateActivities].sort((a, b) => {
          const orderA = a.objectiveId ? objectiveById.get(a.objectiveId)?.displayOrder ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
          const orderB = b.objectiveId ? objectiveById.get(b.objectiveId)?.displayOrder ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
          if (orderA !== orderB) return orderA - orderB
          return a.n - b.n
        })
      // Sin objetivos: fallback por eje (`pdtpActivities.program`, brief §5). El
      // orden natural es por N°; las bandas agrupan tramos contiguos del mismo eje.
      : [...candidateActivities].sort((a, b) => a.n - b.n)

    const rows: PdtpRe36Row[] = orderedActivities.map((activity) => {
      const slugs = Array.isArray(activity.responsibleSlugs) ? activity.responsibleSlugs as string[] : []
      for (const slug of slugs) responsibleSlugsUsed.add(slug)

      const objective = hasObjectives && activity.objectiveId ? objectiveById.get(activity.objectiveId) ?? null : null
      const cells: PdtpRe36Cell[] = Array.from({ length: CELL_COUNT }, () => ({ p: null, e: null }))
      for (let month = 1; month <= MONTHS; month++) {
        for (let week = 1; week <= WEEKS_PER_MONTH; week++) {
          const key = `${activity.id}:${month}:${week}`
          const p = plannedByCell.get(key)
          const e = executedByCell.get(key)
          cells[cellIndex(month, week)] = {
            p: p === undefined ? null : p,
            e: e === undefined ? null : e,
          }
        }
      }
      return {
        activityId: activity.id,
        n: activity.n,
        objectiveCode: objective ? objective.code : null,
        objectiveName: objective ? objective.name : null,
        program: activity.program,
        activity: activity.activity,
        responsibles: activity.responsibleDisplay,
        assigneeNames: [],
        scheduleMode: activity.scheduleMode as "scheduled" | "on_demand" | "triggered",
        cells,
      }
    })

    // Bandas: tramos contiguos que comparten el mismo objetivo (o, sin
    // objetivos, el mismo eje). `fromRow`/`toRow` son posiciones 1-based
    // dentro de `rows` de esta hoja (para que el renderizador calcule
    // directamente el rango de celdas combinadas).
    const bands: PdtpRe36Band[] = []
    let lastGroupKey: string | null = null
    for (const [index, activity] of orderedActivities.entries()) {
      const rowNumber = index + 1
      let groupKey: string
      let code: string | null
      let name: string
      if (hasObjectives) {
        const objective = activity.objectiveId ? objectiveById.get(activity.objectiveId) : undefined
        code = objective ? objective.code : null
        name = objective ? objective.name : "Sin objetivo asignado"
        groupKey = objective ? `obj:${objective.code}` : "obj:__none__"
      } else {
        code = null
        name = activity.program
        groupKey = `program:${activity.program}`
      }
      const currentBand = bands[bands.length - 1]
      if (currentBand && lastGroupKey === groupKey) {
        currentBand.toRow = rowNumber
      } else {
        bands.push({ code, name, fromRow: rowNumber, toRow: rowNumber })
      }
      lastGroupKey = groupKey
    }

    return { code: sheet.code, label: sheet.label, rows, bands }
  })

  const indicators = await getPdtpComplianceIndicators(input.programId, input.worksiteId)
  if (!indicators) throw new Error("No fue posible calcular los indicadores de cumplimiento del programa.")

  const platformIndicators = {
    monthly: indicators.monthly.map((month) => ({
      month: month.month,
      planned: month.planned,
      executed: month.executed,
      percent: month.percent,
      zeroActivities: month.zeroActivities,
    })),
    quarterly: indicators.quarterly.map((quarter) => ({
      quarter: quarter.quarter,
      planned: quarter.planned,
      executed: quarter.executed,
      percent: quarter.percent,
    })),
  }

  const [documentHistoryRows, roleLegendRows, approvalSteps] = await Promise.all([
    db.select().from(pdtpDocumentHistory)
      .where(eq(pdtpDocumentHistory.programId, input.programId))
      .orderBy(asc(pdtpDocumentHistory.entryKind), asc(pdtpDocumentHistory.sequence)),
    db.select().from(pdtpRoleLegendEntries)
      .where(eq(pdtpRoleLegendEntries.programId, input.programId))
      .orderBy(asc(pdtpRoleLegendEntries.code)),
    listPdtpApprovalSteps(input.programId),
  ])

  // Control de cambios (regla dura, brief §6): solo lo declarado en
  // `pdtp_document_history` (entryKind = 'change_control') más las entradas de
  // `pdtp_change_log` posteriores al congelamiento (`reviewStartedAt`). Sin
  // `reviewStartedAt` (programa que nunca entró a revisión) no hay "posterior
  // al congelamiento" que mostrar, así que no se incluye ningún changelog.
  const changeLogRows = program.reviewStartedAt
    ? await db.select().from(pdtpChangeLog)
        .where(and(eq(pdtpChangeLog.programId, input.programId), gt(pdtpChangeLog.changedAt, program.reviewStartedAt)))
        .orderBy(asc(pdtpChangeLog.changedAt))
    : []

  const userIds = new Set<string>()
  for (const row of changeLogRows) if (row.changedByUserId) userIds.add(row.changedByUserId)
  if (program.approvedByJdprUserId) userIds.add(program.approvedByJdprUserId)
  if (program.approvedByLegalUserId) userIds.add(program.approvedByLegalUserId)
  for (const row of documentHistoryRows) if (row.linkedUserId) userIds.add(row.linkedUserId)
  const userRows = userIds.size > 0
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...userIds]))
    : []
  const userNameById = new Map(userRows.map((user) => [user.id, user.name]))

  const elaborationHistory = documentHistoryRows.find((row) => row.entryKind === "elaboration")
  const reviewHistory = documentHistoryRows.find((row) => row.entryKind === "review")
  const approvalHistory = documentHistoryRows.find((row) => row.entryKind === "approval")
  const jdprStep = approvalSteps.find((step) => step.code === "jdpr")
  const legalStep = approvalSteps.find((step) => step.code === "legal")

  const signatures: PdtpRe36Document["signatures"] = {
    // El programa siempre declara quién lo elaboró (columnas NOT NULL); la
    // fecha, en cambio, no vive en `pdtp_programs` — solo se conoce si el
    // documento original la declaró (`pdtp_document_history`).
    elaboratedBy: {
      name: program.elaboratedByName,
      title: program.elaboratedByTitle,
      at: elaborationHistory?.declaredAtText ?? null,
    },
    // Prioridad: la aprobación nativa de Chome (autoritativa) sobre la
    // declaración importada del documento legado (solo si nunca hubo
    // aprobación nativa).
    reviewedByJdpr: program.approvedByJdprUserId
      ? {
          name: userNameById.get(program.approvedByJdprUserId) ?? "Usuario no encontrado",
          title: jdprStep?.label ?? "Revisión técnica JDPR",
          at: program.approvedByJdprAt ?? "",
        }
      : reviewHistory
        ? {
            name: (reviewHistory.linkedUserId ? userNameById.get(reviewHistory.linkedUserId) : null)
              ?? reviewHistory.declaredActorName ?? "—",
            title: reviewHistory.declaredActorTitle ?? "—",
            at: reviewHistory.declaredAtText ?? "",
          }
        : null,
    approvedByLegal: program.approvedByLegalUserId
      ? {
          name: userNameById.get(program.approvedByLegalUserId) ?? "Usuario no encontrado",
          title: legalStep?.label ?? "Aprobación Legal y RRHH",
          at: program.approvedByLegalAt ?? "",
        }
      : approvalHistory
        ? {
            name: (approvalHistory.linkedUserId ? userNameById.get(approvalHistory.linkedUserId) : null)
              ?? approvalHistory.declaredActorName ?? "—",
            title: approvalHistory.declaredActorTitle ?? "—",
            at: approvalHistory.declaredAtText ?? "",
          }
        : null,
  }

  const changeControlFromHistory = documentHistoryRows
    .filter((row) => row.entryKind === "change_control")
    .map((row) => ({
      at: row.declaredAtText ?? row.createdAt,
      description: row.description ?? "",
      actor: (row.linkedUserId ? userNameById.get(row.linkedUserId) : null) ?? row.declaredActorName ?? null,
    }))
  const changeControlFromLog = changeLogRows.map((row) => ({
    at: row.changedAt,
    description: row.note ?? `${row.section} actualizado.`,
    actor: row.changedByUserId ? (userNameById.get(row.changedByUserId) ?? null) : null,
  }))
  const changeControl = [...changeControlFromHistory, ...changeControlFromLog]

  const roleLegendCodesLower = new Set(roleLegendRows.map((row) => row.code.toLowerCase()))
  const catalogRows = responsibleSlugsUsed.size > 0
    ? await db.select().from(pdtpResponsibleCatalog).where(inArray(pdtpResponsibleCatalog.slug, [...responsibleSlugsUsed]))
    : []
  const catalogBySlug = new Map(catalogRows.map((row) => [row.slug, row]))
  const glossary = [
    ...roleLegendRows.map((row) => ({ code: row.code, label: row.label })),
    ...[...responsibleSlugsUsed]
      .filter((slug) => !roleLegendCodesLower.has(slug.toLowerCase()))
      .sort((a, b) => a.localeCompare(b))
      .map((slug) => ({ code: slug, label: catalogBySlug.get(slug)?.displayName ?? slug })),
  ]

  return {
    program: {
      id: program.id,
      year: program.year,
      version: program.version,
      title: program.title,
      documentCode: program.documentCode ?? "RE-36",
      documentRevision: program.documentRevision,
      indicatorName: program.indicatorName,
      indicatorType: program.indicatorType,
      indicatorFormula: program.indicatorFormula,
      indicatorPeriodicity: program.indicatorPeriodicity,
      measurementOwner: program.measurementOwner,
      complianceTarget: program.complianceTarget,
      annualPercent: indicators.annual.percent,
    },
    worksite: worksiteRow,
    // Sin parámetro de corte explícito, el documento se genera "a hoy": todo
    // el año, sin recortar a un mes particular (`month: null`).
    cutoff: { asOf: new Date().toISOString(), year: program.year, month: null },
    sheets,
    platformIndicators,
    signatures,
    changeControl,
    glossary,
    legend: {
      onDemand: "Actividad con frecuencia: cada vez que sea necesario (a demanda). No entra al denominador de cumplimiento salvo que además tenga P planificado (actividad mixta).",
      e0: "E = 0: se reportó la semana y no se ejecutó.",
      eGte1: "E ≥ 1: se ejecutó (bandera de cumplimiento o conteo de registros, según la actividad).",
    },
    deviations: [],
  }
}
