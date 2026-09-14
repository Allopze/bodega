/**
 * Las **tres** consultas que la Fase 3 del dashboard necesita y que no existían.
 *
 * Todo el resto de las secciones por dominio consume funciones ya escritas
 * (`getCapaDashboardCounts`, `getDashboardCounters`, `getAnalyticsDashboard`…).
 * Estas tres son `count`/`sum` sobre columnas que ya están en el esquema.
 */
import { and, count, eq, gte, inArray, isNotNull, lt, lte, ne, sql } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import {
  fleetVehicleDocuments, fuelMonthlyStatements, fuelVehicles, purchaseOrders, receiptItems, receipts,
  preventionCapaActions, preventionChangeRequests, preventionCommitteeAgreements,
  preventionCommitteeMeetings,
  preventionCommittees, preventionEmergencyDrills, preventionExposureGroups,
  preventionExposureMeasurements, preventionInspectionFindings,
  preventionInspectionRuns, preventionWorkPermits,
} from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"

export interface ReceptionQuality {
  received: number
  rejected: number
  damaged: number
  /** Porcentaje 0–100 de lo rechazado o dañado sobre lo que llegó. */
  rejectionRate: number
}

/**
 * Calidad de lo recibido en el período: cuánto de lo que llegó se rechazó o
 * vino dañado.
 *
 * Es el indicador de proveedor que faltaba — el tablero sabía *cuántas*
 * recepciones había, nunca *cómo* salieron. El denominador incluye lo rechazado
 * y lo dañado porque los tres contadores describen la misma llegada: si sólo se
 * dividiera por `quantityReceived`, una recepción íntegramente rechazada daría
 * división por cero en vez de 100%.
 */
export async function getReceptionQuality(
  session: Session,
  bounds: { from: string; to: string },
  worksiteId?: string,
): Promise<ReceptionQuality> {
  // La faena del ítem cuelga de la OC: `receipts.worksiteId` es nullable
  // (recepción en oficina), así que el alcance se aplica sobre la orden.
  const scope = worksiteScopeSql(session, purchaseOrders.worksiteId, worksiteId)

  const [row] = await db
    .select({
      received: sql<number>`COALESCE(SUM(${receiptItems.quantityReceived}), 0)`,
      rejected: sql<number>`COALESCE(SUM(${receiptItems.quantityRejected}), 0)`,
      damaged: sql<number>`COALESCE(SUM(${receiptItems.quantityDamaged}), 0)`,
    })
    .from(receiptItems)
    .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
    .innerJoin(purchaseOrders, eq(receipts.purchaseOrderId, purchaseOrders.id))
    .where(and(scope, gte(receipts.receivedAt, bounds.from), lt(receipts.receivedAt, bounds.to)))

  const received = Number(row?.received ?? 0)
  const rejected = Number(row?.rejected ?? 0)
  const damaged = Number(row?.damaged ?? 0)
  const total = received + rejected + damaged

  return {
    received,
    rejected,
    damaged,
    rejectionRate: total > 0 ? Math.round(((rejected + damaged) / total) * 1000) / 10 : 0,
  }
}

export interface OverdueFuelDebt {
  amount: number
  statements: number
}

/**
 * Deuda vencida de las cuentas corrientes de combustible.
 *
 * **No se puede acotar por faena y el dashboard tiene que decirlo:**
 * `fuel_monthly_statements` es por (mes, proveedor), sin columna de faena — la
 * deuda es con el proveedor, no atribuible a una obra. Se muestra siempre en su
 * total, con la copia declarándolo, en vez de fingir que respeta el alcance.
 *
 * Vencida = el estado ya la marcó `overdue`, **o** su fecha de pago pasó y
 * todavía queda saldo. Lo segundo cubre el hueco entre que la fecha se cumple y
 * que el cron o el usuario actualicen el estado.
 */
