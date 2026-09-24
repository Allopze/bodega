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
 *
 * Los textos de este modelo (`activity`, `program`, `responsibles`,
 * `objectiveName`, `description` de `changeControl`, `label`/`name` de
 * `glossary`/firmas, etc.) viajan **crudos**, tal como están en la base de
 * datos: este módulo no los sanea. Quien serialice a Excel (tarea 1.6) debe
 * aplicar `sanitizeCell` (`lib/reports/export-module/excel-builder.ts`) o un
 * saneo equivalente antes de escribirlos en una celda.
 */
import { and, asc, eq, gte, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivities,
  pdtpAccreditationBindings,
  pdtpActivityWorksiteExclusions,
  pdtpActivityExecutionConfigs,
  pdtpChangeLog,
  pdtpDocumentHistory,
  pdtpResponsibleCatalog,
  pdtpRoleLegendEntries,
  pdtpScheduledInstances,
  pdtpSheetActivities,
  pdtpSheets,
  users,
  worksites,
} from "@/db/schema"
import { listPdtpApprovalSteps } from "./approval-flow"
import { listPdtpActivityAssignees } from "./assignees"
import { effectiveApprovedExecutionsByCell, getPdtpComplianceIndicators } from "./compliance"
import { assertWorksiteAccess, loadProgramScheduleAndExecutions, type WorksiteScope } from "./helpers"
import { listPdtpObjectives } from "./objectives"
import { filterPdtpRowsFromActivation } from "./period"
import { getPdtpProgram } from "./programs"
import { listPdtpProgramSheets } from "./sheet-management"
import { derivePdtpScheduledInstanceStatus } from "./scheduled-instances"
import { getPdtpExecutionConnector } from "./connectors"
import { MONTH_LABELS } from "./constants"
import { pdtpDeviationKindLabel } from "@/lib/prevention/pdtp"
import { chileDateParts, todayInChile } from "@/lib/utils"

const MONTHS = 12
const WEEKS_PER_MONTH = 4
const CELL_COUNT = MONTHS * WEEKS_PER_MONTH

/** Índice 0-based dentro de `PdtpRe36Row.cells` para un mes (1-12) y semana (1-4) dados. */
function cellIndex(month: number, week: number): number {
  return (month - 1) * WEEKS_PER_MONTH + (week - 1)
}

/**
 * Intenta convertir una fecha declarada en texto libre a ISO, para poder
 * ordenar `changeControl`/firmas globalmente. El documento legado importado
 * declara fechas en formato local `DD-MM-YYYY` (p. ej. "12-02-2026",
 * "04-02-2026" — ver §2.6 de `PDTP_INTERFAZ_DESDE_EXCEL_2026-09-16.md`); ese
 * formato NO es el que asume `new Date(text)` (que lo leería como
 * mes-día-año o lo rechazaría). Si el texto no calza con ese patrón se
 * intenta un parseo genérico como último recurso; si tampoco resuelve a una
 * fecha válida, devuelve `null` — el texto original (`declaredAtText`/`at`)
 * se conserva igual para mostrarlo tal como se declaró.
 */
