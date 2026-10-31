/**
 * Lo que lee la ficha de una carga (`/combustibles/cargas/[origen]/[id]`): una sola
 * ficha para los tres orígenes. Cada cargador devuelve datos planos y ya
 * acotados por faena (`null` = 404, tanto si no existe como si está fuera del
 * alcance, para no revelar cuál). Lo que depende de un permiso se decide acá, en
 * el servidor, y no en la pantalla: sin `view_costs` los montos no salen de la
 * base; sin `view_personal` los nombres y las fotos no se consultan.
 */
import type { Session } from "next-auth"
import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  auditLog,
  fuelAnomalyCases,
  fuelAnomalyRules,
  fuelEquipmentLoads,
  fuelLoads,
  fuelOperationBatches,
  fuelOperationRecords,
  fuelReviewMarks,
  fuelTaeEvidence,
  fuelTaeSubmissions,
  statusHistory,
  users,
} from "@/db/schema"
import { can } from "@/lib/auth/can"
import { canAccessWorksite, isGlobalRole, worksiteScopeSql } from "@/lib/auth/scope"
import {
  ANOMALY_SEVERITY_LABELS,
  isOpenAnomalyCaseStatus,
  OPEN_ANOMALY_CASE_STATUSES,
  type AnomalySeverity,
  type OpenAnomalyCaseStatus,
} from "@/lib/combustibles/anomaly-labels"
import { ANOMALY_RULE_CATALOG } from "@/lib/combustibles/anomaly-rule-catalog"
import { assertFuelCostAccess } from "@/lib/operational-control/capabilities"
import { getTaeSubmissionContext } from "@/lib/services/fuel-tae/context"
import type { TaeAlert, TaeSubmissionRow } from "@/lib/services/fuel-tae/types"
import {
  buildLoadTimeline,
  type LoadTimelineEvent,
  type LoadTimelineInput,
  type TimelineAuditRow,
  type TimelineCaseRow,
  type TimelineMarkRow,
  type TimelineStatusRow,
} from "@/lib/combustibles/fuel-log-timeline"
import type { FuelLoadOrigin } from "@/lib/combustibles/routes"

/* ── Piezas comunes ──────────────────────────────────────────────────────── */

export interface LoadReviewState {
  equipmentLoadId: string
  reviewStatus: string
  flagReasons: string[]
  reviewNote: string | null
  reviewedByName: string | null
  reviewedAt: string | null
  performanceStatus: string
  /** Cuándo la plataforma la proyectó (y, si correspondía, la dejó por decidir). */
  createdAt: string
  duplicateOfId: string | null
}

export interface OpenReviewRequest {
  id: string
  note: string | null
  markedById: string
  markedByName: string | null
  createdAt: string
}

export interface LoadVehicle {
  id: string
  code: string | null
  plate: string | null
  typeName: string | null
  meterType: string
}

/**
 * Un caso de anomalía abierto sobre la carga: lo que la ficha lista y enlaza a
 * «Por revisar». Sin nombres de personas (quién lo tomó o lo cerró se ve en el
 * caso, no en la ficha de la carga).
 */
export interface LoadOpenCase {
  id: string
  ruleCode: string
  ruleName: string
  severity: AnomalySeverity
  status: OpenAnomalyCaseStatus
  detectedAt: string
}

export interface LoadCommon {
  origen: FuelLoadOrigin
  id: string
  worksiteId: string | null
  worksiteName: string | null
  vehicle: LoadVehicle | null
  /** «CA-14 · KPRT14»; cae a lo que traiga el registro cuando el equipo no está en la flota. */
  equipmentLabel: string
  review: LoadReviewState | null
  openRequest: OpenReviewRequest | null
  /** Casos abiertos sobre esta carga, de más a menos graves (ver `loadOpenCases`). */
  openCases: LoadOpenCase[]
  timeline: LoadTimelineEvent[]
}

type EntityType = "fuel_tae_submission" | "fuel_load" | "fuel_operation_record"

