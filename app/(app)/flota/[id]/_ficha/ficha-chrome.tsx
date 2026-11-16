import type { BreadcrumbItem } from "@/components/ui/page-header"
import { SectionNav } from "@/components/ui/section-nav"
import { FLEET_STATE_META } from "@/components/states/state-badge"
import { FUEL_PERIOD_PARAMS } from "@/lib/combustibles/period/types"
import { VEHICLE_FICHA_TAB_LABELS, vehicleFichaHref, type VehicleFichaTab } from "@/lib/routing/vehicle-ficha"
import type { VehicleFichaContext } from "@/lib/services/vehicle-ficha"
import { VehicleEditButton } from "./vehicle-edit-button"

/**
 * Lo común a las cuatro pestañas de la ficha del vehículo: el nombre, la línea que lo
 * describe y la barra de pestañas. Cada pestaña pinta su propio `PageHeader` (sus acciones
 * son suyas: «Crear orden de trabajo» en Mantención, el período en Combustible) con estas
 * piezas, así que el título y la descripción son los mismos en todas.
 */

/** «Camión · DZTH-66 · Santa Fe · Operativo». La patente sólo si no es ya el título. */
export function vehicleFichaDescription({ vehicle }: VehicleFichaContext): string {
  const plate = vehicle.noPlate
    ? "Sin patente"
    : vehicle.code && vehicle.plate !== vehicle.code ? vehicle.plate : null
  const state = FLEET_STATE_META[vehicle.isActive ? vehicle.operationalStatus : "inactivo"]?.label ?? null
  return [vehicle.typeName, plate, vehicle.worksiteName, state].filter(Boolean).join(" · ")
}

/**
 * Miga de pan de Resumen y Flota: la lista de Vehículos. Mantención y Combustible usan la de su
 * área (Equipos, Consumo), que es de donde se llega a esas pestañas.
 */
export function vehicleFichaBreadcrumb(ctx: VehicleFichaContext, tab: "resumen" | "flota" | "mantencion"): BreadcrumbItem[] {
  if (tab === "mantencion") {
    return [
      { label: "Control operacional", href: "/control-operacional" },
      { label: "Mantención" },
      { label: "Equipos", href: "/mantencion/equipos" },
      { label: ctx.label },
    ]
  }
  return [
    { label: "Control operacional", href: "/control-operacional" },
    // Sin `flota:view` la lista de Vehículos no se abre: el rótulo queda, sin enlace.
    { label: "Vehículos", href: ctx.permittedAreas.includes("flota") ? "/flota" : undefined },
    { label: ctx.label },
  ]
}

/**
 * Pestañas de la ficha. Con una sola área visible `SectionNav` no dibuja nada: la ficha es esa
 * área y nada más. El período de Combustible viaja al cambiar de pestaña (el Resumen lo usa
 * para su línea de rendimiento).
 */
export function VehicleFichaTabs({ ctx, active }: { ctx: VehicleFichaContext; active: VehicleFichaTab }) {
  return (
    <SectionNav
      ariaLabel={`Ficha de ${ctx.label}`}
      activeKey={active}
      carryParams={FUEL_PERIOD_PARAMS}
      items={ctx.tabs.map((tab) => ({ key: tab, href: vehicleFichaHref(ctx.vehicle.id, tab), label: VEHICLE_FICHA_TAB_LABELS[tab] }))}
    />
  )
}

/**
 * «Editar vehículo», en la cabecera de todas las pestañas: el padrón, único lugar donde se edita
 * la identidad del vehículo (crítica 2026-11-15, paso 4b). Sin el permiso o fuera de su alcance,
 * nada.
 */
export function VehicleFichaEditAction({ ctx }: { ctx: VehicleFichaContext }) {
  return ctx.canEditVehicle ? <VehicleEditButton vehicleId={ctx.vehicle.id} /> : null
}
