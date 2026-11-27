import type { Metadata } from "next"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelVehicles, users } from "@/db/schema"
import Link from "next/link"
import { notFound } from "next/navigation"
import { EquipmentDetailView } from "@/components/mantencion/jefatura/equipos/equipment-detail-view"
import type { EquipmentDetailData, EquipmentEditData, PriorPreventiveView } from "@/components/mantencion/jefatura/equipos/equipment-detail-types"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { can, canAny } from "@/lib/auth/can"
import { getWorkOrderConsumptionImpact } from "@/lib/services/fleet"
import { formatNumber } from "@/lib/mantencion/format"
import { equipmentScope, recordVisibility, recordVisibilitySql, viewerFromSession } from "@/lib/services/mantencion/access"
import { countEquipmentRecords } from "@/lib/services/mantencion/equipment"
import { loadEquipmentInsurance, loadEquipmentWorkOrders, loadLifeRows, loadLifeTotals, type LifeTotals } from "@/lib/services/mantencion/equipment-life"
import { loadEquipmentTimeline } from "@/lib/services/mantencion/maintenance-work"
import { listEquipmentHistory } from "@/lib/services/mantencion/equipment-history"
import { loadEquipmentParts } from "@/lib/services/mantencion/equipment-parts"
import { loadEquipmentCurrents } from "@/lib/services/mantencion/equipment-resolve"
import { loadFleet } from "@/lib/services/mantencion/fleet"
import { listAssignableMechanics, listExecutionWorksiteOptions, listWorkOrderEquipmentOptions, listWorksiteMechanics } from "@/lib/services/mantencion/work-orders/query"
import { todayInChile } from "@/lib/utils"
import { getOperationalSettings } from "@/lib/services/system-settings"
import { getVehiclePurchaseHistory } from "@/lib/services/vehicle-purchase-history"
import type { NewOtSheetProps } from "@/components/mantencion/jefatura/ot/new-ot-sheet"
import { LIFE_PAGE_SIZE } from "@/components/mantencion/jefatura/equipos/equipment-life-section"
import { EQUIPMENT_TIMELINE_LIMIT } from "@/components/mantencion/historial/equipment-timeline"
import { listSchedules } from "@/lib/services/mantencion/schedules"
import { getCurrentScheduleSnapshots } from "@/lib/services/mantencion/schedule-versions"
import { PERFORMANCE_UNIT_LABELS } from "@/lib/combustibles/control/contracts"
import { openVehicleFichaArea } from "../_ficha/access"
import { vehicleFichaBreadcrumb, vehicleFichaDescription, VehicleFichaEditAction, VehicleFichaOwnership, VehicleFichaPersonalUseBadge, VehicleFichaTabs } from "../_ficha/ficha-chrome"
import { listPersonalUsePeriods } from "@/lib/services/fleet-personal-use"

export const metadata: Metadata = { title: "Vehículo · Mantención" }
export const dynamic = "force-dynamic"

/** Totales de lo firmado para quien ve la línea de tiempo: esa lista no se dibuja, así que no se consulta. */
const NO_LIFE_TOTALS: LifeTotals = { active: 0, activeCorrective: 0, activePreventive: 0, activeHours: 0, voided: 0 }

/**
 * Pestaña «Mantención» de la ficha única del vehículo (crítica 2026-11-15, paso 4a). Era la
 * ficha de `/mantencion/equipos/[id]`, que ahora redirige aquí. Pide los mismos permisos y el
 * mismo alcance de faenas que pedía ella (`openVehicleFichaArea`).
 */