/** Tope de la lista de casos abiertos de una ficha: una carga rara vez junta más de un par. */
const OPEN_CASES_LIMIT = 20
/** Nombre de la regla cuando la fila de `fuel_anomaly_rules` no lo trae (misma salida que la ficha del equipo). */
const RULE_NAMES: Record<string, string> = Object.fromEntries(ANOMALY_RULE_CATALOG.map((rule) => [rule.code, rule.name]))
/** Crítica primero; una gravedad desconocida cae al final. */
const SEVERITY_RANK = sql`case ${fuelAnomalyCases.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`

/**
 * Los casos abiertos (`open`, `in_review`, `reopened`) que apuntan a ESTA carga:
 * por tipo e id de la entidad que referencian. Los más graves primero y, a igual
 * gravedad, el que lleva más tiempo esperando; con tope. Además del alcance de la
 * carga (que cada cargador comprueba antes de llegar acá), el caso mismo se acota
 * por faena: es la misma regla con que la bandeja lo lista, así que un enlace de
 * la ficha nunca cae en «no está en tus faenas».
 */
async function loadOpenCases(session: Session, entityType: EntityType, entityId: string): Promise<LoadOpenCase[]> {
  const rows = await db.select({
    id: fuelAnomalyCases.id,
    ruleCode: fuelAnomalyCases.ruleCode,
    ruleName: fuelAnomalyRules.name,
    severity: fuelAnomalyCases.severity,
    status: fuelAnomalyCases.status,
    detectedAt: fuelAnomalyCases.detectedAt,
  }).from(fuelAnomalyCases)
    .leftJoin(fuelAnomalyRules, eq(fuelAnomalyRules.id, fuelAnomalyCases.ruleId))
    .where(and(
      eq(fuelAnomalyCases.referenceEntityType, entityType),
      eq(fuelAnomalyCases.referenceEntityId, entityId),
      inArray(fuelAnomalyCases.status, [...OPEN_ANOMALY_CASE_STATUSES]),
      worksiteScopeSql(session, fuelAnomalyCases.worksiteId),
    ))
    .orderBy(SEVERITY_RANK, asc(fuelAnomalyCases.detectedAt), asc(fuelAnomalyCases.id))
    .limit(OPEN_CASES_LIMIT)

  return rows.flatMap((row): LoadOpenCase[] => {
    // El filtro de la consulta ya lo asegura; la guarda deja el tipo exacto sin un `as`.
    if (!isOpenAnomalyCaseStatus(row.status)) return []
    return [{
      id: row.id,
      ruleCode: row.ruleCode,
      ruleName: row.ruleName ?? RULE_NAMES[row.ruleCode] ?? "Caso abierto",
      severity: Object.hasOwn(ANOMALY_SEVERITY_LABELS, row.severity) ? (row.severity as AnomalySeverity) : "medium",
      status: row.status,
      detectedAt: row.detectedAt,
    }]
  })
}

/** Nombres de usuario por id, en una sola consulta. */
async function userNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  if (unique.length === 0) return new Map()
  const rows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, unique))
  return new Map(rows.map((row) => [row.id, row.name || row.email]))
}

async function loadVehicle(vehicleId: string | null): Promise<LoadVehicle | null> {
  if (!vehicleId) return null
  const row = await db.query.fuelVehicles.findFirst({
    where: (table, { eq: equals }) => equals(table.id, vehicleId),
    columns: { id: true, code: true, plate: true, meterType: true },
    with: { equipmentType: { columns: { name: true } } },
  })
  if (!row) return null
  return { id: row.id, code: row.code, plate: row.plate, typeName: row.equipmentType?.name ?? null, meterType: row.meterType }
}

function vehicleLabel(vehicle: LoadVehicle | null, snapshotCode?: string | null, snapshotPlate?: string | null): string {
  const code = vehicle?.code ?? snapshotCode ?? null
  const plate = vehicle?.plate ?? snapshotPlate ?? null
  return [code, plate].filter(Boolean).join(" · ") || "Equipo sin identificar"
}

