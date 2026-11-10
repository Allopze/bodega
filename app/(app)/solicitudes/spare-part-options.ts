/**
 * Repuestos del catálogo tal como los ofrece el buscador de «Solicitud de
 * repuestos»: cómo se arman desde el servicio (en el servidor), cómo suben
 * primero los que ya se compraron para el equipo del ítem, y cómo se rotulan.
 *
 * Sin acceso a datos: lo usan las páginas (servidor) y el formulario (cliente).
 * La única importación del servicio es de tipos, que no entra al bundle.
 */
import type { SparePartListItem } from "@/lib/services/spare-parts-catalog"
import { formatCLP } from "@/lib/utils"
import type { PickerOption } from "./product-picker.helpers"
import type { SparePartOption, VehicleOption } from "./request-form.types"

/** Por qué un repuesto sube en el buscador: se compró para ESE equipo o para otro del mismo modelo. */
export type SparePartMatch = "vehicle" | "model" | null

export const SPARE_PART_MATCH_LABELS: Record<Exclude<SparePartMatch, null>, string> = {
  vehicle: "Para este equipo",
  model: "Mismo modelo",
}

const SPARE_PART_MATCH_TITLES: Record<Exclude<SparePartMatch, null>, string> = {
  vehicle: "Ya se compró para el equipo elegido en este ítem",
  model: "Se compró para otro equipo de la misma marca y modelo que el elegido",
}

/** Lo que alcanza de un producto para ofrecerlo como repuesto (la ficha de una solicitud ya lo trae). */
export interface SparePartProductRow {
  id: string
  sku: string
  name: string
  partNumber: string | null
  partBrand: string | null
  unitOfMeasure: string
  isActive: boolean
}

/**
 * Del servicio al formulario. Sólo viajan al cliente los equipos que la persona
 * puede ver (`visibleVehicleIds`) y el proveedor preferido si sigue activo: el
 * selector de proveedor no ofrece los dados de baja.
 */
export function toSparePartOption(
  part: SparePartListItem,
  { activeSupplierIds, visibleVehicleIds }: {
    activeSupplierIds: ReadonlySet<string>
    visibleVehicleIds: ReadonlySet<string>
  },
): SparePartOption {
  return {
    id: part.id,
    sku: part.sku,
    name: part.name,
    partNumber: part.partNumber,
    partBrand: part.partBrand,
    unitOfMeasure: part.unitOfMeasure,
    lastPrice: part.lastPrice,
    preferredSupplierId: part.preferredSupplierId && activeSupplierIds.has(part.preferredSupplierId)
      ? part.preferredSupplierId
      : null,
    purchasedForVehicleIds: part.purchasedForVehicleIds.filter((id) => visibleVehicleIds.has(id)),
    ...(part.isActive ? {} : { isInactive: true }),
  }
}

/**
 * El catálogo activo más los repuestos que la solicitud ya referencia, aunque se
 * hayan desactivado desde entonces: la ficha tiene que seguir diciendo cuál era.
 * Los referenciados que el catálogo ya trae conservan sus datos completos.
 */
export function buildSparePartOptions({
  catalog, referenced, activeSupplierIds, visibleVehicleIds,
}: {
  catalog: SparePartListItem[]
  referenced: SparePartProductRow[]
  activeSupplierIds: ReadonlySet<string>
  visibleVehicleIds: ReadonlySet<string>
}): SparePartOption[] {
  const options = catalog.map((part) => toSparePartOption(part, { activeSupplierIds, visibleVehicleIds }))
  const known = new Set(options.map((option) => option.id))
  for (const row of referenced) {
    if (known.has(row.id)) continue
    options.push({
      id: row.id,
      sku: row.sku,
      name: row.name,
      partNumber: row.partNumber,
      partBrand: row.partBrand,
      unitOfMeasure: row.unitOfMeasure,
      lastPrice: null,
      preferredSupplierId: null,
      purchasedForVehicleIds: [],
      ...(row.isActive ? {} : { isInactive: true }),
    })
  }
  return options
}

/** SKU, N° de parte y marca de un repuesto, ya rotulados, para los resúmenes (sin vacíos). */
export function sparePartFacts(part: Pick<SparePartOption, "sku" | "partNumber" | "partBrand">): { label: string; value: string }[] {
  return [
    { label: "SKU", value: part.sku },
    { label: "N° de parte", value: part.partNumber ?? "" },
    { label: "Marca del repuesto", value: part.partBrand ?? "" },
  ].filter((fact) => fact.value.trim() !== "")
}

