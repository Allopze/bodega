import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db } from "@/db"
import {
  fuelEquipmentTypes, fuelVehicles, mantEquipmentProfiles, mantRecords, mantWorkOrderEvents, mantWorkOrderItems, mantWorkOrders,
  preventionInspectionFindings, users, worksites,
} from "@/db/schema"
import { daysBetween } from "@/lib/mantencion/readings"
import {
  OT_OPEN_STATUSES, type OtEventType, type OtItemDone, type OtItemKind, type OtItemOrigin, type OtStatus, type OtWorkshopKind,
} from "@/lib/mantencion/work-order-states"
import { todayInChile } from "@/lib/utils"
import { canSeeRecord, recordVisibility, type MantViewer } from "../access"
import { listMantCatalogs } from "../catalogs"
import { unitFromMeter } from "../fleet"
import {
  allowedTransitions, canEditExecution, canEditRequest, canRegisterWorkOrderRecord, canSeeWorkOrder, workOrderVisibility, workOrderVisibilitySql,
} from "./access"
import { linkedRecordState } from "./core"
import { findAssignableMechanics, findWorksiteMechanics, listAssignableMechanicsWithWorksites, type WorksiteMechanic } from "./mechanics"
import type { WorkOrderDetail, WorkOrderListRow } from "./types"

/**
 * Lectura de las órdenes de trabajo para la lista, el detalle, los filtros y los
 * selectores del alta. SIEMPRE con el alcance del usuario (`access.ts`): un
 * filtro de la URL nunca amplía lo que se ve.
 */

/** Pestañas de la lista (StageTabs, `?estado=`). `abiertas` agrupa todo lo no cerrado ni anulado. */
export const WORK_ORDER_TABS = ["abiertas", "solicitada", "asignada", "en_ejecucion", "trabajo_terminado", "recepcionada", "cerrada", "anulada"] as const
export type WorkOrderTab = (typeof WORK_ORDER_TABS)[number]

export interface WorkOrderListFilters {
  tab: WorkOrderTab
  worksiteId?: string
  vehicleId?: string
  assignedToUserId?: string
  /** Período sobre la fecha de la OT (`request_date`), YYYY-MM-DD. */
  from?: string
  to?: string
  /** Búsqueda en el servidor: folio, código o patente del equipo, solicitante. */
  q?: string
  page: number
  pageSize: number
}

export interface WorkOrderListResult {
  rows: WorkOrderListRow[]
  total: number
  /** Conteo por pestaña con los mismos filtros (sin la pestaña). */
  counts: Record<WorkOrderTab, number>
}

const MAX_PAGE_SIZE = 200
const iso = (value: string) => new Date(value).toISOString()
const isoOrNull = (value: string | null) => (value ? iso(value) : null)

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

/** Filtros comunes a la lista y a los conteos (todo menos la pestaña). */
function baseWhere(viewer: MantViewer, filters: Omit<WorkOrderListFilters, "tab" | "page" | "pageSize">): SQL {
  const q = filters.q?.trim()
  return and(
    workOrderVisibilitySql(workOrderVisibility(viewer)),
    filters.worksiteId ? eq(mantWorkOrders.worksiteId, filters.worksiteId) : undefined,
    filters.vehicleId ? eq(mantWorkOrders.vehicleId, filters.vehicleId) : undefined,
    filters.assignedToUserId ? eq(mantWorkOrders.assignedToUserId, filters.assignedToUserId) : undefined,
    filters.from ? gte(mantWorkOrders.requestDate, filters.from) : undefined,
    filters.to ? lte(mantWorkOrders.requestDate, filters.to) : undefined,
    q
      ? sql`(${mantWorkOrders.folio} ilike ${likePattern(q)}
          or ${mantWorkOrders.equipmentSnapshot}->>'code' ilike ${likePattern(q)}
          or ${mantWorkOrders.equipmentSnapshot}->>'plate' ilike ${likePattern(q)}
          or ${mantWorkOrders.requesterName} ilike ${likePattern(q)})`
      : undefined,
  )!
}

