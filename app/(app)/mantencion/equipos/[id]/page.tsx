import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { EquipmentDetailView } from "@/components/mantencion/jefatura/equipos/equipment-detail-view"
import type { EquipmentDetailData, EquipmentEditData } from "@/components/mantencion/jefatura/equipos/equipment-detail-types"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { formatNumber } from "@/lib/mantencion/format"
import { equipmentScope, recordVisibility, recordVisibilitySql, viewerFromSession } from "@/lib/services/mantencion/access"
import { countEquipmentRecords } from "@/lib/services/mantencion/equipment"
import { loadEquipmentInsurance, loadLifeRows, loadLifeTotals } from "@/lib/services/mantencion/equipment-life"
import { listEquipmentHistory } from "@/lib/services/mantencion/equipment-history"
import { loadFleet } from "@/lib/services/mantencion/fleet"
import { LIFE_PAGE_SIZE } from "@/components/mantencion/jefatura/equipos/equipment-life-section"
import { loadEquipmentFormCatalogs } from "../form-catalogs"

export const metadata: Metadata = { title: "Ficha de equipo" }
export const dynamic = "force-dynamic"

export default async function EquipmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try {
    session = await requireAnyPermission(["mant:records:view_worksite", "mant:records:view_all", "mant:equipment:manage"])
  } catch {
    redirect("/forbidden")
  }
  const viewer = viewerFromSession(session)
  const { id } = await params
  const query = await searchParams
  const justCreated = query.creado === "1"
  // «Mostrar más» sube `?vida=`; se acota para que la URL no pida el mundo.
  const requested = Number(Array.isArray(query.vida) ? query.vida[0] : query.vida)
  const lifeLimit = Number.isInteger(requested) && requested > LIFE_PAGE_SIZE ? Math.min(requested, 500) : LIFE_PAGE_SIZE

  // El alcance de faenas se aplica en la carga: un equipo ajeno es «no encontrado», no «sin permiso».
  const [row] = await loadFleet({ scope: equipmentScope(viewer), includeRetired: true, vehicleIds: [id], readingsPerEquipment: 1 })
  if (!row) notFound()

  const canManage = can(session, "mant:equipment:manage")
  // La hoja de vida y sus totales respetan el alcance de lectura: un supervisor sólo ve su faena y lo propio.
  const visibility = recordVisibilitySql(recordVisibility(viewer))
  const [history, life, totals, insurance, recordCount, catalogs] = await Promise.all([
    listEquipmentHistory(id),
    loadLifeRows(id, visibility, { limit: lifeLimit }),
    loadLifeTotals(id, visibility),
    loadEquipmentInsurance(id),
    countEquipmentRecords(id),
    canManage ? loadEquipmentFormCatalogs() : Promise.resolve(null),
  ])

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
    recordCount,
    life: { rows: life.rows, totals, hasMore: life.hasMore, limit: lifeLimit },
    insurance,
    canViewFleet: can(session, "flota:view"),
    history,
  }

  const edit: EquipmentEditData | null = catalogs
    ? {
        catalogs,
        initial: {
          code: row.code,
          plate: row.noPlate ? "" : row.plate,
          noPlate: row.noPlate,
          equipmentTypeId: row.typeId,
          brandId: row.brandId,
          model: row.model ?? "",
          year: row.year != null ? String(row.year) : "",
          worksiteId: row.worksiteId,
          newWorksiteName: "",
          scheduleId: row.scheduleId ?? "",
          initialReading: row.initialReading ? formatNumber(row.initialReading.value) : "",
          initialReadingDate: row.initialReading?.date ?? "",
          retired: row.retired,
          retiredReason: row.retiredReason ?? "",
        },
      }
    : null

  return <EquipmentDetailView data={data} edit={edit} canSeeSchedules={can(session, "mant:schedules:manage")} canExport={can(session, "mant:export")} justCreated={justCreated} />
}
