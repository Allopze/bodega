import { and, desc, eq, isNull } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { fleetVehicleDocuments, fuelVehicleOperationalIntervals, fuelVehicles } from "@/db/schema"
import { getEquipmentFuelSummary } from "@/lib/combustibles/equipment/get-equipment-file"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { expiryState, type ExpiryStatus } from "@/lib/expiry"
import type { MantEquipmentStatus, MantUnit } from "@/lib/mantencion/types"
import { equipmentScope, viewerFromSession } from "@/lib/services/mantencion/access"
import { loadOpenWorkOrdersSummary } from "@/lib/services/mantencion/equipment-life"
import { loadFleet } from "@/lib/services/mantencion/fleet"
import { getFleetAdminSettings } from "@/lib/services/system-settings"
import { todayInChile } from "@/lib/utils"
import { expiringDocuments } from "@/lib/validation/fleet-documents"

/**
 * Datos del «Resumen» de la ficha del vehículo: una línea por área visible, lo justo para
 * contestar «¿cómo está?» sin abrir las pestañas. Cada cargador es independiente (la página
 * los resuelve con `settle`): si uno cae, sólo su línea lo dice.
 */

export interface FichaStateSummary {
  /** `inactivo` para un vehículo dado de baja, sea cual sea su último estado operativo. */
  status: string
  since: string | null
  reason: string | null
}

/** Estado operativo vigente y desde cuándo (el intervalo abierto del historial de estado). */
export async function loadFichaState(vehicle: { id: string; operationalStatus: string; isActive: boolean }): Promise<FichaStateSummary> {
  const [interval] = await db.select({
    status: fuelVehicleOperationalIntervals.status,
    startedAt: fuelVehicleOperationalIntervals.startedAt,
    reason: fuelVehicleOperationalIntervals.reason,
  })
    .from(fuelVehicleOperationalIntervals)
    .where(and(eq(fuelVehicleOperationalIntervals.vehicleId, vehicle.id), isNull(fuelVehicleOperationalIntervals.endedAt)))
    .orderBy(desc(fuelVehicleOperationalIntervals.startedAt))
    .limit(1)
  const status = vehicle.isActive ? vehicle.operationalStatus : "inactivo"
  // El intervalo abierto describe el estado guardado; si no coincide (dato heredado), no se inventa un «desde».
  const matches = interval && interval.status === vehicle.operationalStatus && vehicle.isActive
  return { status, since: matches ? interval.startedAt : null, reason: matches ? interval.reason : null }
}

export interface FichaDocumentsSummary {
  /** El vencimiento más urgente (lo vencido más antiguo, después lo más próximo); `null` sin ninguna fecha. */
  next: { documentType: string; status: ExpiryStatus } | null
  warningDays: number
}

/** Vencimientos con la misma precedencia que la pestaña Flota, la lista y los avisos (`expiringDocuments`). */
export async function loadFichaDocuments(vehicleId: string): Promise<FichaDocumentsSummary> {
  const [vehicle, documents, { warningDays }] = await Promise.all([
    db.query.fuelVehicles.findFirst({
      where: eq(fuelVehicles.id, vehicleId),
      columns: { soapExpiresAt: true, technicalReviewExpiresAt: true, circulationPermitExpiresAt: true, insuranceExpiresAt: true },
    }),
    db.select({ documentType: fleetVehicleDocuments.documentType, expiresAt: fleetVehicleDocuments.expiresAt })
      .from(fleetVehicleDocuments)
      .where(and(eq(fleetVehicleDocuments.vehicleId, vehicleId), eq(fleetVehicleDocuments.status, "current"))),
    getFleetAdminSettings(),
  ])
  const entries = expiringDocuments(vehicle ?? {}, documents)
  const first = entries[0]
  return {
    next: first ? { documentType: first.documentType, status: expiryState(first.expiresAt, todayInChile(), warningDays) } : null,
    warningDays,
  }
}

export interface FichaMaintenanceSummary {
  /** Sin perfil: el vehículo no está en el plan de mantención. */
  inPlan: boolean
  status: Pick<MantEquipmentStatus, "state" | "remaining" | "nextIntervalValue"> | null
  unit: MantUnit | null
  workshop: { daysStopped: number | null } | null
  /** `null` sin permiso de OT. */
  openOrders: Awaited<ReturnType<typeof loadOpenWorkOrdersSummary>>
}

export async function loadFichaMaintenance(session: Session, vehicleId: string, hasProfile: boolean): Promise<FichaMaintenanceSummary> {
  const viewer = viewerFromSession(session)
  if (!hasProfile) return { inPlan: false, status: null, unit: null, workshop: null, openOrders: await loadOpenWorkOrdersSummary(vehicleId, viewer) }
  const [[row], openOrders] = await Promise.all([
    loadFleet({ scope: equipmentScope(viewer), includeRetired: true, vehicleIds: [vehicleId], readingsPerEquipment: 1 }),
    loadOpenWorkOrdersSummary(vehicleId, viewer),
  ])
  if (!row) return { inPlan: false, status: null, unit: null, workshop: null, openOrders }
  return {
    inPlan: true,
    status: { state: row.status.state, remaining: row.status.remaining, nextIntervalValue: row.status.nextIntervalValue },
    unit: row.unit,
    workshop: row.workshop ? { daysStopped: row.workshop.daysStopped ?? null } : null,
    openOrders,
  }
}

export type FichaFuelSummary = NonNullable<Awaited<ReturnType<typeof getEquipmentFuelSummary>>>

export async function loadFichaFuel(session: Session, vehicleId: string, period: ResolvedFuelPeriod): Promise<FichaFuelSummary | null> {
  return getEquipmentFuelSummary(session, vehicleId, period)
}