function tabWhere(tab: WorkOrderTab): SQL | undefined {
  if (tab === "abiertas") return inArray(mantWorkOrders.status, [...OT_OPEN_STATUSES])
  return eq(mantWorkOrders.status, tab)
}

function daysInWorkshop(row: { status: string; workshopEntryAt: string | null; workshopExitAt: string | null }, today: string): number | null {
  if (!row.workshopEntryAt) return null
  const entryDay = todayInChile(row.workshopEntryAt)
  if (row.workshopExitAt) return Math.max(0, daysBetween(entryDay, todayInChile(row.workshopExitAt)))
  if (row.status === "en_ejecucion") return Math.max(0, daysBetween(entryDay, today))
  return null
}

type ListSource = {
  id: string; folio: string; status: string; vehicleId: string; equipmentSnapshot: typeof mantWorkOrders.$inferSelect["equipmentSnapshot"]
  worksiteId: string; worksiteName: string; repair: boolean; maintenance: boolean; requestDate: string; requesterName: string
  assignedToUserId: string | null; assignedToName: string | null; workshopEntryAt: string | null; estimatedDeliveryDate: string | null
  workshopExitAt: string | null; rejectionCount: number; createdAt: string
}

function toListRow(row: ListSource, today: string): WorkOrderListRow {
  return {
    id: row.id,
    folio: row.folio,
    status: row.status as OtStatus,
    vehicleId: row.vehicleId,
    equipmentCode: row.equipmentSnapshot.code,
    equipmentPlate: row.equipmentSnapshot.plate,
    equipmentType: row.equipmentSnapshot.type,
    worksiteId: row.worksiteId,
    worksiteName: row.worksiteName,
    repair: row.repair,
    maintenance: row.maintenance,
    requestDate: row.requestDate,
    requesterName: row.requesterName,
    assignedToUserId: row.assignedToUserId,
    assignedToName: row.assignedToName,
    workshopEntryAt: isoOrNull(row.workshopEntryAt),
    estimatedDeliveryDate: row.estimatedDeliveryDate,
    workshopExitAt: isoOrNull(row.workshopExitAt),
    estimateOverdue: row.status === "en_ejecucion" && !!row.estimatedDeliveryDate && row.estimatedDeliveryDate < today,
    daysInWorkshop: daysInWorkshop(row, today),
    rejectionCount: row.rejectionCount,
    createdAt: iso(row.createdAt),
  }
}

const assignee = alias(users, "assignee")

const listColumns = {
  id: mantWorkOrders.id,
  folio: mantWorkOrders.folio,
  status: mantWorkOrders.status,
  vehicleId: mantWorkOrders.vehicleId,
  equipmentSnapshot: mantWorkOrders.equipmentSnapshot,
  worksiteId: mantWorkOrders.worksiteId,
  worksiteName: worksites.name,
  repair: mantWorkOrders.repair,
  maintenance: mantWorkOrders.maintenance,
  requestDate: mantWorkOrders.requestDate,
  requesterName: mantWorkOrders.requesterName,
  assignedToUserId: mantWorkOrders.assignedToUserId,
  assignedToName: assignee.name,
  workshopEntryAt: mantWorkOrders.workshopEntryAt,
  estimatedDeliveryDate: mantWorkOrders.estimatedDeliveryDate,
  workshopExitAt: mantWorkOrders.workshopExitAt,
  rejectionCount: mantWorkOrders.rejectionCount,
  createdAt: mantWorkOrders.createdAt,
}

/** `WHERE` de la lista con la pestaña elegida: lo comparten la lista y el Excel. */
export function workOrdersWhere(viewer: MantViewer, filters: Omit<WorkOrderListFilters, "page" | "pageSize">): SQL {
  return and(baseWhere(viewer, filters), tabWhere(filters.tab))!
}