export default async function EquipmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const { session, ctx } = await openVehicleFichaArea(id, "mantencion")
  // Insignia «En uso personal» de la cabecera: informativa, no tumba la página si falla.
  const personalUsePeriods = await listPersonalUsePeriods(id).catch(() => [])
  const viewer = viewerFromSession(session)
  const header = { title: ctx.label, description: vehicleFichaDescription(ctx), breadcrumb: vehicleFichaBreadcrumb(ctx, "mantencion") }
  const tabs = <><VehicleFichaOwnership vehicleId={ctx.vehicle.id} /><VehicleFichaTabs ctx={ctx} active="mantencion" /></>

  // Un vehículo de la flota que todavía no está en el plan de mantención: la pestaña dice qué
  // falta y, a quien puede, cómo incorporarlo. Antes la ficha de Flota escondía el botón.
  if (!ctx.hasMaintenanceProfile) {
    return (
      <PageContainer width="workbench">
        <PageHeader {...header} actions={<><VehicleFichaPersonalUseBadge periods={personalUsePeriods} /><VehicleFichaEditAction ctx={ctx} /></>} />
        {tabs}
        <EmptyState
          title="Este vehículo no está en el plan de mantención"
          description="Sin pauta ni hoja de vida, y no aparece en la app del mecánico. Al incorporarlo se elige su pauta y su lectura inicial."
          action={can(session, "mant:equipment:manage")
            ? <Button asChild variant="primary" size="sm"><Link href="/mantencion/equipos/incorporar">Incorporar a Mantención</Link></Button>
            : undefined}
        />
      </PageContainer>
    )
  }
  const query = await searchParams
  const justCreated = query.creado === "1"
  // «Mostrar más» sube `?vida=`; se acota para que la URL no pida el mundo.
  const requested = Number(Array.isArray(query.vida) ? query.vida[0] : query.vida)
  const lifeLimit = Number.isInteger(requested) && requested > LIFE_PAGE_SIZE ? Math.min(requested, 500) : LIFE_PAGE_SIZE

  // El alcance de faenas se aplica en la carga: un equipo ajeno es «no encontrado», no «sin permiso».
  const canViewFleet = can(session, "flota:view")
  const [row] = await loadFleet({ scope: equipmentScope(viewer), includeRetired: true, vehicleIds: [id], readingsPerEquipment: 1, includeGpsEstimate: canViewFleet })
  if (!row) notFound()

  const canManage = can(session, "mant:equipment:manage")
  // La hoja de vida y sus totales respetan el alcance de lectura: un supervisor sólo ve su faena y lo propio.
  const visibility = recordVisibilitySql(recordVisibility(viewer))
  // Las compras vinculadas se ven con `purchasing:view` (cualquier OC) o `repuestos:view_all` (cualquier solicitud);
  // sin ninguna, `null` y la tarjeta no se dibuja, en vez de decir «sin compras».
  const canSeePurchases = can(session, "purchasing:view") || can(session, "repuestos:view_all")
  // La línea de tiempo del «Historial de mantenciones» (formularios, OT y registros) sólo la pide quien puede ver el
  // historial: el mismo permiso que decidía la visibilidad de «Historial anterior». Su alcance lo aplica el servicio.
  // Quien la ve no recibe además la lista de lo firmado (la línea de tiempo ya lo trae): no se consulta en balde.
  const canSeeHistory = canAny(session, "mant:records:view_all", "mant:records:view_worksite")
  const [history, life, totals, insurance, recordCount, schedules, workOrders, timeline, purchases, parts] = await Promise.all([
    listEquipmentHistory(id),
    canSeeHistory ? Promise.resolve({ rows: [], hasMore: false }) : loadLifeRows(id, visibility, { limit: lifeLimit }),
    canSeeHistory ? Promise.resolve(NO_LIFE_TOTALS) : loadLifeTotals(id, visibility),
    loadEquipmentInsurance(id),
    countEquipmentRecords(id),
    canManage ? listSchedules() : Promise.resolve(null),
    // Las OT tienen su propio alcance (`mant:ot:view_*`); sin permiso, `null` y la sección no se dibuja.
    loadEquipmentWorkOrders(id, viewer),
    canSeeHistory ? loadEquipmentTimeline(viewer, id, { limit: EQUIPMENT_TIMELINE_LIMIT }) : Promise.resolve(null),
    canSeePurchases ? getVehiclePurchaseHistory(id) : Promise.resolve(null),
    // Notas de pedido y repuestos usados: cada lista llega recortada a su alcance y `null` si no hay permiso para verla.
    loadEquipmentParts(id, viewer),
  ])

  // El efecto de cada OT cerrada en el rendimiento: dato del log de combustible, con su permiso.
  const performanceUnit = await vehiclePerformanceUnit(id)
  const impact = workOrders && can(session, "combustibles:view") && performanceUnit
    ? await getWorkOrderConsumptionImpact(workOrders.rows.map((row) => ({ id: row.id, status: row.status, workshopExitAt: row.workshopExitAt })))
    : []

  // «Crear orden de trabajo» con este equipo elegido: sólo con permiso de crear y mientras el equipo siga activo.
  // Las mismas reglas que el alta de la lista de órdenes (la jefatura asigna a cualquier mecánico; el administrador
  // de contrato, a los de la faena del equipo); `createWorkOrder` las vuelve a validar.
  const canCreateOrder = can(session, "mant:ot:create") && !row.retired
  const canManageOrders = can(session, "mant:ot:manage")
  let newOrder: NewOtSheetProps | null = null
  if (canCreateOrder) {
    const [options, mechanics, worksiteMechanics, executionWorksites, settings] = await Promise.all([
      listWorkOrderEquipmentOptions(viewer),
      canManageOrders ? listAssignableMechanics() : Promise.resolve(null),
      canManageOrders ? Promise.resolve(null) : listWorksiteMechanics(viewer),
      listExecutionWorksiteOptions(),
      getOperationalSettings(),
    ])
    const equipment = options.filter((option) => option.id === id)
    if (equipment.length > 0) {
      newOrder = { equipment, mechanics, worksiteMechanics, worksites: executionWorksites, actionTypeRequired: settings.mantencionActionTypeRequired === 1, today: todayInChile(), defaultRequesterName: session.user.name ?? "", defaultVehicleId: id }
    }
  }

  const [priorPreventive, profileUpdatedAt] = await Promise.all([loadPriorPreventive(id), loadProfileUpdatedAt(id)])
  // El servidor valida el servicio contra la versión PUBLICADA de la pauta, no contra su borrador.
  const publishedSchedules = schedules ? await getCurrentScheduleSnapshots(schedules.map((item) => item.id)) : []
  const { status, workshop } = row
  const data: EquipmentDetailData = {
    vehicleId: row.vehicleId,
    code: row.code,
    plate: row.plate,
    noPlate: row.noPlate,
    typeName: row.typeName,
    unit: row.unit,
    brandName: row.brandName,
    model: row.model,
    year: row.year,
    worksiteName: row.worksiteName,
    schedule: row.scheduleId ? { id: row.scheduleId, name: row.scheduleName ?? "" } : null,
    retired: row.retired,
    retiredReason: row.retiredReason,
    initialReading: row.initialReading,
    status: {
      state: status.state,
      currentReading: status.currentReading ? { value: status.currentReading.value, date: status.currentReading.date } : null,
      nextReading: status.nextReading,
      remaining: status.remaining,
      nextIntervalValue: status.nextIntervalValue,
      lastPreventive: status.lastPreventive,
    },
    workshop: workshop ? { entryDate: workshop.entryDate, daysStopped: workshop.daysStopped, stale: workshop.stale, lastActivityDate: workshop.lastActivityDate } : null,
    gpsStatus: row.gpsStatus,
    gpsReadingAt: row.gpsReadingAt,
    gpsReadingSource: row.gpsReadingSource,
    priorPreventive,
    recordCount,
    life: {
      rows: life.rows,
      totals,
      hasMore: life.hasMore,
      limit: lifeLimit,
      workOrders,
      timeline: timeline ? { ...timeline, vehicleId: id } : null,
      workOrderImpact: performanceUnit && impact.length > 0
        ? { unit: PERFORMANCE_UNIT_LABELS[performanceUnit], byWorkOrder: Object.fromEntries(impact.map((item) => [item.workOrderId, { before: item.avgBefore, after: item.avgAfter }])) }
        : null,
    },
    insurance,
    canViewFleet,
    history,
    purchases,
    purchaseLinks: {
      canOpenRequests: can(session, "repuestos:view_all"),
      canOpenOrders: can(session, "purchasing:view"),
      canOpenSpareParts: can(session, "repuestos:catalog"),
      // Un equipo dado de baja no admite solicitudes nuevas (el formulario lo rechazaría).
      newRequestHref: can(session, "repuestos:create") && !row.retired ? `/solicitudes/nueva?tipo=repuestos&vehiculo=${row.vehicleId}` : null,
    },
    parts: {
      ...parts,
      // Los enlaces siguen la puerta de cada pantalla (la nota y la OT validan permiso y alcance otra vez).
      canOpenNotes: canAny(session, "mant:np:view_worksite", "mant:np:manage"),
      canOpenWorkOrders: canAny(session, "mant:ot:view_worksite", "mant:ot:view_all", "mant:ot:execute"),
    },
  }

  // «Editar plan de mantención»: pauta, lectura inicial y baja. La identidad se edita en «Editar vehículo».
  const edit: EquipmentEditData | null = schedules
    ? {
        schedules: schedules.map((item) => ({ id: item.id, name: item.name, unit: item.unit, intervalCount: item.intervals.length })),
        initial: {
          scheduleId: row.scheduleId ?? "",
          initialReading: row.initialReading ? formatNumber(row.initialReading.value) : "",
          initialReadingDate: row.initialReading?.date ?? "",
          retired: row.retired,
          retiredReason: row.retiredReason ?? "",
        },
        scheduleIntervals: Object.fromEntries(publishedSchedules.map((item) => [item.id, item.intervals])),
        expectedUpdatedAt: profileUpdatedAt ?? undefined,
        priorPreventive: priorPreventive
          ? { date: priorPreventive.date, reading: formatNumber(priorPreventive.reading), interval: String(priorPreventive.intervalValue), evidence: priorPreventive.evidence }
          : undefined,
      }
    : null

  return (
    <EquipmentDetailView
      data={data}
      edit={edit}
      canSeeSchedules={can(session, "mant:schedules:manage")}
      canExport={can(session, "mant:export")}
      justCreated={justCreated}
      newOrder={newOrder}
      header={header}
      tabs={tabs}
      fichaActions={<><VehicleFichaPersonalUseBadge periods={personalUsePeriods} /><VehicleFichaEditAction ctx={ctx} /></>}
      showInsurance={!ctx.areas.includes("flota")}
      showIdentity={!ctx.areas.includes("flota")}
    />
  )
}