export async function getOverdueFuelDebt(today: string): Promise<OverdueFuelDebt> {
  const pending = sql`${fuelMonthlyStatements.totalAmount} - ${fuelMonthlyStatements.paidAmount}`

  const [row] = await db
    .select({
      amount: sql<number>`COALESCE(SUM(${pending}), 0)`,
      statements: count(),
    })
    .from(fuelMonthlyStatements)
    .where(and(
      sql`${pending} > 0`,
      sql`${fuelMonthlyStatements.status} NOT IN ('paid', 'cancelled')`,
      sql`(${fuelMonthlyStatements.status} = 'overdue' OR (${fuelMonthlyStatements.dueDate} IS NOT NULL AND ${fuelMonthlyStatements.dueDate} < ${today}))`,
    ))

  return { amount: Number(row?.amount ?? 0), statements: Number(row?.statements ?? 0) }
}

export interface ExpiringFleetDocuments {
  within30: number
  expired: number
}

/**
 * Documentos de flota por vencer y ya vencidos.
 *
 * Un vehículo sin revisión técnica vigente no puede circular, así que esto es
 * un bloqueo operacional con fecha conocida y nadie lo estaba mirando desde el
 * tablero. El alcance sale del vehículo, que sí tiene faena.
 */
export async function getExpiringFleetDocuments(
  session: Session,
  today: string,
  horizon: string,
  worksiteId?: string,
): Promise<ExpiringFleetDocuments> {
  const scope = worksiteScopeSql(session, fuelVehicles.worksiteId, worksiteId)

  const [row] = await db
    .select({
      within30: sql<number>`COUNT(*) FILTER (WHERE ${fleetVehicleDocuments.expiresAt} >= ${today} AND ${fleetVehicleDocuments.expiresAt} <= ${horizon})::int`,
      expired: sql<number>`COUNT(*) FILTER (WHERE ${fleetVehicleDocuments.expiresAt} < ${today})::int`,
    })
    .from(fleetVehicleDocuments)
    .innerJoin(fuelVehicles, eq(fleetVehicleDocuments.vehicleId, fuelVehicles.id))
    // Sólo la versión vigente de cada tipo. Sin este filtro el KPI contaba
    // también las reemplazadas —subir la póliza nueva no sacaba al equipo del
    // atraso, seguía midiéndose contra la del año pasado, que es el mismo
    // defecto que el resto del módulo ya había corregido— y desde FLO-003
    // habría contado además las anuladas.
    .where(and(
      scope,
      eq(fleetVehicleDocuments.status, "current"),
      // FLO-001: y sólo los vehículos que siguen en la flota. La revisión
      // técnica vencida de una camioneta dada de baja no es un bloqueo
      // operacional: es un documento de un vehículo que ya no circula, y
      // engordaba para siempre el indicador que la dirección mira.
      eq(fuelVehicles.isActive, true),
      isNotNull(fleetVehicleDocuments.expiresAt),
      lte(fleetVehicleDocuments.expiresAt, horizon),
    ))

  return { within30: Number(row?.within30 ?? 0), expired: Number(row?.expired ?? 0) }
}


export interface FieldControlSummary {
  /** Promedio de `compliancePercent` de las inspecciones revisadas. */
  inspectionCompliance: number | null
  inspectionsReviewed: number
  criticalFindingsOpen: number
  permitsActive: number
  permitsSuspended: number
  drillsNeedingImprovement: number
  drillsCompleted: number
  committeeAgreementsOpen: number
  measurementsAboveLimit: number
  changeRequestsOpen: number
  /**
   * Qué submódulos puede ver esta sesión. La sección omite los que no, en vez
   * de mostrar un cero que se lee como "no hay nada" (ver `visibleFieldControl`).
   */
  visible: FieldControlVisibility
}

export type FieldControlModule =
  | "inspections" | "permits" | "drills" | "committee" | "hygiene" | "change"

export type FieldControlVisibility = Record<FieldControlModule, boolean>

