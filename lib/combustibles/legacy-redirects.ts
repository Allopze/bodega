import { PERFORMANCE_FAMILIES, PERFORMANCE_FAMILY_SLUGS, type PerformanceFamily } from "@/lib/combustibles/control/contracts"
import { currentMonthPeriod, fuelPeriodSearchParams, resolveFuelPeriod } from "@/lib/combustibles/period/parse"
import { FUEL_PATHS, fuelBatchHref, fuelLoadHref, fuelPerformanceHref, fuelStatementHref, type FuelLoadOrigin } from "@/lib/combustibles/routes"

/**
 * Destinos de las URL de Combustible de antes del rediseño (2026-10-31).
 *
 * Cada ruta antigua quedó como página puente permanente que llama a esta
 * función: hay favoritos, enlaces guardados en `notifications.entity_href`
 * (detalles de estado de cuenta y de carga TAE) y QR impresos que las usan. La
 * función es pura y cada fila del mapa tiene su prueba en
 * `legacy-redirects.test.ts`.
 */
export type LegacyFuelRoute =
  | "analisis" | "reportes" | "revision" | "anomalias" | "anomalias-reglas"
  | "bitacora" | "bitacora-historial" | "ciclo" | "control" | "control-rendimiento" | "control-ralenti"
  | "control-registrar" | "control-revision" | "control-sellos" | "control-importar" | "control-configuracion"
  | "cuenta-corriente" | "cuenta-corriente-detalle" | "facturas" | "factura-detalle" | "nueva"
  | "importar" | "importar-detalle" | "importar-operaciones-detalle"
  | "sellos" | "tae" | "tae-detalle" | "tae-conciliacion" | "tae-importar" | "tae-importar-detalle" | "tae-importar-historial"

type SearchParams = Record<string, string | string[] | undefined>

function first(sp: SearchParams, key: string): string | undefined {
  const raw = sp[key]
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
  return value || undefined
}

function isPlainDate(value: string | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y = 0, m = 0, d = 0] = value.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/**
 * Período canónico (`periodo` o `desde`/`hasta`) a partir de lo que traiga la
 * URL vieja, con la misma precedencia y la misma validación que las pantallas:
 * una fecha inválida no viaja al destino.
 */
function periodParams(sp: SearchParams): Record<string, string> {
  // Como hacía la redirección antigua: una fecha inválida se descarta sola y la
  // válida se conserva (el resolutor completa el otro extremo).
  const clean: SearchParams = { ...sp }
  for (const key of ["desde", "hasta"]) if (!isPlainDate(first(sp, key))) delete clean[key]
  const resolved = resolveFuelPeriod({ searchParams: clean, cookieValue: null, fallback: currentMonthPeriod() })
  return resolved.source === "default" ? {} : fuelPeriodSearchParams(resolved.period)
}

const PERIOD_KEYS = new Set(["periodo", "desde", "hasta", "anio", "meses", "from", "to", "month", "startDate", "endDate"])

function build(path: string, entries: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(entries)) if (value) params.set(key, value)
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

/** Conserva los parámetros nombrados (con el mismo nombre). */
function pick(sp: SearchParams, keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, first(sp, key)]))
}

/** Conserva todo menos el período (que se traduce aparte) y las claves indicadas. */
function rest(sp: SearchParams, omit: string[] = []): Record<string, string | undefined> {
  const skip = new Set([...PERIOD_KEYS, ...omit])
  return Object.fromEntries(Object.keys(sp).filter((key) => !skip.has(key)).map((key) => [key, first(sp, key)]))
}

const PRESET_FAMILY: Record<string, PerformanceFamily> = { truck: "camiones", loaders_pickups: "cargadores_camionetas", heavy: "maquinaria" }
const FUENTE_TO_COMO: Record<string, string> = { tae_pwa: "qr,app,historico", invoiced: "factura", operation_manual: "planilla" }
const TAE_STATE_TO_ESTADO: Record<string, string> = { submitted: "por-validar", observed: "con-observacion", validated: "validada", voided: "anulada" }
const ENTITY_TO_ORIGIN: Record<string, FuelLoadOrigin> = { fuel_tae_submission: "terreno", fuel_load: "factura", fuel_operation_record: "planilla" }
const OPEN_CASE_STATES = new Set(["vigentes", "open", "in_review", "reopened"])

