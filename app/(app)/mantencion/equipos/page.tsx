import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { DeviceMobile, Info } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
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

export const metadata: Metadata = { title: "Equipos de mantención" }
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

  // Toda la flota del alcance (con bajas): de ahí salen las opciones de los filtros y los conteos.
  const fleet = await loadFleet({ scope: equipmentScope(viewer), includeRetired: true, readingsPerEquipment: 1 })
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

  const canManage = can(session, "mant:equipment:manage")
  const canExport = can(session, "mant:export")
  const canDevices = can(session, "mant:devices:manage")
  // Quien reparte la app en terreno: jefatura y supervisión de faena.
  const canShareApp = canDevices || can(session, "mant:records:view_worksite")

  return (
    <PageContainer>
      <PageHeader
        title="Equipos"
        description="Estado de mantención de cada equipo, de la más urgente a la más al día."
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Equipos" }]}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {canShareApp && <MechanicAppInstallDialog />}
            {canDevices && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/mantencion/dispositivos"><DeviceMobile size={14} aria-hidden />Dispositivos de la app</Link>
              </Button>
            )}
            {canExport && <EquipmentExportButton rows={rows} includeRetired={filters.includeRetired} filterLabels={filterLabels} />}
            {canManage && <Button asChild variant="secondary" size="sm"><Link href="/mantencion/equipos/importar">Importar</Link></Button>}
            {canManage && <Button asChild size="sm"><Link href="/mantencion/equipos/nuevo">Agregar equipo</Link></Button>}
          </div>
        )}
      />
      <div className="flex flex-col gap-4">
        {withoutSchedule > 0 && filters.scheduleId !== NO_SCHEDULE && (
          <Callout tone="warning" icon={<Info size={16} />} title={`${plural(withoutSchedule, "equipo activo no tiene", "equipos activos no tienen")} pauta asignada`}>
            El mecánico no podrá registrarles una mantención preventiva.{" "}
            <Link href={`/mantencion/equipos?pauta=${NO_SCHEDULE}`} className="font-semibold underline underline-offset-2">Ver cuáles</Link>
          </Callout>
        )}
        <EquipmentFilters options={options} />
        <EquipmentTable rows={rows} canManage={canManage} filtered={hasEquipmentListFilters(filters)} />
      </div>
    </PageContainer>
  )
}