/**
 * Lo que comparten las tres fichas: estado de revisión de la plataforma, pedidos
 * de revisión, casos (abiertos, y todos en la línea de tiempo) y la línea de
 * tiempo. La auditoría sólo entra a la línea de tiempo con `view_audit` (el
 * historial campo a campo es de quien audita). Cada cargador lo llama DESPUÉS de
 * comprobar el alcance de la carga: una carga ajena devuelve `null` sin leer nada de esto.
 */
async function loadSharedContext(
  session: Session,
  args: {
    origen: FuelLoadOrigin
    entityType: EntityType
    entityId: string
    equipmentLoadWhere: SQL | undefined
    timelineBase: Omit<LoadTimelineInput, "audit" | "statuses" | "marks" | "cases" | "flagged" | "canViewCosts">
  },
): Promise<{ review: LoadReviewState | null; openRequest: OpenReviewRequest | null; openCases: LoadOpenCase[]; timeline: LoadTimelineEvent[]; audit: TimelineAuditRow[] }> {
  const { origen, entityType, entityId } = args
  const canAudit = can(session, "combustibles:view_audit")
  const canViewCosts = (() => { try { assertFuelCostAccess(session); return true } catch { return false } })()

  const equipmentLoad = args.equipmentLoadWhere
    ? await db.query.fuelEquipmentLoads.findFirst({ where: args.equipmentLoadWhere })
    : undefined

  const [marksRaw, casesRaw, statusRaw, auditRaw, equipmentAuditRaw, openCases] = await Promise.all([
    db.select().from(fuelReviewMarks).where(and(eq(fuelReviewMarks.entityType, entityType), eq(fuelReviewMarks.entityId, entityId))).orderBy(asc(fuelReviewMarks.createdAt)),
    db.select({
      id: fuelAnomalyCases.id,
      ruleName: fuelAnomalyRules.name,
      severity: fuelAnomalyCases.severity,
      status: fuelAnomalyCases.status,
      detectedAt: fuelAnomalyCases.detectedAt,
      resolvedAt: fuelAnomalyCases.resolvedAt,
      resolvedById: fuelAnomalyCases.resolvedById,
      resolution: fuelAnomalyCases.resolution,
    }).from(fuelAnomalyCases)
      .innerJoin(fuelAnomalyRules, eq(fuelAnomalyCases.ruleId, fuelAnomalyRules.id))
      .where(and(eq(fuelAnomalyCases.referenceEntityType, entityType), eq(fuelAnomalyCases.referenceEntityId, entityId)))
      .orderBy(asc(fuelAnomalyCases.detectedAt)),
    origen === "planilla"
      ? Promise.resolve([] as Array<typeof statusHistory.$inferSelect>)
      : db.select().from(statusHistory).where(and(eq(statusHistory.entityType, entityType), eq(statusHistory.entityId, entityId))).orderBy(asc(statusHistory.changedAt)),
    canAudit
      ? db.select().from(auditLog).where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId))).orderBy(asc(auditLog.createdAt))
      : Promise.resolve([] as Array<typeof auditLog.$inferSelect>),
    canAudit && equipmentLoad
      ? db.select().from(auditLog).where(and(eq(auditLog.entityType, "fuel_equipment_load"), eq(auditLog.entityId, equipmentLoad.id))).orderBy(asc(auditLog.createdAt))
      : Promise.resolve([] as Array<typeof auditLog.$inferSelect>),
    loadOpenCases(session, entityType, entityId),
  ])

  const names = await userNames([
    ...marksRaw.flatMap((mark) => [mark.markedBy, mark.resolvedBy]),
    ...casesRaw.map((row) => row.resolvedById),
    ...statusRaw.map((row) => row.changedBy),
    ...auditRaw.map((row) => row.userId),
    ...equipmentAuditRaw.map((row) => row.userId),
    equipmentLoad?.reviewedBy,
  ])

  const marks: TimelineMarkRow[] = marksRaw.map((mark) => ({
    id: mark.id,
    status: mark.status,
    notes: mark.notes,
    createdAt: mark.createdAt,
    markedByName: names.get(mark.markedBy) ?? null,
    resolvedAt: mark.resolvedAt,
    resolvedByName: mark.resolvedBy ? names.get(mark.resolvedBy) ?? null : null,
    resolutionNote: mark.resolutionNote,
  }))
  const cases: TimelineCaseRow[] = casesRaw.map((row) => ({
    id: row.id,
    ruleName: row.ruleName,
    severity: row.severity,
    status: row.status,
    detectedAt: row.detectedAt,
    resolvedAt: row.resolvedAt,
    resolvedByName: row.resolvedById ? names.get(row.resolvedById) ?? null : null,
    resolution: row.resolution,
  }))
  const statuses: TimelineStatusRow[] = statusRaw.map((row) => ({
    id: row.id,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    changedAt: row.changedAt,
    actor: row.changedBy ? names.get(row.changedBy) ?? null : null,
    reason: row.reason,
  }))
  const audit: TimelineAuditRow[] = [...auditRaw, ...equipmentAuditRaw].map((row) => ({
    id: row.id,
    action: row.action,
    createdAt: row.createdAt,
    actor: row.userId ? names.get(row.userId) ?? row.userEmail ?? null : row.userEmail ?? null,
    entityType: row.entityType,
    oldState: row.oldState,
    newState: row.newState,
    reason: row.reason,
  }))

  const review: LoadReviewState | null = equipmentLoad
    ? {
        equipmentLoadId: equipmentLoad.id,
        reviewStatus: equipmentLoad.reviewStatus,
        flagReasons: equipmentLoad.flagReasons ?? [],
        reviewNote: equipmentLoad.reviewNote,
        reviewedByName: equipmentLoad.reviewedBy ? names.get(equipmentLoad.reviewedBy) ?? null : null,
        reviewedAt: equipmentLoad.reviewedAt,
        performanceStatus: equipmentLoad.performanceStatus,
        createdAt: equipmentLoad.createdAt,
        duplicateOfId: equipmentLoad.duplicateOfId,
      }
    : null

  const open = marksRaw.find((mark) => mark.status === "open")
  const openRequest: OpenReviewRequest | null = open
    ? { id: open.id, note: open.notes, markedById: open.markedBy, markedByName: names.get(open.markedBy) ?? null, createdAt: open.createdAt }
    : null

  const timeline = buildLoadTimeline({
    ...args.timelineBase,
    canViewCosts,
    flagged: review && review.flagReasons.length > 0 ? { at: review.createdAt, reasons: review.flagReasons } : null,
    audit,
    statuses,
    marks,
    cases,
  })

  return { review, openRequest, openCases, timeline, audit }
}

