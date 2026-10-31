import { FUEL_CARRY_PARAMS } from "@/lib/combustibles/period/types"

/**
 * URL del módulo de Combustible. Una sola fuente para el menú, los enlaces, las
 * rutas operativas de los permisos (`requirePermission(perm, FUEL_PATHS.x)`) y
 * los interruptores de submódulo. Las URL de antes del rediseño redirigen desde
 * `lib/combustibles/legacy-redirects.ts`.
 */
export const FUEL_PATHS = {
  panel: "/combustibles",
  cargas: "/combustibles/cargas",
  tarjetas: "/combustibles/cargas/tarjetas",
  registrar: "/combustibles/cargas/registrar",
  revisar: "/combustibles/revisar",
  cuadratura: "/combustibles/cuadratura",
  cuadraturaMandante: "/combustibles/cuadratura/mandante",
  cuadraturaProveedor: "/combustibles/cuadratura/proveedor",
  cuadraturaTarjetaTerreno: "/combustibles/cuadratura/tarjeta-y-terreno",
  cuadraturaEstanques: "/combustibles/cuadratura/estanques",
  cuadraturaSellos: "/combustibles/cuadratura/sellos",
  consumo: "/combustibles/consumo",
  consumoLitros: "/combustibles/consumo/litros",
  consumoMotorVacio: "/combustibles/consumo/motor-en-vacio",
  pagos: "/combustibles/pagos",
  pagosNueva: "/combustibles/pagos/nueva",
  estados: "/combustibles/pagos/estados",
  fuentes: "/combustibles/fuentes",
  fuentesArchivos: "/combustibles/fuentes/archivos",
  ajustes: "/combustibles/ajustes",
  ajustesMandantes: "/combustibles/ajustes/mandantes",
  ajustesMedios: "/combustibles/ajustes/medios",
  ajustesFamilias: "/combustibles/ajustes/familias",
  ajustesUmbrales: "/combustibles/ajustes/umbrales",
  ajustesReglas: "/combustibles/ajustes/reglas",
  ajustesPuntos: "/combustibles/ajustes/puntos-de-carga",
  ajustesIntegraciones: "/combustibles/ajustes/integraciones",
} as const

export type FuelPathKey = keyof typeof FUEL_PATHS

/** Origen de una carga en su ficha: formulario o app (terreno), planilla de cargas o factura. */
export const FUEL_LOAD_ORIGINS = ["terreno", "planilla", "factura"] as const
export type FuelLoadOrigin = (typeof FUEL_LOAD_ORIGINS)[number]

export function isFuelLoadOrigin(value: string): value is FuelLoadOrigin {
  return (FUEL_LOAD_ORIGINS as readonly string[]).includes(value)
}

export function fuelLoadHref({ origen, id }: { origen: FuelLoadOrigin; id: string }): string {
  return `${FUEL_PATHS.cargas}/${origen}/${encodeURIComponent(id)}`
}

export function fuelLoadHistoryHref(load: { origen: FuelLoadOrigin; id: string }): string {
  return `${fuelLoadHref(load)}/historial`
}

/** Ficha de una carga a partir de su fila en `fuel_equipment_loads`. */
export function fuelLoadHrefFromEquipmentLoad(load: {
  source: string
  taeSubmissionId: string | null
  operationRecordId: string | null
}): string | null {
  if (load.source === "operations_import") return load.operationRecordId ? fuelLoadHref({ origen: "planilla", id: load.operationRecordId }) : null
  return load.taeSubmissionId ? fuelLoadHref({ origen: "terreno", id: load.taeSubmissionId }) : null
}

/** Ficha de equipo; `vehicleId` es el id de `fuel_vehicles`. */
export function fuelEquipmentHref(vehicleId: string): string {
  return `${FUEL_PATHS.consumo}/equipos/${encodeURIComponent(vehicleId)}`
}

export function fuelStatementHref(statementId: string): string {
  return `${FUEL_PATHS.estados}/${encodeURIComponent(statementId)}`
}

export const FUEL_BATCH_KINDS = ["tarjeta", "planilla", "sellos"] as const
export type FuelBatchKind = (typeof FUEL_BATCH_KINDS)[number]

export function fuelBatchHref(kind: FuelBatchKind, batchId: string): string {
  return `${FUEL_PATHS.fuentesArchivos}/${kind}/${encodeURIComponent(batchId)}`
}

export function fuelPerformanceHref(familySlug: string): string {
  return `${FUEL_PATHS.consumo}/rendimiento/${familySlug}`
}

export type FuelInboxKindParam = "carga" | "caso" | "patente" | "pedido"

export function fuelInboxHref(options: { tipo?: FuelInboxKindParam; item?: string; faena?: string } = {}): string {
  const params = new URLSearchParams()
  if (options.tipo) params.set("tipo", options.tipo)
  if (options.faena) params.set("faena", options.faena)
  if (options.item) params.set("item", options.item)
  const query = params.toString()
  return query ? `${FUEL_PATHS.revisar}?${query}` : FUEL_PATHS.revisar
}

/** Agrega a `href` el período y la faena de la pantalla actual (si `href` no los trae). */
export function withFuelContext(
  href: string,
  current: URLSearchParams | Record<string, string | string[] | undefined>,
): string {
  const [path, query = ""] = href.split("?")
  const params = new URLSearchParams(query)
  for (const key of FUEL_CARRY_PARAMS) {
    if (params.has(key)) continue
    const raw = current instanceof URLSearchParams ? current.get(key) : current[key]
    const value = Array.isArray(raw) ? raw[0] : raw
    if (value) params.set(key, value)
  }
  // `periodo` y un rango no conviven: si quedó el rango, se descarta el token.
  if (params.has("desde") && params.has("periodo") && !new URLSearchParams(query).has("periodo")) params.delete("periodo")
  const out = params.toString()
  return out ? `${path}?${out}` : path
}