function parseDeclaredDateToIso(text: string | null | undefined): string | null {
  if (!text) return null
  const trimmed = text.trim()
  const ddmmyyyy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(trimmed)
  if (ddmmyyyy) {
    const day = Number(ddmmyyyy[1])
    const month = Number(ddmmyyyy[2])
    const year = Number(ddmmyyyy[3])
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    const asDate = new Date(Date.UTC(year, month - 1, day))
    if (Number.isNaN(asDate.getTime())) return null
    // `Date.UTC` hace rollover silencioso para días que no existen
    // ("31-04-2033" → 1 de mayo; "30-02-2033" → 2 de marzo): se verifica que
    // la fecha construida coincida exactamente con lo declarado, para no
    // devolver una fecha distinta de la pedida.
    if (asDate.getUTCFullYear() !== year || asDate.getUTCMonth() !== month - 1 || asDate.getUTCDate() !== day) {
      return null
    }
    return asDate.toISOString()
  }
  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/**
 * Normaliza a ISO estricto un valor de columna `timestamptz` (`mode:
 * "string"`, formato nativo de Postgres — `"2033-01-31 20:00:00-04"`, NO
 * ISO — hay un espacio en vez de `T`) o cualquier otra fecha ya
 * parseable por `Date`. Existe porque `changeControl` mezclaba dos fuentes
 * (fechas declaradas en texto libre, ya normalizadas por
 * `parseDeclaredDateToIso` a ISO estricto, y columnas nativas sin
 * normalizar) y las comparaba con `localeCompare` — que asume un único
 * formato. Con las dos fuentes crudas, un texto declarado a medianoche y uno
 * nativo el mismo día a las 23:00 podían ordenar al revés (el espacio del
 * formato nativo, código 32, ordena antes que la `T` de ISO, código 84).
 * Devuelve `null` si el valor no es interpretable — igual que
 * `parseDeclaredDateToIso`, nunca se muestra como fecha si no hay certeza.
 */
function toCanonicalIso(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/**
 * `DD-MM-AAAA` en hora de Chile. El documento lo lee gente en faena: una
 * marca de tiempo UTC adelantaría el día entre las 20:00 y la medianoche
 * chilena, y un desvío declarado "hoy" aparecería fechado mañana.
 */
function formatChileDay(value: string | null | undefined): string {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "—"
  const { year, month, day } = chileDateParts(parsed)
  return `${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}-${year}`
}

/**
 * `AAAA-MM-DD` del día chileno de un instante ISO. La vigencia de una
 * asignación nominal es una fecha civil; el corte del documento es un instante.
 * Esta es la traducción entre las dos, y tiene que hacerse en hora de Chile:
 * un corte a las 23:00 del 31 de marzo es el 31 de marzo en faena y el 1 de
 * abril en UTC, y con él cambiaría el responsable que muestra el documento.
 */
function isoToChileDay(value: string): string {
  const { year, month, day } = chileDateParts(new Date(value))
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/**
 * Texto de la columna RESPONSABLES del RE-36: el cargo del programa firmado
 * y, entre paréntesis, quién lo tiene a su nombre hoy en esta faena —
 * "Sup, JT (María Pérez)". El cargo no se reemplaza: el documento se firma por
 * cargo y tiene que seguir leyéndose igual cuando la persona rote.
 */
export function pdtpRe36ResponsiblesLabel(row: Pick<PdtpRe36Row, "responsibles" | "assigneeNames">): string {
  if (row.assigneeNames.length === 0) return row.responsibles
  return `${row.responsibles} (${row.assigneeNames.join(", ")})`
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
  /**
   * Fase 5: nombres de las personas que tienen esta actividad asignada
   * nominalmente en esta faena, vigentes **a la fecha de corte del documento**
   * (`cutoff.asOf`, en día chileno). Vacío cuando nadie la tiene a su nombre.
   *
   * Resolver a la fecha de corte —y no "a hoy"— es lo que mantiene reproducible
   * la foto congelada del cierre mensual: las vigencias se cierran en vez de
   * borrarse, así que preguntar por el 31 de marzo devuelve siempre lo mismo y
   * nombrar hoy a otro responsable no marca el mes cerrado como desviado.
   */
  assigneeNames: string[]
  scheduleMode: "scheduled" | "on_demand" | "triggered"
  /** Mínimo anual de una actividad "cuando corresponda"; `null` sin mínimo. */
  minAnnualExecutions: number | null
  /** 48 celdas: `(month-1)*4 + (week-1)`, mes 1-12, semana 1-4. */
  cells: PdtpRe36Cell[]
}

export type PdtpRe36Band = { code: string | null; name: string; fromRow: number; toRow: number }

/**
 * Una hoja del documento. **Invariante de coherencia (condicional, no
 * general)**: `Σ rows[].cells[].p` de ESTA hoja es igual a
 * `indicators.annual.planned` (`getPdtpComplianceIndicators`) **solo si**:
 *
 *   (a) esta hoja contiene TODAS las actividades del programa (no un
 *       subconjunto), y
 *   (b) ninguna de esas actividades usa `indicatorMode` distinto de
 *       `'planned_vs_completed'` — una `'coverage'` aporta al indicador el
 *       padrón (override manual, derivado, o `p` como último recurso), no la
 *       celda `p` cruda; una `'closed_on_time'` aporta casos vencidos con
 *       `p = 0` en el cronograma.
 *
 * El RE-36 real **no** cumple (a) entre hojas: las 8 hojas por cargo son
 * subconjuntos **solapados** de la hoja general (p. ej. la actividad 6 vive
 * en "GENERAL" y en "PRF Y Adm. de contrato"), así que sumar `p` de varias
 * hojas del mismo documento cuenta dos veces las actividades compartidas. La
 * igualdad solo es útil como chequeo de humo sobre UNA hoja que sea, de
 * hecho, el programa completo en modo `planned_vs_completed` — no se debe
 * generalizar a "la suma de todas las hojas" ni a programas con actividades
 * `coverage`/`closed_on_time`.
 */
export type PdtpRe36Sheet = { code: string; label: string; rows: PdtpRe36Row[]; bands: PdtpRe36Band[] }

/**
 * Una fila de la hoja "Desvíos". Todo lo que el renderizador escribe tal cual
 * ya viene en castellano: `kind` es la etiqueta ("No realizada", "No aplica",
 * "Reprogramada"), no el enum de la columna, y `recordedAt` es la fecha en
 * hora de Chile (`DD-MM-AAAA`), no un ISO en UTC.
 */
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

/**
 * Ocurrencia de una actividad creada con el calendario nuevo. Se mantiene
 * separada de las celdas 1..4 del RE-36 histórico: una fila representa una
 * ejecución concreta y conserva su semana ISO, estado y resultado.
 */
export type PdtpRe36IsoCalendarRow = {
  isoWeekYear: number
  isoWeek: number
  scheduledFor: string
  activity: string
  responsible: string
  destination: string
  instrument: string
  plannedQuantity: number
  status: string
  completedAt: string | null
  result: string
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
  /**
   * Indicador de **todo el programa** en esta faena (`getPdtpComplianceIndicators`),
   * no de una hoja: una hoja de cargo (p. ej. "CPHS", 4 actividades) y la
   * hoja general comparten exactamente el mismo `platformIndicators` — no es
   * un total por hoja. El renderizador (tarea 1.6) imprime, además, una fila
   * de totales **por hoja** con fórmulas `SUM` sobre las celdas de esa hoja
   * (así es el RE-36 real); ese total por hoja se deriva de `sheet.rows[].cells`
   * en el renderizador, no vive en este campo ni debe confundirse con él.
   */
  platformIndicators: {
    monthly: Array<{ month: number; planned: number; executed: number; percent: number | null; zeroActivities: number }>
    quarterly: Array<{ quarter: number; planned: number; executed: number; percent: number | null }>
  }
  signatures: {
    /** `at`: fecha tal como se declaró (texto libre u hora nativa, en su
     * formato original), o `null` si no hay ninguna declaración. `atIso`: esa
     * misma fecha normalizada a **ISO estricto** (`toCanonicalIso`/
     * `parseDeclaredDateToIso`) cuando se pudo interpretar — siempre el mismo
     * formato o siempre `null`, nunca una mezcla — para que el renderizador
     * pueda comparar/ordenar sin adivinar el formato de `at`. */
    elaboratedBy: { name: string; title: string; at: string | null; atIso: string | null }
    reviewedByJdpr: { name: string; title: string; at: string; atIso: string | null } | null
    approvedByLegal: { name: string; title: string; at: string; atIso: string | null } | null
  }
  /**
   * Ordenado por fecha (`atIso` cuando se conoce; las entradas sin fecha
   * interpretable quedan al final, en su orden relativo original). `at` es
   * el texto tal como se declaró (o la hora nativa ISO si no hubo
   * declaración); `atIso` es esa misma fecha normalizada, o `null` si no se
   * pudo interpretar con confianza.
   */
  changeControl: Array<{ at: string; atIso: string | null; description: string; actor: string | null }>
  glossary: Array<{ code: string; label: string }>
  legend: { onDemand: string; e0: string; eGte1: string }
  /**
   * Desvíos activos declarados en esta faena, ordenados por celda. Es el
   * anexo que explica por qué una celda tiene `E = 0`, por qué otra perdió su
   * `P`, o de dónde salió una cantidad que el catálogo no planificaba ahí.
   * Los desvíos retirados no aparecen: su rastro vive en `pdtp_change_log`
   * (y por esa vía en `changeControl`), no en el anexo del documento vigente.
   */
  deviations: PdtpRe36DeviationRow[]
  /** Instancias de las actividades nuevas, opcional para no alterar cierres
   * históricos que sólo contienen el modelo RE-36 legado. */
  isoCalendar?: PdtpRe36IsoCalendarRow[]
}

type ActivityRow = typeof pdtpActivities.$inferSelect
type SheetRow = typeof pdtpSheets.$inferSelect

const ISO_CALENDAR_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  in_progress: "En curso",
  submitted: "Enviada",
  completed: "Cumplida",
  completed_late: "Cumplida fuera de plazo",
  overdue: "Vencida",
  not_applicable: "No aplica",
  cancelled: "Cancelada",
}

function isoCalendarResult(sourceMetadataJson: unknown): string {
  if (!sourceMetadataJson || typeof sourceMetadataJson !== "object" || Array.isArray(sourceMetadataJson)) return "—"
  const metadata = sourceMetadataJson as Record<string, unknown>
  const executionId = typeof metadata.executionId === "string" ? metadata.executionId.trim() : ""
  if (executionId) return `Registro ${executionId}`
  const sourceRecordId = typeof metadata.sourceRecordId === "string" ? metadata.sourceRecordId.trim() : ""
  if (sourceRecordId) return `Fuente ${sourceRecordId}`
  const evidenceRef = typeof metadata.evidenceRef === "string" ? metadata.evidenceRef.trim() : ""
  if (evidenceRef) return `Evidencia ${evidenceRef}`
  const outcomeReason = typeof metadata.outcomeReason === "string" ? metadata.outcomeReason.trim() : ""
  return outcomeReason || "—"
}

function canonicalPdtpTimestamp(value: string | null): string | null {
  if (!value) return null
  const direct = toCanonicalIso(value)
  if (direct) return direct
  // PGlite/PostgreSQL may return `YYYY-MM-DD HH:MM:SS-04`; normalise the
  // separator and the short offset before asking the platform date parser.
  const postgresTimestamp = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")
  const parsed = new Date(postgresTimestamp)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

async function listPdtpRe36IsoCalendar(programId: string, worksiteId: string): Promise<PdtpRe36IsoCalendarRow[]> {
  const rows = await db.select({
    isoWeekYear: pdtpScheduledInstances.isoWeekYear,
    isoWeek: pdtpScheduledInstances.isoWeek,
    scheduledFor: pdtpScheduledInstances.scheduledFor,
    status: pdtpScheduledInstances.status,
    completedAt: pdtpScheduledInstances.completedAt,
    plannedQuantity: pdtpScheduledInstances.plannedQuantity,
    sourceMetadataJson: pdtpScheduledInstances.sourceMetadataJson,
    responsibleSlug: pdtpScheduledInstances.responsibleSlug,
    responsibleRoleSnapshot: pdtpScheduledInstances.responsibleRoleSnapshot,
    responsibleUserName: users.name,
    activity: pdtpActivities.activity,
    destinationConnectorKey: pdtpActivityExecutionConfigs.destinationConnectorKey,
    bindingSourceType: pdtpAccreditationBindings.sourceType,
    bindingSourceId: pdtpAccreditationBindings.sourceId,
    bindingEventType: pdtpAccreditationBindings.eventType,
  }).from(pdtpScheduledInstances)
    .innerJoin(pdtpActivities, eq(pdtpActivities.id, pdtpScheduledInstances.activityId))
    .leftJoin(users, eq(users.id, pdtpScheduledInstances.responsibleUserId))
    .leftJoin(pdtpActivityExecutionConfigs, eq(pdtpActivityExecutionConfigs.activityId, pdtpScheduledInstances.activityId))
    .leftJoin(pdtpAccreditationBindings, eq(pdtpAccreditationBindings.id, pdtpActivityExecutionConfigs.accreditationBindingId))
    .where(and(
      eq(pdtpScheduledInstances.programId, programId),
      eq(pdtpScheduledInstances.worksiteId, worksiteId),
    ))
    .orderBy(asc(pdtpScheduledInstances.scheduledFor), asc(pdtpActivities.n), asc(pdtpScheduledInstances.id))

  return rows.map((row) => {
    const derivedStatus = derivePdtpScheduledInstanceStatus({
      status: row.status,
      scheduledFor: row.scheduledFor,
      completedAt: row.completedAt ? (canonicalPdtpTimestamp(row.completedAt) ?? row.completedAt) : null,
    })
    const connector = getPdtpExecutionConnector(row.destinationConnectorKey)
    const bindingLabel = row.bindingSourceType && row.bindingSourceId && row.bindingEventType
      ? `${row.bindingSourceType} · ${row.bindingSourceId} · ${row.bindingEventType}`
      : null
    return {
      isoWeekYear: row.isoWeekYear,
      isoWeek: row.isoWeek,
      scheduledFor: row.scheduledFor,
      activity: row.activity,
      responsible: row.responsibleUserName ?? row.responsibleRoleSnapshot ?? row.responsibleSlug ?? "—",
      destination: connector?.label ?? row.destinationConnectorKey ?? "—",
      instrument: bindingLabel ?? "—",
      plannedQuantity: row.plannedQuantity,
      status: ISO_CALENDAR_STATUS_LABELS[derivedStatus] ?? derivedStatus,
      completedAt: row.completedAt ? (canonicalPdtpTimestamp(row.completedAt) ?? row.completedAt) : null,
      result: isoCalendarResult(row.sourceMetadataJson),
    }
  })
}

/**
 * Construye el documento RE-36 completo de un programa para una faena. No
 * renderiza nada: devuelve el modelo puro que la tarea 1.6 convierte a Excel.
 */
export async function buildPdtpRe36Document(input: {
  programId: string
  worksiteId: string
  scope: WorksiteScope
  sheetCodes?: string[]
  /**
   * Fecha de corte del documento (ISO). Default: el momento de la llamada.
   * Sin esto, dos generaciones del mismo estado producían documentos
   * distintos (`asOf` cambiaba) — la fase de cierre mensual congela y
   * compara exactamente este documento, así que tiene que ser reproducible.
   */
  asOf?: string
  /**
   * Mes de corte (1-12), o `null` para "año completo". Se refleja en
   * `cutoff.month` tal cual. `getPdtpComplianceIndicators` no acepta un
   * corte mensual hoy, así que `platformIndicators` sigue siendo del año
   * completo aunque se pase un mes — recortarlo de verdad queda para la fase
   * de cierre mensual, no para esta tarea.
   */
  cutoffMonth?: number | null
  /**
   * Variante "por persona": en vez de las hojas por cargo del formato, una
   * hoja por persona con asignación nominal vigente, con sus actividades. Es la
   * réplica de la hoja POR CARGO del Excel original, nominalizada — lo que la
   * faena imprime y le entrega a cada responsable.
   *
   * Si nadie tiene asignación nominal en esta faena no hay variante que
   * generar, y el documento vuelve a sus hojas normales en vez de salir vacío.
   */
  porPersona?: boolean
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
  // Orden del formato: GENERAL siempre primero, el resto alfabético por
  // código. `pdtp_general` es el código canónico de la plantilla 2026
  // (`sheet-meta-2026.ts`); `general` a secas cubre un programa genérico que
  // nombre su hoja completa así.
  const isGeneralSheetCode = (code: string) => {
    const normalized = code.toLowerCase()
    return normalized === "pdtp_general" || normalized === "general"
  }
  let resolvedSheets = [...sheetByCode.values()].sort((a, b) => {
    const aGeneral = isGeneralSheetCode(a.code)
    const bGeneral = isGeneralSheetCode(b.code)
    if (aGeneral !== bGeneral) return aGeneral ? -1 : 1
    return a.code.localeCompare(b.code)
  })
  if (input.sheetCodes) {
    const wanted = new Set(input.sheetCodes)
    resolvedSheets = resolvedSheets.filter((sheet) => wanted.has(sheet.code))
  }

  // Una sola consulta con `inArray` (no un `select` por hoja dentro de un
  // `for` secuencial) y se agrupa en memoria.
  const sheetIds = resolvedSheets.map((sheet) => sheet.id)
  const allMemberships = sheetIds.length > 0
    ? await db.select().from(pdtpSheetActivities)
        .where(inArray(pdtpSheetActivities.sheetId, sheetIds))
        .orderBy(asc(pdtpSheetActivities.sheetId), asc(pdtpSheetActivities.displayOrder))
    : []
  const membershipsBySheet = new Map<string, Array<typeof pdtpSheetActivities.$inferSelect>>()
  for (const membership of allMemberships) {
    const list = membershipsBySheet.get(membership.sheetId) ?? []
    list.push(membership)
    membershipsBySheet.set(membership.sheetId, list)
  }
  // Descarta SOLO las plantillas globales (`programId IS NULL`) sin
  // membresías en este programa: `listPdtpProgramSheets` las trae igual, y
  // una plantilla que nunca se materializó no tiene membresías propias —
  // emitirla produciría una pestaña vacía (`rows: []`) en el renderizador.
  // Una hoja PROPIA del programa (`programId` = este programa) se conserva
  // aunque esté vacía: crear una hoja y asignarle actividades son acciones
  // separadas (`sheet-management.ts`), así que un usuario puede crear
  // "Subcontrato XYZ" y no haberle asignado actividades todavía — filtrarla
  // por estar vacía la haría desaparecer en silencio del documento que firma
  // Legal, que es peor que mostrarla sin filas.
  resolvedSheets = resolvedSheets.filter((sheet) => (
    sheet.programId !== null || (membershipsBySheet.get(sheet.id) ?? []).length > 0
  ))

  const allActivityIdsSet = new Set<string>()
  for (const sheet of resolvedSheets) {
    for (const membership of membershipsBySheet.get(sheet.id) ?? []) allActivityIdsSet.add(membership.activityId)
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

  // ── Desvíos ───────────────────────────────────────────────────────────────
  //
  // El efecto sobre `P` ya viene aplicado: `loadProgramScheduleAndExecutions`
  // es la costura única y `scheduleRows` sale de ahí con las celdas
  // `not_applicable` eliminadas y las `reprogrammed` movidas. Acá NO se
  // recalcula nada de eso — sólo se anota, que es lo que el documento le debe
  // a quien lo audita: un `P` que desaparece o aparece sin explicación es
  // indistinguible de un error de planificación.
  //
  // El único valor que este bloque escribe es el `E = 0` del `not_performed`:
  // "se reportó la semana y no se ejecutó" es exactamente lo que la leyenda
  // del formato define como `E = 0` (`legend.e0`), y dejarlo vacío haría que
  // esa semana se leyera como "no se reportó".
  const deviationRows = filterPdtpRowsFromActivation(loaded.deviationRows, program.activatedAt)
    .filter((row) => !excludedActivityIds.has(row.activityId))
  const cellKeyOf = (activityId: string, month: number, week: number) => `${activityId}:${month}:${week}`
  const notesByCell = new Map<string, string[]>()
  const reportedNotExecutedCells = new Set<string>()
  const addCellNote = (activityId: string, month: number, week: number, note: string) => {
    const key = cellKeyOf(activityId, month, week)
    const notes = notesByCell.get(key) ?? []
    notes.push(note)
    notesByCell.set(key, notes)
  }
  const weekLabel = (month: number, week: number) => `${MONTH_LABELS[month - 1] ?? month} semana ${week}`
  for (const deviation of deviationRows) {
    if (deviation.kind === "not_performed") {
      reportedNotExecutedCells.add(cellKeyOf(deviation.activityId, deviation.month, deviation.week))
      addCellNote(deviation.activityId, deviation.month, deviation.week, `No realizada: ${deviation.reason}`)
    } else if (deviation.kind === "not_applicable") {
      addCellNote(deviation.activityId, deviation.month, deviation.week, `No aplica esta semana: ${deviation.reason}`)
    } else if (deviation.targetMonth !== null && deviation.targetWeek !== null) {
      addCellNote(
        deviation.activityId, deviation.month, deviation.week,
        `Reprogramada a ${weekLabel(deviation.targetMonth, deviation.targetWeek)}: ${deviation.reason}`,
      )
      addCellNote(
        deviation.activityId, deviation.targetMonth, deviation.targetWeek,
        `Recibe lo planificado de ${weekLabel(deviation.month, deviation.week)} (reprogramación): ${deviation.reason}`,
      )
    }
  }

  const objectives = await listPdtpObjectives(input.programId)
  const objectiveById = new Map(objectives.map((objective) => [objective.id, objective]))
  const hasObjectives = objectives.length > 0

  const responsibleSlugsUsed = new Set<string>()

  // Asignación nominal (Fase 5), a la fecha de corte del documento. El corte se
  // expresa en día chileno porque la vigencia de una asignación es una fecha
  // civil, no un instante: leerla en UTC movería el cambio de responsable entre
  // las 20:00 y la medianoche.
  const assigneeAsOf = input.asOf ? isoToChileDay(input.asOf) : todayInChile()
  const assigneeRows = await listPdtpActivityAssignees(input.programId, input.worksiteId, { asOf: assigneeAsOf })
  const assigneeNamesByActivity = new Map<string, string[]>()
  for (const assignee of assigneeRows) {
    const list = assigneeNamesByActivity.get(assignee.activityId) ?? []
    list.push(assignee.userName)
    assigneeNamesByActivity.set(assignee.activityId, list)
  }

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
          const notes = notesByCell.get(key)
          cells[cellIndex(month, week)] = {
            p: p === undefined ? null : p,
            // Sin ejecución pero con "no realizada" declarada: `E = 0`
            // explícito (se reportó la semana y no se ejecutó), no vacío.
            e: e === undefined ? (reportedNotExecutedCells.has(key) ? 0 : null) : e,
            ...(notes ? { note: notes.join("\n") } : {}),
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
        assigneeNames: assigneeNamesByActivity.get(activity.id) ?? [],
        scheduleMode: activity.scheduleMode as "scheduled" | "on_demand" | "triggered",
        minAnnualExecutions: activity.minAnnualExecutions ?? null,
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

  // ── Variante "por persona" ────────────────────────────────────────────────
  //
  // Réplica nominalizada de la hoja POR CARGO del Excel original: una pestaña
  // por persona con asignación nominal vigente, con las actividades que tiene a
  // su nombre. Las filas son las MISMAS que ya se armaron (mismas celdas P/E,
  // mismas notas de desvío) — acá sólo se reagrupan, no se recalcula nada.
  //
  // Las bandas se rehacen sobre el nuevo orden: un `fromRow`/`toRow` heredado
  // de la hoja general apuntaría a filas que en esta pestaña no existen.
  const outputSheets = input.porPersona
    ? buildPerPersonSheets(sheets, assigneeRows)
    : sheets

  const [indicators, isoCalendar] = await Promise.all([
    getPdtpComplianceIndicators(input.programId, input.worksiteId),
    listPdtpRe36IsoCalendar(input.programId, input.worksiteId),
  ])
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
  // `pdtp_change_log` posteriores o simultáneas al congelamiento
  // (`reviewStartedAt`). `>=`, no `>`: con `>` la entrada que *genera* el
  // congelamiento aparecía o no según cayeran o no en el mismo milisegundo
  // dos `new Date()` distintos — no determinista. Sin `reviewStartedAt`
  // (programa que nunca entró a revisión) no hay "posterior al
  // congelamiento" que mostrar, así que no se incluye ningún changelog.
  const changeLogRows = program.reviewStartedAt
    ? await db.select().from(pdtpChangeLog)
        .where(and(eq(pdtpChangeLog.programId, input.programId), gte(pdtpChangeLog.changedAt, program.reviewStartedAt)))
        .orderBy(asc(pdtpChangeLog.changedAt))
    : []

  const userIds = new Set<string>()
  for (const row of changeLogRows) if (row.changedByUserId) userIds.add(row.changedByUserId)
  if (program.approvedByJdprUserId) userIds.add(program.approvedByJdprUserId)
  if (program.approvedByLegalUserId) userIds.add(program.approvedByLegalUserId)
  for (const row of documentHistoryRows) if (row.linkedUserId) userIds.add(row.linkedUserId)
  for (const row of deviationRows) userIds.add(row.createdByUserId)
  const userRows = userIds.size > 0
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...userIds]))
    : []
  const userNameById = new Map(userRows.map((user) => [user.id, user.name]))

  // Anexo de desvíos, en el mismo orden en que se leen las celdas del
  // cronograma (N° de actividad, mes, semana) y no por fecha de registro: el
  // auditor llega acá desde una celda concreta, no desde una bitácora.
  const deviations: PdtpRe36DeviationRow[] = deviationRows
    .map((row) => {
      const activity = activityById.get(row.activityId)
      return {
        n: activity?.n ?? 0,
        activity: activity?.activity ?? "Actividad no encontrada",
        month: row.month,
        week: row.week,
        kind: pdtpDeviationKindLabel(row.kind),
        reason: row.reason,
        targetMonth: row.targetMonth,
        targetWeek: row.targetWeek,
        recordedBy: userNameById.get(row.createdByUserId) ?? "Usuario no encontrado",
        recordedAt: formatChileDay(row.createdAt),
      }
    })
    .sort((a, b) => a.n - b.n || a.month - b.month || a.week - b.week)

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
      atIso: parseDeclaredDateToIso(elaborationHistory?.declaredAtText),
    },
    // Prioridad: la aprobación nativa de Chome (autoritativa) sobre la
    // declaración importada del documento legado (solo si nunca hubo
    // aprobación nativa).
    reviewedByJdpr: program.approvedByJdprUserId
      ? {
          name: userNameById.get(program.approvedByJdprUserId) ?? "Usuario no encontrado",
          title: jdprStep?.label ?? "Revisión técnica JDPR",
          at: program.approvedByJdprAt ?? "",
          // Nativa: columna `timestamptz` (formato Postgres, no ISO estricto)
          // — se normaliza igual que cualquier otra fuente.
          atIso: toCanonicalIso(program.approvedByJdprAt),
        }
      : reviewHistory
        ? {
            name: (reviewHistory.linkedUserId ? userNameById.get(reviewHistory.linkedUserId) : null)
              ?? reviewHistory.declaredActorName ?? "—",
            title: reviewHistory.declaredActorTitle ?? "—",
            at: reviewHistory.declaredAtText ?? "",
            atIso: parseDeclaredDateToIso(reviewHistory.declaredAtText),
          }
        : null,
    approvedByLegal: program.approvedByLegalUserId
      ? {
          name: userNameById.get(program.approvedByLegalUserId) ?? "Usuario no encontrado",
          title: legalStep?.label ?? "Aprobación Legal y RRHH",
          at: program.approvedByLegalAt ?? "",
          atIso: toCanonicalIso(program.approvedByLegalAt),
        }
      : approvalHistory
        ? {
            name: (approvalHistory.linkedUserId ? userNameById.get(approvalHistory.linkedUserId) : null)
              ?? approvalHistory.declaredActorName ?? "—",
            title: approvalHistory.declaredActorTitle ?? "—",
            at: approvalHistory.declaredAtText ?? "",
            atIso: parseDeclaredDateToIso(approvalHistory.declaredAtText),
          }
        : null,
  }

  const changeControlFromHistory = documentHistoryRows
    .filter((row) => row.entryKind === "change_control")
    .map((row) => ({
      at: row.declaredAtText ?? row.createdAt,
      // Si se declaró texto libre, se intenta interpretarlo; si no hay texto
      // declarado, se normaliza la hora nativa de creación (columna
      // `timestamptz`, formato Postgres, no ISO estricto) con el mismo
      // canonicalizador que las demás fuentes — `atIso` debe ser siempre el
      // mismo formato o siempre `null`, nunca una mezcla.
      atIso: row.declaredAtText ? parseDeclaredDateToIso(row.declaredAtText) : toCanonicalIso(row.createdAt),
      description: row.description ?? "",
      actor: (row.linkedUserId ? userNameById.get(row.linkedUserId) : null) ?? row.declaredActorName ?? null,
    }))
  const changeControlFromLog = changeLogRows.map((row) => ({
    at: row.changedAt,
    atIso: toCanonicalIso(row.changedAt),
    description: row.note ?? `${row.section} actualizado.`,
    actor: row.changedByUserId ? (userNameById.get(row.changedByUserId) ?? null) : null,
  }))
  // Orden global por fecha conocida — ambas fuentes ya pasaron por el mismo
  // canonicalizador (`atIso` siempre ISO estricto o siempre `null`), así que
  // `localeCompare` sobre `atIso` sí compara cronológicamente (antes, una
  // fuente traía el formato nativo de Postgres crudo y otra ISO estricto: el
  // espacio del formato nativo ordena antes que la `T` de ISO y podía
  // invertir el orden real). Las entradas sin fecha interpretable quedan al
  // final, en su orden relativo original — `Array.prototype.sort` es
  // estable, no hay con qué ordenarlas mejor que eso.
  const changeControl = [...changeControlFromHistory, ...changeControlFromLog].sort((a, b) => {
    if (a.atIso && b.atIso) return a.atIso.localeCompare(b.atIso)
    if (a.atIso) return -1
    if (b.atIso) return 1
    return 0
  })

  // El código de un rol declarado (JDPR, PRF...) puede repetirse entre lotes
  // de importación distintos (el índice único de `pdtp_role_legend_entries`
  // incluye `sourceImportBatchId`, así que el mismo código puede insertarse
  // más de una vez para el mismo programa). Se deduplica por código,
  // quedándose con la primera declaración.
  const roleLegendByCode = new Map<string, { code: string; label: string }>()
  for (const row of roleLegendRows) {
    if (!roleLegendByCode.has(row.code)) roleLegendByCode.set(row.code, { code: row.code, label: row.label })
  }
  const roleLegendCodesLower = new Set([...roleLegendByCode.keys()].map((code) => code.toLowerCase()))
  const catalogRows = responsibleSlugsUsed.size > 0
    ? await db.select().from(pdtpResponsibleCatalog).where(inArray(pdtpResponsibleCatalog.slug, [...responsibleSlugsUsed]))
    : []
  const catalogBySlug = new Map(catalogRows.map((row) => [row.slug, row]))
  const glossary = [
    ...roleLegendByCode.values(),
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
    // Reproducible: sin `input.asOf`/`input.cutoffMonth` explícitos, cae al
    // comportamiento anterior (ahora, año completo) — pero un caller que
    // necesita congelar el documento (cierre mensual) puede fijarlos.
    cutoff: { asOf: input.asOf ?? new Date().toISOString(), year: program.year, month: input.cutoffMonth ?? null },
    sheets: outputSheets,
    platformIndicators,
    signatures,
    changeControl,
    glossary,
    legend: {
      onDemand: "Actividad con frecuencia: cada vez que sea necesario (a demanda). No entra al denominador de cumplimiento salvo que además tenga P planificado (actividad mixta) o declare un mínimo anual (\"cuando corresponda · mínimo N al año\"): lo que falte para ese mínimo se exige al cierre del año.",
      e0: "E = 0: se reportó la semana y no se ejecutó.",
      eGte1: "E ≥ 1: se ejecutó (bandera de cumplimiento o conteo de registros, según la actividad).",
    },
    deviations,
    isoCalendar,
  }
}

/**
 * Agrupa las filas ya construidas en una hoja por persona asignada.
 *
 * Devuelve las hojas originales cuando no hay ninguna asignación nominal: un
 * documento sin pestañas no lo abre Excel, y "nadie tiene nada asignado en esta
 * faena" no es un error que justifique negarle el export a quien lo pidió.
 */
function buildPerPersonSheets(
  sheets: PdtpRe36Sheet[],
  assignees: Array<{ activityId: string; userId: string; userName: string }>,
): PdtpRe36Sheet[] {
  if (assignees.length === 0) return sheets

  // Una fila por actividad, sin importar en cuántas hojas por cargo aparezca:
  // las hojas del RE-36 son subconjuntos solapados y duplicar la actividad en
  // la pestaña de la persona la haría contar dos veces al sumar.
  const rowByActivity = new Map<string, PdtpRe36Row>()
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      if (!rowByActivity.has(row.activityId)) rowByActivity.set(row.activityId, row)
    }
  }

  const byUser = new Map<string, { name: string; rows: PdtpRe36Row[] }>()
  for (const assignee of assignees) {
    const row = rowByActivity.get(assignee.activityId)
    if (!row) continue
    const entry = byUser.get(assignee.userId) ?? { name: assignee.userName, rows: [] }
    if (!entry.rows.some((existing) => existing.activityId === row.activityId)) entry.rows.push(row)
    byUser.set(assignee.userId, entry)
  }

  const personSheets = [...byUser.entries()]
    .filter(([, entry]) => entry.rows.length > 0)
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([userId, entry]) => {
      const rows = [...entry.rows].sort((a, b) => a.n - b.n)
      return {
        code: `persona:${userId}`,
        label: entry.name,
        rows,
        bands: bandsForRows(rows),
      }
    })

  return personSheets.length > 0 ? personSheets : sheets
}

/** Bandas por objetivo (o eje) sobre un orden de filas concreto, 1-based. */
function bandsForRows(rows: PdtpRe36Row[]): PdtpRe36Band[] {
  const bands: PdtpRe36Band[] = []
  let lastGroupKey: string | null = null
  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 1
    const code = row.objectiveCode
    const name = row.objectiveName ?? row.program
    const groupKey = code ? `obj:${code}` : `program:${row.program}`
    const currentBand = bands[bands.length - 1]
    if (currentBand && lastGroupKey === groupKey) {
      currentBand.toRow = rowNumber
    } else {
      bands.push({ code, name, fromRow: rowNumber, toRow: rowNumber })
    }
    lastGroupKey = groupKey
  }
  return bands
}