/**
 * DASH-001 (auditoría 2026-09-14): la sección de terreno agrupa seis módulos
 * que en su propia ruta exigen seis permisos distintos, y el tablero los
 * cargaba y dibujaba todos con que la sesión tuviera **uno cualquiera** de
 * ellos. El agrupamiento visual se había vuelto la condición de lectura.
 *
 * Cada agregado depende ahora de su propio permiso, y el que no se tiene ni
 * siquiera se consulta: el dato no sale de la base.
 */
const FIELD_CONTROL_PERMISSION: Record<FieldControlModule, string> = {
  inspections: "prevention:inspections:view",
  permits:     "prevention:permits:view",
  drills:      "prevention:emergency:view",
  committee:   "prevention:cphs:view",
  hygiene:     "prevention:hygiene:view",
  change:      "prevention:change:view",
}

export function visibleFieldControl(permissions: readonly string[]): FieldControlVisibility {
  const held = new Set(permissions)
  return Object.fromEntries(
    Object.entries(FIELD_CONTROL_PERMISSION).map(([module, permission]) => [module, held.has(permission)]),
  ) as FieldControlVisibility
}

/**
 * Resumen de los seis dominios de control preventivo en terreno que no tenían
 * ninguna función de agregación: inspecciones, permisos de trabajo, simulacros,
 * acuerdos del comité paritario, higiene industrial y gestión del cambio.
 *
 * Van juntos en una consulta y en una sección porque comparten la misma
 * pregunta —¿el control preventivo se está ejecutando en terreno?— y porque seis
 * secciones más habrían devuelto la pantalla al muro que esta auditoría
 * desarmó.
 *
 * Los acuerdos del comité cuelgan de la reunión, que es la que tiene faena; los
 * hallazgos cuelgan de la inspección. Por eso esos dos van con `innerJoin` en
 * vez de filtrar su propia tabla.
 */
