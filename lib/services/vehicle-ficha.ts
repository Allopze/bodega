import { cache } from "react"
import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import { contractVehicleAssignments, contracts, fuelEquipmentTypes, fuelVehicles, mantBrands, mantEquipmentProfiles, worksites } from "@/db/schema"
import { can, canAccessWorksite, canAny } from "@/lib/auth/can"
import { VEHICLE_FICHA_AREAS, type VehicleFichaArea, type VehicleFichaTab } from "@/lib/routing/vehicle-ficha"
import { listVehicleAssignmentHistory, type VehicleAssignmentRow } from "@/lib/services/contracts/assignments"
import { equipmentScope, isWorksiteInScope, viewerFromSession } from "@/lib/services/mantencion/access"
import { getNavigationToggleState, routeIsEnabled } from "@/lib/services/module-toggles"
import { todayInChile } from "@/lib/utils"
import type { Permission } from "@/modules/permissions"

/**
 * Quién ve qué pestaña de la ficha única del vehículo (`/flota/[id]`, crítica 2026-11-15).
 *
 * Una pestaña aparece si quien mira tiene **el permiso del área** (los mismos que pedían las
 * tres fichas que reemplaza), **el módulo del área está encendido** y **el vehículo cae en su
 * alcance de faenas para esa área**. Cada página de pestaña lo vuelve a exigir en el servidor:
 * ocultar una pestaña no es autorización.
 *
 * Con los permisos por defecto: jefatura y administrador ven las tres; supervisor de
 * mantención sólo Mantención; administración de contrato, solicitante y prevencionista de
 * faena sólo Combustible. Con una sola área no hay pestañas ni «Resumen».
 */
export const VEHICLE_FICHA_AREA_PERMISSIONS: Record<VehicleFichaArea, readonly Permission[]> = {
  flota: ["flota:view"],
  mantencion: ["mant:records:view_worksite", "mant:records:view_all", "mant:equipment:manage"],
  combustible: ["combustibles:view"],
}

/**
 * Sección del menú de cada área: la que miran los interruptores de módulo y la que va en
 * `?desde=` cuando falta el permiso (el destino de vuelta de «Sin permiso»).
 */
export const VEHICLE_FICHA_AREA_ROUTES: Record<VehicleFichaArea, string> = {
  flota: "/flota",
  mantencion: "/mantencion/equipos",
  combustible: "/combustibles/consumo",
}

export const VEHICLE_FICHA_PERMISSIONS: readonly Permission[] = VEHICLE_FICHA_AREAS.flatMap((area) => VEHICLE_FICHA_AREA_PERMISSIONS[area])

export interface VehicleFichaVehicle {
  id: string
  code: string | null
  plate: string
  /** Equipo sin patente (el perfil de Mantención lo marca; la patente guardada es un relleno). */
  noPlate: boolean
  typeName: string
  /**
   * Marca: la de la lista cerrada de Mantención si está en ella y, si no, el texto del padrón.
   * Antes cada pestaña leía la suya y un mismo camión decía «Volvo» en una y «VOLVO FH» en otra.
   */
  brand: string | null
  worksiteId: string
  worksiteName: string
  /**
   * Contrato al que el equipo trabaja hoy (la asignación que cubre `todayInChile()`), o `null`
   * si no tiene. A lo más uno: las asignaciones de un equipo no se traslapan.
   */
  contractName: string | null
  operationalStatus: string
  isActive: boolean
}

export interface VehicleFichaContext {
  vehicle: VehicleFichaVehicle
  /** Cómo se nombra el vehículo: el código interno y, sin él, la patente. */
  label: string
  /** ¿Está en el plan de Mantención? Sin perfil, la pestaña Mantención muestra cómo incorporarlo. */
  hasMaintenanceProfile: boolean
  /** Áreas con permiso y módulo encendido, sin mirar la faena: distingue «sin permiso» de «no encontrado». */
  permittedAreas: VehicleFichaArea[]
  /** Áreas que puede abrir para ESTE vehículo (permiso, módulo y faena), en el orden de las pestañas. */
  areas: VehicleFichaArea[]
  /** Pestañas a dibujar: «Resumen» más las áreas cuando son dos o más; con una sola, sólo esa. */
  tabs: VehicleFichaTab[]
  /**
   * «Editar vehículo» en la cabecera: el padrón (`admin:fleet_vehicles`) con la faena del vehículo
   * en su alcance, lo mismo que exige guardar. Es el único lugar donde se edita la identidad
   * (crítica 2026-11-15, paso 4b).
   */
  canEditVehicle: boolean
}

