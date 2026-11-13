import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Info } from "@phosphor-icons/react/dist/ssr"
import { Callout } from "@/components/ui/callout"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { AddEquipmentButton } from "@/components/mantencion/jefatura/equipos/add-equipment-button"
import { MechanicAppInstallDialog } from "@/components/mantencion/jefatura/shared/mechanic-app-install-dialog"
import { EquipmentExportButton } from "@/components/mantencion/jefatura/equipos/equipment-export-button"
import { EquipmentFilters } from "@/components/mantencion/jefatura/equipos/equipment-filters"
import { EquipmentTable } from "@/components/mantencion/jefatura/equipos/equipment-table"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { EQUIPMENT_STATE_LABEL, plural } from "@/lib/mantencion/format"
import { equipmentScope, viewerFromSession } from "@/lib/services/mantencion/access"
import {
  NO_SCHEDULE, filterFleet, hasEquipmentListFilters, parseEquipmentListFilters, sortFleetByState, toEquipmentListRow,
  type RawSearchParams,
} from "@/lib/services/mantencion/equipment-list"
import { loadFleet } from "@/lib/services/mantencion/fleet"
import { listIncorporationCandidates } from "@/lib/services/mantencion/fleet-incorporation"

export const metadata: Metadata = { title: "Equipos" }
export const dynamic = "force-dynamic"

export default async function EquipmentPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  let session
  try {
    session = await requireAnyPermission(["mant:records:view_worksite", "mant:records:view_all", "mant:equipment:manage"])
  } catch {
    redirect("/forbidden")
  }
  const viewer = viewerFromSession(session)
  const filters = parseEquipmentListFilters(await searchParams)
  // La estimación GPS es un dato de Flota. Sin `flota:view` no se carga ni se
  // ofrece el filtro: un enlace con ?estimacionGps= no debe dejar la lista vacía.
  const canViewFleet = can(session, "flota:view")
  if (!canViewFleet) filters.gpsEstimate = undefined

  // Toda la flota del alcance (con bajas): de ahí salen las opciones de los filtros y los conteos.
  const fleet = await loadFleet({
    scope: equipmentScope(viewer),
    includeRetired: true,
    readingsPerEquipment: 1,
    includeGpsEstimate: canViewFleet,
  })
  const rows = sortFleetByState(filterFleet(fleet, filters)).map(toEquipmentListRow)
  const withoutSchedule = fleet.filter((row) => !row.retired && row.scheduleId === null).length

  type Choice = { value: string; label: string }
  const unique = (pick: (row: (typeof fleet)[number]) => [string, string]): Choice[] =>
    [...new Map(fleet.map(pick)).entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "es"))
  const options = {
    worksites: unique((row) => [row.worksiteId, row.worksiteName]),
    types: unique((row) => [row.typeId, row.typeName]),
    schedules: unique((row) => (row.scheduleId ? [row.scheduleId, row.scheduleName ?? ""] : ["", ""])).filter((option) => option.value),
  }
  const labelOf = (list: Choice[], value?: string) => list.find((item) => item.value === value)?.label ?? ""
  const filterLabels: Record<string, string> = {}
  if (filters.worksiteId) filterLabels.faena = labelOf(options.worksites, filters.worksiteId)
  if (filters.typeId) filterLabels.tipo = labelOf(options.types, filters.typeId)
  if (filters.scheduleId) filterLabels.pauta = filters.scheduleId === NO_SCHEDULE ? "Sin pauta" : labelOf(options.schedules, filters.scheduleId)
  if (filters.state) filterLabels.estado = EQUIPMENT_STATE_LABEL[filters.state]
  if (filters.gpsEstimate) filterLabels.estimacionGps = filters.gpsEstimate === "vencida" ? "Vencida (estimación GPS)" : "Próxima (estimación GPS)"
  if (filters.inWorkshop) filterLabels.situacion = "En taller"

  const canManage = can(session, "mant:equipment:manage")
  // Vehículos de la flota sin ficha de mantención: se incorporan sin volver a escribirlos.
  const pendingFleet = canManage ? (await listIncorporationCandidates(equipmentScope(viewer))).length : 0
  const showNoSchedule = withoutSchedule > 0 && filters.scheduleId !== NO_SCHEDULE
  // Con la lista vacía, «Incorporar los N vehículos de la flota» ya es el llamado del estado vacío: dos iguales no suman.
  const showPendingFleet = pendingFleet > 0 && !(rows.length === 0 && !hasEquipmentListFilters(filters))
  const canExport = can(session, "mant:export")
  // La app se reparte por QR. Quien administra los dispositivos lo hace desde «Dispositivos» (ítem del menú, con su
  // propio botón «Instalar app»); la supervisión de faena, que no entra ahí, la reparte desde esta cabecera.
  const canDevices = can(session, "mant:devices:manage")
  const canShareApp = !canDevices && can(session, "mant:records:view_worksite")

  return (
    <PageContainer>
      <PageHeader
        title="Equipos"
        description="Estado de mantención de cada equipo, de la más urgente a la más al día."
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Equipos" }]}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {canShareApp && <MechanicAppInstallDialog />}
            {canExport && <EquipmentExportButton rows={rows} includeRetired={filters.includeRetired} filterLabels={filterLabels} />}
            {canManage && <AddEquipmentButton pendingFleet={pendingFleet} />}
          </div>
        )}
      />
      <div className="flex flex-col gap-4">
        {(showNoSchedule || showPendingFleet) && (
          // Una sola tira con lo que falta completar (antes eran dos avisos que empujaban la lista).
          <Callout tone={showNoSchedule ? "warning" : "info"} icon={<Info size={16} />} title="Falta completar">
            <ul className="flex flex-col gap-1">
              {showNoSchedule && (
                <li>
                  {plural(withoutSchedule, "equipo activo no tiene", "equipos activos no tienen")} pauta: el mecánico no podrá registrarles una mantención preventiva.{" "}
                  <Link href={`/mantencion/equipos?pauta=${NO_SCHEDULE}`} className="font-semibold underline underline-offset-2">Ver cuáles</Link>
                </li>
              )}
              {showPendingFleet && (
                <li>
                  {plural(pendingFleet, "vehículo de la flota aún no está", "vehículos de la flota aún no están")} en Mantención: sólo falta su marca y su pauta.{" "}
                  <Link href="/mantencion/equipos/incorporar" className="font-semibold underline underline-offset-2">Incorporarlos</Link>
                </li>
              )}
            </ul>
          </Callout>
        )}
        <EquipmentFilters options={options} canViewGps={canViewFleet} />
        <EquipmentTable rows={rows} canManage={canManage} canViewGps={canViewFleet} filtered={hasEquipmentListFilters(filters)} pendingFleet={pendingFleet} />
      </div>
    </PageContainer>
  )
}