export async function getFieldControlSummary(
  session: Session,
  worksiteId?: string,
  /**
   * C-06: el promedio de cumplimiento se calculaba sobre TODA la historia, así
   * que se volvía cada vez más insensible y no reflejaba el período que el
   * resto del tablero muestra. Se acota con el mismo helper que ya usa
   * `getReceptionQuality` (`getOperationalCalendarBounds`); sin límites, se
   * conserva el comportamiento histórico para los llamadores que aún no lo pasan.
   */
  bounds?: { from: string; to: string },
): Promise<FieldControlSummary> {
  const runScope = worksiteScopeSql(session, preventionInspectionRuns.worksiteId, worksiteId)
  const permitScope = worksiteScopeSql(session, preventionWorkPermits.worksiteId, worksiteId)
  const drillScope = worksiteScopeSql(session, preventionEmergencyDrills.worksiteId, worksiteId)
  // Ni la reunión ni la medición tienen faena: cuelgan del comité y del GES.
  const committeeScope = worksiteScopeSql(session, preventionCommittees.worksiteId, worksiteId)
  const changeScope = worksiteScopeSql(session, preventionChangeRequests.worksiteId, worksiteId)
  const exposureGroupScope = worksiteScopeSql(session, preventionExposureGroups.worksiteId, worksiteId)

  const visible = visibleFieldControl(session.user.permissions ?? [])
  // Lo que no se puede ver no se consulta: la consulta ahorrada es también la
  // garantía de que el dato no llega al render por descuido.
  const skip = <T,>(value: T) => Promise.resolve([value])

  const [[inspections], [findings], [permits], [drills], [agreements], [measurements], [changes]] = await Promise.all([
    !visible.inspections ? skip({ compliance: null, reviewed: 0 }) : db.select({
      compliance: sql<number | null>`AVG(${preventionInspectionRuns.compliancePercent})`,
      reviewed: sql<number>`COUNT(*) FILTER (WHERE ${preventionInspectionRuns.status} = 'reviewed')::int`,
    }).from(preventionInspectionRuns).where(and(
      runScope,
      isNotNull(preventionInspectionRuns.compliancePercent),
      bounds ? gte(preventionInspectionRuns.executedAt, bounds.from) : undefined,
      bounds ? lt(preventionInspectionRuns.executedAt, bounds.to) : undefined,
    )),

    !visible.inspections ? skip({ value: 0 }) : db.select({ value: count() })
      .from(preventionInspectionFindings)
      .innerJoin(preventionInspectionRuns, eq(preventionInspectionFindings.runId, preventionInspectionRuns.id))
      // C-07: filtraba `status = 'open'`, así que derivar el hallazgo a una CAPA
      // (`capa_linked`) lo borraba del tablero aunque la acción estuviera
      // vencida y sin evidencia. `<> 'closed'` es el mismo criterio que ya usa
      // `listInspectionRuns` para su columna `openFindings`; que difirieran era
      // el bug.
      .where(and(runScope, ne(preventionInspectionFindings.status, "closed"), inArray(preventionInspectionFindings.criticality, ["high", "critical"]))),

    !visible.permits ? skip({ active: 0, suspended: 0 }) : db.select({
      active: sql<number>`COUNT(*) FILTER (WHERE ${preventionWorkPermits.status} = 'active')::int`,
      suspended: sql<number>`COUNT(*) FILTER (WHERE ${preventionWorkPermits.status} = 'suspended')::int`,
    }).from(preventionWorkPermits).where(permitScope),

    !visible.drills ? skip({ needsImprovement: 0, completed: 0 }) : db.select({
      needsImprovement: sql<number>`COUNT(*) FILTER (WHERE ${preventionEmergencyDrills.outcome} = 'needs_improvement')::int`,
      completed: sql<number>`COUNT(*) FILTER (WHERE ${preventionEmergencyDrills.status} = 'completed')::int`,
    }).from(preventionEmergencyDrills).where(drillScope),

    // Un acuerdo está abierto cuando su CAPA lo está: el acuerdo ya no guarda
    // estado propio (era un espejo que nadie actualizaba, y esta cifra daba
    // cero siempre). Mismo predicado de "abierta" que el filtro `open` de CAPA.
    !visible.committee ? skip({ value: 0 }) : db.select({ value: count() })
      .from(preventionCommitteeAgreements)
      .innerJoin(preventionCommitteeMeetings, eq(preventionCommitteeAgreements.meetingId, preventionCommitteeMeetings.id))
      .innerJoin(preventionCommittees, eq(preventionCommitteeMeetings.committeeId, preventionCommittees.id))
      .innerJoin(preventionCapaActions, eq(preventionCommitteeAgreements.capaActionId, preventionCapaActions.id))
      .where(and(committeeScope, sql`${preventionCapaActions.status} NOT IN ('closed', 'cancelled')`)),

    !visible.hygiene ? skip({ value: 0 }) : db.select({ value: count() })
      .from(preventionExposureMeasurements)
      .innerJoin(preventionExposureGroups, eq(preventionExposureMeasurements.groupId, preventionExposureGroups.id))
      .where(and(exposureGroupScope, eq(preventionExposureMeasurements.outcome, "above_limit"))),

    !visible.change ? skip({ value: 0 }) : db.select({ value: count() })
      .from(preventionChangeRequests)
      .where(and(changeScope, sql`${preventionChangeRequests.status} NOT IN ('closed', 'cancelled', 'rejected')`)),
  ])

  const compliance = inspections?.compliance == null ? null : Math.round(Number(inspections.compliance))

  return {
    inspectionCompliance: compliance,
    inspectionsReviewed: Number(inspections?.reviewed ?? 0),
    criticalFindingsOpen: Number(findings?.value ?? 0),
    permitsActive: Number(permits?.active ?? 0),
    permitsSuspended: Number(permits?.suspended ?? 0),
    drillsNeedingImprovement: Number(drills?.needsImprovement ?? 0),
    drillsCompleted: Number(drills?.completed ?? 0),
    committeeAgreementsOpen: Number(agreements?.value ?? 0),
    measurementsAboveLimit: Number(measurements?.value ?? 0),
    changeRequestsOpen: Number(changes?.value ?? 0),
    visible,
  }
}