/** La fila del vehículo, una vez por request aunque la pidan la página y sus secciones. */
const loadFichaVehicle = cache(async (vehicleId: string): Promise<(VehicleFichaVehicle & { hasProfile: boolean }) | null> => {
  const today = todayInChile()
  const [row] = await db.select({
    id: fuelVehicles.id,
    code: fuelVehicles.code,
    plate: fuelVehicles.plate,
    typeName: fuelEquipmentTypes.name,
    fleetBrand: fuelVehicles.brand,
    maintenanceBrand: mantBrands.name,
    worksiteId: fuelVehicles.worksiteId,
    worksiteName: worksites.name,
    contractName: contracts.name,
    operationalStatus: fuelVehicles.operationalStatus,
    isActive: fuelVehicles.isActive,
    profileVehicleId: mantEquipmentProfiles.vehicleId,
    noPlate: mantEquipmentProfiles.noPlate,
  })
    .from(fuelVehicles)
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
    .leftJoin(mantEquipmentProfiles, eq(mantEquipmentProfiles.vehicleId, fuelVehicles.id))
    .leftJoin(mantBrands, eq(mantBrands.id, mantEquipmentProfiles.brandId))
    .leftJoin(contractVehicleAssignments, and(
      eq(contractVehicleAssignments.vehicleId, fuelVehicles.id),
      lte(contractVehicleAssignments.validFrom, today),
      or(isNull(contractVehicleAssignments.validTo), gte(contractVehicleAssignments.validTo, today)),
    ))
    .leftJoin(contracts, eq(contracts.id, contractVehicleAssignments.contractId))
    .where(eq(fuelVehicles.id, vehicleId))
    .limit(1)
  if (!row) return null
  const { profileVehicleId, noPlate, code, fleetBrand, maintenanceBrand, contractName, ...vehicle } = row
  return {
    ...vehicle,
    contractName: contractName ?? null,
    code: code?.trim() || null,
    brand: maintenanceBrand ?? (fleetBrand?.trim() || null),
    noPlate: noPlate ?? false,
    hasProfile: profileVehicleId !== null,
  }
})

/** ¿La faena del vehículo está en el alcance de esa área? Flota y Combustible usan el alcance de la sesión; Mantención, el de equipos. */
export function areaCoversWorksite(session: Session, area: VehicleFichaArea, worksiteId: string): boolean {
  if (area === "mantencion") return isWorksiteInScope(equipmentScope(viewerFromSession(session)), worksiteId)
  return canAccessWorksite(session, worksiteId)
}

/** Las pestañas que se dibujan para un conjunto de áreas visibles. */
export function fichaTabsFor(areas: readonly VehicleFichaArea[]): VehicleFichaTab[] {
  return areas.length >= 2 ? ["resumen", ...areas] : [...areas]
}

/**
 * Contexto común de la ficha: el vehículo y lo que quien mira puede abrir de él. `null` si el
 * vehículo no existe. No decide la respuesta (404 o «sin permiso»): eso lo hace la página.
 */
export async function loadVehicleFichaContext(session: Session, vehicleId: string): Promise<VehicleFichaContext | null> {
  const [row, toggles] = await Promise.all([loadFichaVehicle(vehicleId), getNavigationToggleState()])
  if (!row) return null
  const { hasProfile, ...vehicle } = row
  const permittedAreas = VEHICLE_FICHA_AREAS.filter((area) =>
    canAny(session, ...VEHICLE_FICHA_AREA_PERMISSIONS[area]) && routeIsEnabled(VEHICLE_FICHA_AREA_ROUTES[area], toggles))
  const areas = permittedAreas.filter((area) => areaCoversWorksite(session, area, vehicle.worksiteId))
  return {
    vehicle,
    label: vehicle.code ?? vehicle.plate,
    hasMaintenanceProfile: hasProfile,
    permittedAreas,
    areas,
    tabs: fichaTabsFor(areas),
    canEditVehicle: can(session, "admin:fleet_vehicles") && canAccessWorksite(session, vehicle.worksiteId),
  }
}

/** Contrato activo de la faena del equipo, para elegirlo al «Cambiar contrato». */
export interface VehicleContractOption { id: string; name: string; code: string }

/**
 * Lo que dibuja la tarjeta «Contrato» de la pestaña Flota: la historia del equipo (la más reciente
 * primero) y, sólo si quien mira puede cambiarla, los contratos activos de la faena del equipo
 * (un equipo sólo se asigna a contratos de su propia faena).
 */
export async function loadVehicleContractCard(
  vehicleId: string,
  worksiteId: string,
  options: { withOptions: boolean },
): Promise<{ history: VehicleAssignmentRow[]; contractOptions: VehicleContractOption[] }> {
  const [history, contractOptions] = await Promise.all([
    listVehicleAssignmentHistory(vehicleId),
    options.withOptions
      ? db.select({ id: contracts.id, name: contracts.name, code: contracts.code })
          .from(contracts)
          .where(and(eq(contracts.worksiteId, worksiteId), eq(contracts.status, "active")))
          .orderBy(asc(contracts.name))
      : Promise.resolve([] as VehicleContractOption[]),
  ])
  return { history, contractOptions }
}