/* ── Registro en terreno ─────────────────────────────────────────────────── */

export interface TerrenoNeighbor {
  id: string
  loadedAt: string
  liters: number
  meterReading: number | null
  meterType: string
  installedSealNumber: string | null
  status: string
}

/**
 * El registro tal como lo lee la ficha: sin los nombres de quien cargó y supervisó
 * (van aparte, sólo con `view_personal`), sin la clave de la página pública de
 * resultado ni el texto crudo de la lectura. La fila completa no sale de este módulo.
 */
export type TerrenoSubmission = Omit<TaeSubmissionRow, "publicResultToken" | "publicResultRevokedAt" | "clientSubmissionId" | "ocrRawText" | "rawRow" | "driverNameSnapshot" | "supervisorNameSnapshot">

const HIDDEN_SUBMISSION_FIELDS = ["publicResultToken", "publicResultRevokedAt", "clientSubmissionId", "ocrRawText", "rawRow", "driverNameSnapshot", "supervisorNameSnapshot"] as const

function visibleSubmission(row: TaeSubmissionRow): TerrenoSubmission {
  const copy: Record<string, unknown> = { ...row }
  for (const key of HIDDEN_SUBMISSION_FIELDS) delete copy[key]
  return copy as TerrenoSubmission
}

export interface TerrenoDetail extends LoadCommon {
  origen: "terreno"
  submission: TerrenoSubmission
  worksiteName: string | null
  loadingPointName: string | null
  productName: string | null
  productUnit: string | null
  supplyMediumName: string | null
  importBatchFileName: string | null
  alerts: TaeAlert[]
  previous: TerrenoNeighbor | null
  next: TerrenoNeighbor | null
  /** Las fotos, sólo con `view_personal`; sin él ni se consultan. */
  evidence: Array<{ id: string; kind: string; fileName: string | null; filePath: string | null; fileSize: number | null; mimeType: string | null; sha256: string | null; capturedAt: string | null; createdAt: string | null }>
  evidenceCount: number
  registeredByName: string | null
  reviewedByName: string | null
  /** Nombres de quien cargó y de quien supervisó; `null` sin `view_personal`. */
  driverName: string | null
  supervisorName: string | null
}