export async function listWorkOrders(viewer: MantViewer, filters: WorkOrderListFilters): Promise<WorkOrderListResult> {
  const base = baseWhere(viewer, filters)
  const pageSize = Math.min(Math.max(1, filters.pageSize), MAX_PAGE_SIZE)
  const page = Math.max(1, filters.page)
  const today = todayInChile()

  const [countRows, rows] = await Promise.all([
    db.select({ status: mantWorkOrders.status, count: sql<number>`count(*)::int` })
      .from(mantWorkOrders).where(base).groupBy(mantWorkOrders.status),
    db.select(listColumns)
      .from(mantWorkOrders)
      .innerJoin(worksites, eq(worksites.id, mantWorkOrders.worksiteId))
      .leftJoin(assignee, eq(assignee.id, mantWorkOrders.assignedToUserId))
      .where(and(base, tabWhere(filters.tab)))
      .orderBy(desc(mantWorkOrders.createdAt), asc(mantWorkOrders.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ])

  const byStatus = new Map(countRows.map((row) => [row.status, row.count]))
  const counts = Object.fromEntries(WORK_ORDER_TABS.map((tab) => [
    tab,
    tab === "abiertas"
      ? OT_OPEN_STATUSES.reduce((sum, status) => sum + (byStatus.get(status) ?? 0), 0)
      : byStatus.get(tab) ?? 0,
  ])) as Record<WorkOrderTab, number>
  return { rows: rows.map((row) => toListRow(row, today)), total: counts[filters.tab], counts }
}

export interface WorkOrderFilterOptions {
  worksites: Array<{ id: string; name: string }>
  mechanics: Array<{ id: string; name: string }>
}

export async function loadWorkOrderFilterOptions(viewer: MantViewer): Promise<WorkOrderFilterOptions> {
  const visibility = workOrderVisibility(viewer)
  const [places, mechanics] = await Promise.all([
    db.select({ id: worksites.id, name: worksites.name }).from(worksites)
      .where(and(
        eq(worksites.isActive, true),
        visibility.kind === "all" ? undefined : inArray(worksites.id, visibility.worksiteIds.length ? visibility.worksiteIds : ["__none__"]),
      ))
      .orderBy(asc(worksites.name)),
    findAssignableMechanics(db),
  ])
  return { worksites: places, mechanics }
}

/**
 * Equipos del alcance de quien mira (un rol global o `view_all`, todos; si no, los de sus faenas).
 * Sirve al selector del alta y al filtro «Equipo» de la lista, también para roles de sólo lectura:
 * que pueda CREAR sobre ese equipo lo valida `createWorkOrder`, no esta lectura.
 */
export interface WorkOrderEquipmentOption {
  id: string
  code: string
  plate: string
  typeName: string
  worksiteId: string
  worksiteName: string
  unit: "km" | "h"
}

export async function listWorkOrderEquipmentOptions(viewer: MantViewer): Promise<WorkOrderEquipmentOption[]> {
  const visibility = workOrderVisibility(viewer)
  const worksiteScope = visibility.kind === "all" ? null : visibility.worksiteIds
  if (worksiteScope && worksiteScope.length === 0) return []
  const rows = await db
    .select({
      id: fuelVehicles.id,
      code: fuelVehicles.code,
      plate: fuelVehicles.plate,
      typeName: fuelEquipmentTypes.name,
      meterType: fuelEquipmentTypes.defaultMeterType,
      worksiteId: fuelVehicles.worksiteId,
      worksiteName: worksites.name,
    })
    .from(mantEquipmentProfiles)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantEquipmentProfiles.vehicleId))
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
    .where(and(
      eq(fuelVehicles.isActive, true),
      worksiteScope ? inArray(fuelVehicles.worksiteId, worksiteScope) : undefined,
    ))
    .orderBy(asc(worksites.name), asc(fuelVehicles.code))
  return rows.flatMap((row) => {
    const unit = unitFromMeter(row.meterType)
    return unit ? [{ id: row.id, code: row.code ?? row.plate, plate: row.plate, typeName: row.typeName, worksiteId: row.worksiteId, worksiteName: row.worksiteName, unit }] : []
  })
}