export function legacyFuelRedirect(route: LegacyFuelRoute, params: Record<string, string> = {}, sp: SearchParams = {}): string {
  const period = periodParams(sp)
  switch (route) {
    case "analisis": {
      const preset = first(sp, "preset")
      const family = (preset && PRESET_FAMILY[preset]) || PERFORMANCE_FAMILIES[0]
      return build(fuelPerformanceHref(PERFORMANCE_FAMILY_SLUGS[family]), { faena: first(sp, "faena"), ...period })
    }
    case "reportes":
      return build(FUEL_PATHS.consumoLitros, { seccion: "tarjetas", ...period })
    case "revision":
      return build(FUEL_PATHS.revisar, pick(sp, ["faena"]))
    case "anomalias": {
      const estado = first(sp, "estado")
      const decided = estado === "resolved" || estado === "dismissed"
      return build(FUEL_PATHS.revisar, {
        tipo: "caso",
        vista: decided ? "decididas" : undefined,
        estado: estado && !OPEN_CASE_STATES.has(estado) && !decided ? estado : undefined,
        ...pick(sp, ["faena", "severidad", "ref"]),
        pagina: first(sp, "page"),
      })
    }
    case "anomalias-reglas":
      return FUEL_PATHS.ajustesReglas
    case "bitacora": {
      const fuente = first(sp, "fuente")
      return build(FUEL_PATHS.cargas, { ...rest(sp, ["fuente"]), como: fuente ? FUENTE_TO_COMO[fuente] : undefined, ...period })
    }
    case "bitacora-historial": {
      const origen = ENTITY_TO_ORIGIN[params.entityType ?? ""]
      return origen && params.entityId ? `${fuelLoadHref({ origen, id: params.entityId })}/historial` : FUEL_PATHS.cargas
    }
    case "ciclo": {
      const etapa = first(sp, "etapa")
      return build(FUEL_PATHS.cuadraturaEstanques, {
        ...pick(sp, ["faena", "producto"]),
        etapa: etapa === "received" || etapa === "delivered" ? etapa : undefined,
        ...period,
      })
    }
    case "control":
      return build(FUEL_PATHS.consumoLitros, { ...pick(sp, ["faena", "mandante", "medio", "unidad"]), ...period })
    case "control-rendimiento":
      return build(fuelPerformanceHref(params.familia ?? PERFORMANCE_FAMILY_SLUGS[PERFORMANCE_FAMILIES[0]]), { ...rest(sp), ...period })
    case "control-ralenti":
      return build(FUEL_PATHS.consumoMotorVacio, { ...rest(sp), ...period })
    case "control-registrar":
      return build(FUEL_PATHS.registrar, { faena: first(sp, "faena"), punto: first(sp, "lugar") ?? first(sp, "punto") })
    case "control-revision": {
      const estado = first(sp, "estado")
      const decision = estado === "aprobadas" ? "cuenta" : estado === "rechazadas" ? "no-cuenta" : undefined
      return build(FUEL_PATHS.revisar, {
        tipo: "carga",
        vista: decision ? "decididas" : undefined,
        decision,
        ...pick(sp, ["faena", "mandante", "familia", "unidad", "medio", "equipo"]),
        ...period,
      })
    }
    case "control-sellos":
      return build(FUEL_PATHS.cuadraturaMandante, { ...pick(sp, ["mandante", "faena", "equipo"]), ...period })
    case "control-importar":
      return build(FUEL_PATHS.fuentes, { agregar: "telemetria" })
    case "control-configuracion":
      return FUEL_PATHS.ajustesMandantes
    case "cuenta-corriente":
      return build(FUEL_PATHS.estados, { ...pick(sp, ["proveedor"]), ...period })
    case "cuenta-corriente-detalle":
      return params.id ? fuelStatementHref(params.id) : FUEL_PATHS.estados
    case "facturas":
      return build(FUEL_PATHS.pagos, { ...rest(sp), ...period })
    case "factura-detalle":
      return params.id ? fuelLoadHref({ origen: "factura", id: params.id }) : FUEL_PATHS.pagos
    case "nueva":
      return FUEL_PATHS.pagosNueva
    case "importar":
      return first(sp, "tab") === "operaciones" ? `${FUEL_PATHS.fuentes}/agregar/planilla` : FUEL_PATHS.fuentes
    case "importar-detalle":
      return params.id ? fuelBatchHref("tarjeta", params.id) : FUEL_PATHS.fuentesArchivos
    case "importar-operaciones-detalle":
      return params.id ? fuelBatchHref("planilla", params.id) : FUEL_PATHS.fuentesArchivos
    case "sellos":
      return build(FUEL_PATHS.cuadraturaSellos, { vista: "historial", ...pick(sp, ["faena", "patente", "sello"]), ...period })
    case "tae": {
      const estado = first(sp, "estado")
      return build(FUEL_PATHS.cargas, {
        como: "qr,app,historico",
        ...rest(sp, ["estado"]),
        estado: estado ? TAE_STATE_TO_ESTADO[estado] : undefined,
        ...period,
      })
    }
    case "tae-detalle":
      return params.id ? fuelLoadHref({ origen: "terreno", id: params.id }) : FUEL_PATHS.cargas
    case "tae-conciliacion":
      return build(FUEL_PATHS.cuadraturaTarjetaTerreno, { ...pick(sp, ["faena"]), ...period })
    case "tae-importar":
      return `${FUEL_PATHS.fuentes}/agregar/sellos`
    case "tae-importar-detalle":
      return params.id ? fuelBatchHref("sellos", params.id) : FUEL_PATHS.fuentesArchivos
    case "tae-importar-historial":
      return build(FUEL_PATHS.fuentesArchivos, { tipo: "sellos" })
  }
}

/**
 * `/combustibles` es ahora el Panel. Los enlaces viejos a las vistas de
 * consumo por tarjeta (`?vista=`, `?patente=`…) siguen llegando a esa misma
 * URL: esta función dice a dónde mandarlos, o `null` si es una visita al Panel.
 */
export function legacyPanelRedirect(sp: SearchParams): string | null {
  const vista = first(sp, "vista")
  const period = periodParams(sp)
  if (vista === "registros") {
    return build(FUEL_PATHS.tarjetas, {
      ...pick(sp, ["faena", "patente", "fuente", "proveedor"]),
      sin_vincular: first(sp, "asociacion") === "no" ? "si" : undefined,
      pagina: first(sp, "page"),
      ...period,
    })
  }
  const analysisKeys = ["patente", "proveedor", "fuente", "asociacion", "page"]
  if (vista === "analisis" || analysisKeys.some((key) => first(sp, key))) {
    return build(FUEL_PATHS.consumoLitros, { seccion: "tarjetas", ...pick(sp, ["faena", "patente", "proveedor", "fuente", "asociacion"]), ...period })
  }
  return null
}