function toNeighbor(row: TaeSubmissionRow | null): TerrenoNeighbor | null {
  return row
    ? { id: row.id, loadedAt: row.loadedAt, liters: Number(row.liters), meterReading: row.meterReading, meterType: row.meterType, installedSealNumber: row.installedSealNumber, status: row.status }
    : null
}

export async function loadTerrenoDetail(session: Session, id: string): Promise<TerrenoDetail | null> {
  const submission = await db.query.fuelTaeSubmissions.findFirst({
    where: eq(fuelTaeSubmissions.id, id),
    with: {
      worksite: { columns: { name: true } },
      loadingPoint: { columns: { name: true } },
      product: { columns: { name: true, unit: true } },
      importBatch: { columns: { fileName: true } },
    },
  })
  if (!submission || !canAccessWorksite(session, submission.worksiteId)) return null

  const canPersonal = can(session, "combustibles:view_personal")
  const [vehicle, context, evidence, evidenceCount, supplyMedium, names] = await Promise.all([
    loadVehicle(submission.vehicleId),
    getTaeSubmissionContext(submission),
    // Las fotos y los nombres son datos personales (D-10, P-01): sin `view_personal` ni se consultan.
    canPersonal
      ? db.query.fuelTaeEvidence.findMany({ where: (table, { eq: equals }) => equals(table.submissionId, id) })
      : Promise.resolve([] as Array<typeof fuelTaeEvidence.$inferSelect>),
    // Cuántas fotos hay sí se puede decir (es un conteo, no la imagen).
    db.query.fuelTaeEvidence.findMany({ where: (table, { eq: equals }) => equals(table.submissionId, id), columns: { id: true } }).then((rows) => rows.length),
    submission.supplyMediumId
      ? db.query.fuelSupplyMedia.findFirst({ where: (table, { eq: equals }) => equals(table.id, submission.supplyMediumId as string), columns: { name: true } })
      : Promise.resolve(null),
    userNames([submission.registeredBy, submission.reviewedBy]),
  ])
  const shared = await loadSharedContext(session, {
    origen: "terreno",
    entityType: "fuel_tae_submission",
    entityId: id,
    equipmentLoadWhere: eq(fuelEquipmentLoads.taeSubmissionId, id),
    timelineBase: {
      origen: "terreno",
      createdAt: submission.createdAt,
      registeredByName: submission.registeredBy ? names.get(submission.registeredBy) ?? null : null,
      terrenoSource: submission.source as "public_pwa" | "internal_app" | "legacy_xlsx",
      backdateReason: submission.backdateReason,
    },
  })

  return {
    origen: "terreno",
    id,
    worksiteId: submission.worksiteId,
    worksiteName: submission.worksite?.name ?? null,
    vehicle,
    equipmentLabel: vehicleLabel(vehicle, submission.equipmentCodeSnapshot, submission.plateSnapshot),
    review: shared.review,
    openRequest: shared.openRequest,
    openCases: shared.openCases,
    timeline: shared.timeline,
    submission: visibleSubmission(submission),
    loadingPointName: submission.loadingPoint?.name ?? null,
    productName: submission.product?.name ?? null,
    productUnit: submission.product?.unit ?? null,
    supplyMediumName: supplyMedium?.name ?? null,
    importBatchFileName: submission.importBatch?.fileName ?? null,
    alerts: context.alerts,
    previous: toNeighbor(context.previous),
    next: toNeighbor(context.next),
    evidence: evidence.map((item) => ({
      id: item.id, kind: item.kind, fileName: item.fileName, filePath: item.filePath, fileSize: item.fileSize,
      mimeType: item.mimeType, sha256: item.sha256, capturedAt: item.capturedAt, createdAt: item.createdAt,
    })),
    evidenceCount,
    registeredByName: submission.registeredBy ? names.get(submission.registeredBy) ?? null : null,
    reviewedByName: submission.reviewedBy ? names.get(submission.reviewedBy) ?? null : null,
    // D-10: sin `view_personal` el nombre ni sale de la consulta hacia la página.
    driverName: canPersonal ? submission.driverNameSnapshot : null,
    supervisorName: canPersonal ? submission.supervisorNameSnapshot : null,
  }
}