/** Mecánicos asignables: activos con `mant:ot:execute`, de TODAS las faenas. */
export async function listAssignableMechanics(): Promise<Array<{ id: string; name: string; worksiteNames: string[] }>> {
  return listAssignableMechanicsWithWorksites()
}

/** Mecánicos de las faenas de quien crea (el administrador de contrato): a quién queda asignada su OT. */
export async function listWorksiteMechanics(viewer: MantViewer): Promise<WorksiteMechanic[]> {
  return findWorksiteMechanics(db, viewer.isGlobal ? "all" : viewer.worksiteIds)
}

/** Talleres externos y conductores/operadores para el formulario de ingreso. */
export async function loadWorkOrderEntryCatalogs(): Promise<{ workshops: Array<{ id: string; name: string }>; drivers: Array<{ id: string; name: string }> }> {
  const catalogs = await listMantCatalogs()
  const brief = (entries: Array<{ id: string; name: string }>) => entries.map((entry) => ({ id: entry.id, name: entry.name }))
  return { workshops: brief(catalogs.workshops), drivers: brief(catalogs.drivers) }
}

/** `null` si no existe o está fuera del alcance (la página responde notFound). */
export async function loadWorkOrderDetail(viewer: MantViewer, id: string): Promise<WorkOrderDetail | null> {
  const [head] = await db
    .select({ ot: mantWorkOrders, worksiteName: worksites.name })
    .from(mantWorkOrders)
    .innerJoin(worksites, eq(worksites.id, mantWorkOrders.worksiteId))
    .where(eq(mantWorkOrders.id, id))
    .limit(1)
  if (!head) return null
  const ot = head.ot
  const status = ot.status as OtStatus
  const facts = { status, worksiteId: ot.worksiteId, requestedByUserId: ot.requestedByUserId, assignedToUserId: ot.assignedToUserId }
  if (!canSeeWorkOrder(workOrderVisibility(viewer), facts)) return null

  const [itemRows, eventRows, recordRows, findingRows, recordState] = await Promise.all([
    db.select().from(mantWorkOrderItems).where(eq(mantWorkOrderItems.workOrderId, id))
      .orderBy(asc(mantWorkOrderItems.kind), asc(mantWorkOrderItems.sortOrder), asc(mantWorkOrderItems.createdAt)),
    db.select().from(mantWorkOrderEvents).where(eq(mantWorkOrderEvents.workOrderId, id)).orderBy(asc(mantWorkOrderEvents.createdAt), asc(mantWorkOrderEvents.id)),
    db.select({
      id: mantRecords.id, folio: mantRecords.folio, kind: mantRecords.kind, workDate: mantRecords.workDate, signedAt: mantRecords.signedAt,
      status: mantRecords.status, worksiteId: mantRecords.worksiteId, registeredBy: mantRecords.registeredBy, executorUserId: mantRecords.executorUserId,
    }).from(mantRecords).where(eq(mantRecords.workOrderId, id)).orderBy(asc(mantRecords.signedAt)),
    ot.inspectionFindingId
      ? db.select({ id: preventionInspectionFindings.id, runId: preventionInspectionFindings.runId, capaActionId: preventionInspectionFindings.capaActionId })
        .from(preventionInspectionFindings).where(eq(preventionInspectionFindings.id, ot.inspectionFindingId)).limit(1)
      : Promise.resolve([]),
    // Sólo en taller importa si ya está el trabajo que exige «terminar».
    status === "en_ejecucion" ? linkedRecordState(db, id) : Promise.resolve(null),
  ])

  const userIds = [...new Set([
    ot.requestedByUserId, ot.assignedToUserId, ot.assignedByUserId, ot.startedByUserId, ot.finishedByUserId, ot.receivedByUserId,
    ot.faenaReceivedByUserId, ot.voidedByUserId,
    ...itemRows.map((item) => item.markedByUserId), ...eventRows.map((event) => event.actorUserId),
  ].filter((value): value is string => !!value))]
  const names = new Map((await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds))).map((row) => [row.id, row.name]))
  const nameOf = (userId: string | null) => (userId ? names.get(userId) ?? null : null)

  const today = todayInChile()
  const list = toListRow({ ...ot, worksiteName: head.worksiteName, assignedToName: nameOf(ot.assignedToUserId) }, today)
  const visibility = recordVisibility(viewer)
  const finding = findingRows[0]

  return {
    ...list,
    version: ot.version,
    unit: ot.equipmentSnapshot.unit,
    repairDescription: ot.repairDescription,
    observations: ot.observations,
    requestedByUserId: ot.requestedByUserId,
    requestedByName: nameOf(ot.requestedByUserId) ?? ot.requesterName,
    assignedByName: nameOf(ot.assignedByUserId),
    assignedAt: isoOrNull(ot.assignedAt),
    entry: ot.workshopEntryAt && ot.workshopKind && ot.estimatedDeliveryDate
      ? {
        workshopKind: ot.workshopKind as OtWorkshopKind,
        workshopId: ot.workshopId,
        workshopName: ot.workshopName,
        workshopManagerName: ot.workshopManagerName,
        operatorDriverId: ot.operatorDriverId,
        operatorName: ot.operatorName,
        entryAt: iso(ot.workshopEntryAt),
        odometer: ot.entryOdometer,
        hourmeter: ot.entryHourmeter,
        estimatedDeliveryDate: ot.estimatedDeliveryDate,
        startedByName: nameOf(ot.startedByUserId),
      }
      : null,
    exit: ot.workshopExitAt ? { exitAt: iso(ot.workshopExitAt), finishedByName: nameOf(ot.finishedByUserId) } : null,
    reception: ot.receivedAt && ot.receiverName && ot.receivedRecordedAt
      ? { receivedAt: iso(ot.receivedAt), receiverName: ot.receiverName, recordedByName: nameOf(ot.receivedByUserId), recordedAt: iso(ot.receivedRecordedAt) }
      : null,
    faenaReception: ot.faenaReceivedAt && ot.faenaReceiverName && ot.closedAt
      ? { receivedAt: iso(ot.faenaReceivedAt), receiverName: ot.faenaReceiverName, recordedByName: nameOf(ot.faenaReceivedByUserId), closedAt: iso(ot.closedAt) }
      : null,
    voided: ot.voidedAt && ot.voidReason ? { at: iso(ot.voidedAt), byName: nameOf(ot.voidedByUserId), reason: ot.voidReason } : null,
    items: itemRows.map((item) => ({
      id: item.id,
      kind: item.kind as OtItemKind,
      origin: item.origin as OtItemOrigin,
      description: item.description,
      sortOrder: item.sortOrder,
      done: item.done as OtItemDone | null,
      note: item.note,
      markedByName: nameOf(item.markedByUserId),
      markedAt: isoOrNull(item.markedAt),
    })),
    events: eventRows.map((event) => ({
      id: event.id,
      type: event.type as OtEventType,
      fromStatus: event.fromStatus as OtStatus | null,
      toStatus: event.toStatus as OtStatus | null,
      reason: event.reason,
      changeSet: event.changeSet,
      actorName: nameOf(event.actorUserId) ?? "—",
      createdAt: iso(event.createdAt),
    })),
    linkedRecords: recordRows.map((record) => ({
      id: record.id,
      folio: record.folio,
      kind: record.kind as "P" | "C",
      workDate: record.workDate,
      signedAt: iso(record.signedAt),
      status: record.status as "vigente" | "anulado",
      canOpen: canSeeRecord(visibility, record),
    })),
    inspectionFinding: finding ? { id: finding.id, runId: finding.runId, capaActionId: finding.capaActionId } : null,
    allowedTransitions: allowedTransitions(viewer, facts),
    canEditRequest: canEditRequest(viewer, facts).ok,
    canEditExecution: canEditExecution(viewer, facts).ok,
    canRegisterRecord: canRegisterWorkOrderRecord(viewer, facts).ok,
    needsLinkedRecord: recordState !== null && !recordState.linked,
  }
}

export type { OtStatus }