function modelKey(vehicle: Pick<VehicleOption, "brand" | "model">): string | null {
  const brand = vehicle.brand?.trim().toLocaleLowerCase("es-CL")
  const model = vehicle.model?.trim().toLocaleLowerCase("es-CL")
  // Sin marca o sin modelo no hay «mismo modelo»: dos equipos sin dato no son iguales.
  return brand && model ? `${brand}|${model}` : null
}

/**
 * Misma regla que `listSpareParts({ vehicleId })` del servicio, aplicada en el
 * cliente al equipo que se elige en el ítem: `vehicle` si se compró para ese
 * equipo, `model` si se compró para otro de la misma marca y modelo.
 */
export function sparePartMatchForVehicle(
  part: Pick<SparePartOption, "purchasedForVehicleIds">,
  vehicleId: string,
  vehicles: readonly Pick<VehicleOption, "id" | "brand" | "model">[],
): SparePartMatch {
  if (!vehicleId || part.purchasedForVehicleIds.length === 0) return null
  if (part.purchasedForVehicleIds.includes(vehicleId)) return "vehicle"

  const vehicle = vehicles.find((candidate) => candidate.id === vehicleId)
  const key = vehicle ? modelKey(vehicle) : null
  if (!key) return null
  const sameModel = part.purchasedForVehicleIds.some((id) => {
    const other = vehicles.find((candidate) => candidate.id === id)
    return other ? modelKey(other) === key : false
  })
  return sameModel ? "model" : null
}

/**
 * Segunda línea del renglón: «N° 1R-0750 · Caterpillar · $35.000». Lo que
 * distingue dos repuestos con el mismo nombre y orienta el precio.
 */
export function sparePartDetail(part: Pick<SparePartOption, "partNumber" | "partBrand" | "lastPrice">): string {
  return [
    part.partNumber ? `N° ${part.partNumber}` : null,
    part.partBrand || null,
    part.lastPrice != null && part.lastPrice > 0 ? formatCLP(part.lastPrice) : null,
  ].filter(Boolean).join(" · ")
}

/**
 * Las opciones del buscador para un ítem: sólo repuestos activos, con los
 * comprados para el equipo del ítem primero, luego los del mismo modelo y al
 * final el resto. Dentro de cada grupo se conserva el orden que trae el
 * catálogo (alfabético), porque `sort` es estable.
 */
export function sparePartPickerOptions(
  parts: readonly SparePartOption[],
  vehicleId: string,
  vehicles: readonly Pick<VehicleOption, "id" | "brand" | "model">[],
): PickerOption[] {
  const tier = { vehicle: 0, model: 1, none: 2 } as const
  return parts
    .filter((part) => !part.isInactive)
    .map((part) => ({ part, match: sparePartMatchForVehicle(part, vehicleId, vehicles) }))
    .sort((left, right) => tier[left.match ?? "none"] - tier[right.match ?? "none"])
    .map(({ part, match }) => ({
      id: part.id,
      sku: part.sku,
      name: part.name,
      // Cada repuesto es su propia familia: dos con el mismo nombre y distinto N°
      // de parte son dos opciones, no «2 variantes» de una.
      familyId: part.id,
      attributes: [],
      detail: sparePartDetail(part),
      searchTerms: [part.sku, part.partNumber, part.partBrand].filter((term): term is string => !!term),
      badge: match ? SPARE_PART_MATCH_LABELS[match] : null,
      badgeTitle: match ? SPARE_PART_MATCH_TITLES[match] : null,
    }))
}

/** Precio con el que se precarga el estimado: entero en CLP (el campo es de pesos enteros) o `null`. */
export function prefillPriceForPart(part: Pick<SparePartOption, "lastPrice">): string | null {
  return part.lastPrice != null && part.lastPrice > 0 ? String(Math.round(part.lastPrice)) : null
}

function foldSearch(value: string | null | undefined): string {
  return (value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim()
}

/**
 * Si el repuesto calza con lo escrito, con el criterio del buscador del servidor
 * (nombre, SKU, N° de parte —también sin guiones— y marca, sin tildes ni
 * mayúsculas). Mientras llega la respuesta a lo último escrito, el formulario
 * sigue mostrando la anterior: este filtro deja fuera las que ya no calzan, para
 * que no se elija un repuesto de una búsqueda que quien escribe ya abandonó.
 */
export function sparePartMatchesText(
  part: Pick<SparePartOption, "name" | "sku" | "partNumber" | "partBrand">,
  text: string,
): boolean {
  const query = foldSearch(text)
  if (!query) return true
  const compact = query.replace(/[^a-z0-9]/g, "")
  if ([part.name, part.sku, part.partNumber, part.partBrand].some((value) => foldSearch(value).includes(query))) return true
  return compact !== "" && foldSearch(part.partNumber).replace(/[^a-z0-9]/g, "").includes(compact)
}