/* ── Planilla de cargas ──────────────────────────────────────────────────── */

export interface PlanillaDetail extends LoadCommon {
  origen: "planilla"
  record: {
    fecha: string
    horaCarga: string | null
    plate: string
    code: string | null
    faenaNombre: string | null
    tipo: string | null
    marca: string | null
    modelo: string | null
    anio: number | null
    horometro: number | null
    medidoPor: string | null
    liters: number
    proveedorNombre: string | null
    rendimiento: number | null
    tipoRendimiento: string | null
    createdAt: string
  }
  /** Precio, monto: `null` sin `view_costs`. */
  costs: { precioLitro: number | null; monto: number | null } | null
  /** `combustibles:view_personal`: sin él `operador` y `supervisor` salen `null` aunque la planilla los traiga. */
  canViewPersonal: boolean
  operador: string | null
  supervisor: string | null
  supplierName: string | null
  batch: { id: string; fileName: string; importedAt: string; importedByName: string | null; status: string; periodoDesde: string; periodoHasta: string; totalFilas: number; filasInvalidas: number }
  /** Valores tal como venían en el archivo (sin personas ni montos cuando falta el permiso). */
  rawRow: Array<{ key: string; value: string }>
}

const PERSONAL_RAW_KEYS = /operador|supervisor|conductor|chofer|rut/i
const COST_RAW_KEYS = /monto|precio|total|valor|iva|iec|neto/i