/** `updated_at` del plan del equipo, tal cual, para que el servidor detecte una edición concurrente. */
async function loadProfileUpdatedAt(vehicleId: string): Promise<string | null> {
  const [current] = await loadEquipmentCurrents(db, vehicleId)
  return current?.profileUpdatedAt ?? null
}

/**
 * La preventiva anterior a la plataforma que jefatura declaró, con el nombre de quien la declaró;
 * `null` si no hay (las cuatro columnas van juntas). Se lee del perfil, no del estado: aparece
 * aunque ya mande una preventiva firmada más nueva.
 */
async function loadPriorPreventive(vehicleId: string): Promise<PriorPreventiveView | null> {
  const [current] = await loadEquipmentCurrents(db, vehicleId)
  const fields = current?.fields
  if (!current || !fields?.priorPreventiveDate || fields.priorPreventiveReading == null || fields.priorPreventiveInterval == null || !fields.priorPreventiveEvidence) return null
  let declaredByName: string | null = null
  if (current.priorPreventiveDeclaredBy) {
    const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, current.priorPreventiveDeclaredBy)).limit(1)
    declaredByName = user?.name ?? null
  }
  return {
    date: fields.priorPreventiveDate,
    reading: fields.priorPreventiveReading,
    intervalValue: fields.priorPreventiveInterval,
    evidence: fields.priorPreventiveEvidence,
    declaredByName,
    source: current.priorPreventiveSource,
  }
}

/** Unidad de rendimiento del vehículo en el padrón (`km/L`, `L/h`); `null` si no mide. */
async function vehiclePerformanceUnit(vehicleId: string): Promise<"km_per_liter" | "liters_per_hour" | null> {
  const [row] = await db.select({ unit: fuelVehicles.performanceUnit }).from(fuelVehicles).where(eq(fuelVehicles.id, vehicleId)).limit(1)
  return row?.unit === "km_per_liter" || row?.unit === "liters_per_hour" ? row.unit : null
}