export async function loadPlanillaDetail(session: Session, id: string): Promise<PlanillaDetail | null> {
  const record = await db.query.fuelOperationRecords.findFirst({
    where: eq(fuelOperationRecords.id, id),
    with: {
      worksite: { columns: { name: true } },
      supplier: { columns: { name: true } },
    },
  })
  if (!record) return null
  // Una fila sin faena vinculada (patente o faena sin reconocer) sólo la ven los roles globales.
  if (record.worksiteId ? !canAccessWorksite(session, record.worksiteId) : !isGlobalRole(session)) return null

  const canPersonal = can(session, "combustibles:view_personal")
  const canViewCosts = (() => { try { assertFuelCostAccess(session); return true } catch { return false } })()

  const batch = await db.query.fuelOperationBatches.findFirst({ where: eq(fuelOperationBatches.id, record.batchId) })
  if (!batch) return null
  const [vehicle, importer] = await Promise.all([loadVehicle(record.vehicleId), userNames([batch.importadoPor])])
  const importedByName = importer.get(batch.importadoPor) ?? null
  const shared = await loadSharedContext(session, {
    origen: "planilla",
    entityType: "fuel_operation_record",
    entityId: id,
    equipmentLoadWhere: eq(fuelEquipmentLoads.operationRecordId, id),
    timelineBase: {
      origen: "planilla",
      createdAt: record.createdAt,
      registeredByName: null,
      batch: { fileName: batch.archivoNombre, importedByName },
    },
  })

  const rawEntries = record.rawRow && typeof record.rawRow === "object" && !Array.isArray(record.rawRow)
    ? Object.entries(record.rawRow as Record<string, unknown>)
    : []

  return {
    origen: "planilla",
    id,
    worksiteId: record.worksiteId,
    worksiteName: record.worksite?.name ?? record.faenaNombre,
    vehicle,
    equipmentLabel: vehicleLabel(vehicle, record.code, record.plate),
    review: shared.review,
    openRequest: shared.openRequest,
    openCases: shared.openCases,
    timeline: shared.timeline,
    record: {
      fecha: record.fecha,
      horaCarga: record.horaCarga,
      plate: record.plate,
      code: record.code,
      faenaNombre: record.faenaNombre,
      tipo: record.tipo,
      marca: record.marca,
      modelo: record.modelo,
      anio: record.anio,
      horometro: record.horometro,
      medidoPor: record.medidoPor,
      liters: Number(record.liters),
      proveedorNombre: record.proveedorNombre,
      rendimiento: record.rendimiento,
      tipoRendimiento: record.tipoRendimiento,
      createdAt: record.createdAt,
    },
    costs: canViewCosts ? { precioLitro: record.precioLitro, monto: record.monto } : null,
    canViewPersonal: canPersonal,
    operador: canPersonal ? record.operador : null,
    supervisor: canPersonal ? record.supervisor : null,
    supplierName: record.supplier?.name ?? record.proveedorNombre,
    batch: {
      id: batch.id,
      fileName: batch.archivoNombre,
      importedAt: batch.createdAt,
      importedByName,
      status: batch.estado,
      periodoDesde: batch.periodoDesde,
      periodoHasta: batch.periodoHasta,
      totalFilas: batch.totalFilas,
      filasInvalidas: batch.filasInvalidas,
    },
    rawRow: rawEntries
      .filter(([key]) => (canPersonal || !PERSONAL_RAW_KEYS.test(key)) && (canViewCosts || !COST_RAW_KEYS.test(key)))
      .filter(([, value]) => value !== null && value !== undefined && value !== "")
      .map(([key, value]) => ({ key, value: typeof value === "object" ? JSON.stringify(value) : String(value) })),
  }
}

/* ── Factura ─────────────────────────────────────────────────────────────── */

export interface FacturaDetail extends LoadCommon {
  origen: "factura"
  load: typeof fuelLoads.$inferSelect
  supplierName: string | null
  /** `view` + `view_costs` (`assertFuelCostAccess`): sin él la ficha queda en lectura y los montos salen en 0. */
  canViewCosts: boolean
  createdByName: string | null
}

export async function loadFacturaDetail(session: Session, id: string): Promise<FacturaDetail | null> {
  const load = await db.query.fuelLoads.findFirst({
    where: eq(fuelLoads.id, id),
    with: { supplier: { columns: { name: true } }, worksite: { columns: { name: true } } },
  })
  if (!load || !canAccessWorksite(session, load.worksiteId)) return null

  const canViewCosts = (() => { try { assertFuelCostAccess(session); return true } catch { return false } })()
  const [vehicle, creator] = await Promise.all([loadVehicle(load.vehicleId), userNames([load.createdBy])])
  const shared = await loadSharedContext(session, {
    origen: "factura",
    entityType: "fuel_load",
    entityId: id,
    equipmentLoadWhere: undefined,
    timelineBase: { origen: "factura", createdAt: load.createdAt, registeredByName: load.createdBy ? creator.get(load.createdBy) ?? null : null },
  })

  return {
    origen: "factura",
    id,
    worksiteId: load.worksiteId,
    worksiteName: load.worksite?.name ?? null,
    vehicle,
    equipmentLabel: vehicleLabel(vehicle),
    review: shared.review,
    openRequest: shared.openRequest,
    openCases: shared.openCases,
    timeline: shared.timeline,
    // Sin `view_costs` los montos salen en 0 de la consulta misma: la ficha ni los recibe.
    load: canViewCosts ? load : { ...load, iecFixed: 0, iecVariable: 0, baseAmount: 0, iecTotal: 0, ivaAmount: 0, totalAmount: 0 },
    supplierName: load.supplier?.name ?? null,
    canViewCosts,
    createdByName: load.createdBy ? creator.get(load.createdBy) ?? null : null,
  }
}

/* ── Historial campo a campo ─────────────────────────────────────────────── */

export interface LoadHistory {
  origen: FuelLoadOrigin
  id: string
  worksiteId: string | null
  equipmentLabel: string
  timeline: LoadTimelineEvent[]
  /** La auditoría tal cual, para «Ver cambios campo a campo». */
  audit: TimelineAuditRow[]
}

/** Historial de una carga para quien tiene `view_audit`. `null` si no existe o está fuera del alcance. */
export async function loadHistory(session: Session, origen: FuelLoadOrigin, id: string): Promise<LoadHistory | null> {
  if (origen === "terreno") {
    const detail = await loadTerrenoDetail(session, id)
    return detail ? await historyFrom(session, detail, "fuel_tae_submission") : null
  }
  if (origen === "planilla") {
    const detail = await loadPlanillaDetail(session, id)
    return detail ? await historyFrom(session, detail, "fuel_operation_record") : null
  }
  const detail = await loadFacturaDetail(session, id)
  return detail ? await historyFrom(session, detail, "fuel_load") : null
}

async function historyFrom(session: Session, detail: LoadCommon, entityType: EntityType): Promise<LoadHistory> {
  // La auditoría completa (no sólo la que alimenta la línea de tiempo): incluye la de la fila proyectada.
  const equipmentIds = detail.review ? [detail.review.equipmentLoadId] : []
  const rows = await db.select().from(auditLog)
    .where(or(
      and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, detail.id)),
      equipmentIds.length > 0 ? and(eq(auditLog.entityType, "fuel_equipment_load"), inArray(auditLog.entityId, equipmentIds)) : undefined,
    ))
    .orderBy(desc(auditLog.createdAt))
  const names = await userNames(rows.map((row) => row.userId))
  const canViewCosts = (() => { try { assertFuelCostAccess(session); return true } catch { return false } })()
  return {
    origen: detail.origen,
    id: detail.id,
    worksiteId: detail.worksiteId,
    equipmentLabel: detail.equipmentLabel,
    timeline: detail.timeline,
    audit: rows.map((row) => ({
      id: row.id,
      action: row.action,
      createdAt: row.createdAt,
      actor: row.userId ? names.get(row.userId) ?? row.userEmail ?? null : row.userEmail ?? null,
      entityType: row.entityType,
      // Los montos no salen de la base hacia quien no puede verlos, tampoco por la auditoría.
      oldState: canViewCosts ? row.oldState : redactAmounts(row.oldState),
      newState: canViewCosts ? row.newState : redactAmounts(row.newState),
      reason: row.reason,
    })),
  }
}

const AMOUNT_KEYS = ["baseAmount", "iecFixed", "iecVariable", "iecTotal", "ivaAmount", "totalAmount", "unitPrice", "price", "precioLitro", "monto"]

function redactAmounts(state: string | null): string | null {
  if (!state) return state
  try {
    const parsed: unknown = JSON.parse(state)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return state
    const copy = { ...(parsed as Record<string, unknown>) }
    for (const key of AMOUNT_KEYS) delete copy[key]
    return JSON.stringify(copy)
  } catch {
    return null
  }
}
