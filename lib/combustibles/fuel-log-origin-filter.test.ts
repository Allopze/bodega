import { describe, expect, it } from "vitest"
import {
  FUEL_LOAD_STATE_SLUGS,
  fuelLogBranchesFor,
  fuelLogPending,
  parseFuelLoadOrigins,
  parseFuelLoadState,
  type FuelLogRow,
} from "./fuel-log-shared"
import { countActiveAdvancedFilters, parseCargasSearchParams, sanitizeFuelLogFilters } from "./fuel-log-params"

const PERIOD = { from: "2026-10-01", to: "2026-10-31" }

describe("filtro «Cómo llegó» (`como`)", () => {
  it("lee varios orígenes separados por coma, sin repetidos y en el orden del catálogo", () => {
    expect(parseFuelLoadOrigins("factura,qr,qr, app")).toEqual(["qr", "app", "factura"])
    expect(parseFuelLoadOrigins(["planilla,historico"])).toEqual(["historico", "planilla"])
  })

  it("descarta valores que no existen en vez de filtrar por ellos", () => {
    expect(parseFuelLoadOrigins("tae_pwa,otra-cosa")).toEqual([])
    expect(parseFuelLoadOrigins(undefined)).toEqual([])
    expect(parseFuelLoadOrigins("")).toEqual([])
  })

  it("`qr,app,historico` (el destino de las URL de la lista TAE) deja sólo la rama de registros en terreno", () => {
    expect(fuelLogBranchesFor({ origins: parseFuelLoadOrigins("qr,app,historico") })).toEqual({ tae: true, invoiced: false, operation: false })
  })

  it("factura y planilla seleccionan sus propias ramas; sin filtro, las tres", () => {
    expect(fuelLogBranchesFor({ origins: ["factura"] })).toEqual({ tae: false, invoiced: true, operation: false })
    expect(fuelLogBranchesFor({ origins: ["planilla", "qr"] })).toEqual({ tae: true, invoiced: false, operation: true })
    expect(fuelLogBranchesFor({})).toEqual({ tae: true, invoiced: true, operation: true })
  })
})

describe("filtro «Estado» (`estado`)", () => {
  it("acepta los estados del catálogo y descarta lo demás", () => {
    expect(parseFuelLoadState("validada")).toBe("validada")
    expect(parseFuelLoadState("submitted")).toBeUndefined()
    expect(parseFuelLoadState("constructor")).toBeUndefined()
    expect(parseFuelLoadState(undefined)).toBeUndefined()
  })

  it("un estado de registros en terreno no trae facturas, y al revés", () => {
    expect(fuelLogBranchesFor({ stateSlug: "por-validar" })).toEqual({ tae: true, invoiced: false, operation: false })
    expect(fuelLogBranchesFor({ stateSlug: "borrador" })).toEqual({ tae: false, invoiced: true, operation: false })
    // «Anulada» existe en los dos orígenes.
    expect(fuelLogBranchesFor({ stateSlug: "anulada" })).toEqual({ tae: true, invoiced: true, operation: false })
  })

  it("la planilla no tiene estado: con cualquier estado no aporta filas, y combinada con un estado ajeno no queda ninguna rama", () => {
    for (const slug of Object.keys(FUEL_LOAD_STATE_SLUGS) as Array<keyof typeof FUEL_LOAD_STATE_SLUGS>) {
      expect(fuelLogBranchesFor({ stateSlug: slug }).operation).toBe(false)
    }
    expect(fuelLogBranchesFor({ origins: ["planilla"], stateSlug: "validada" })).toEqual({ tae: false, invoiced: false, operation: false })
    expect(fuelLogBranchesFor({ origins: ["factura"], stateSlug: "validada" })).toEqual({ tae: false, invoiced: false, operation: false })
  })

  it("`source` y `como` se combinan: deben cumplirse los dos", () => {
    expect(fuelLogBranchesFor({ source: "tae_pwa", origins: ["factura"] })).toEqual({ tae: false, invoiced: false, operation: false })
    expect(fuelLogBranchesFor({ source: "invoiced", origins: ["factura", "qr"] })).toEqual({ tae: false, invoiced: true, operation: false })
  })
})

describe("parámetros de URL de Cargas → filtros", () => {
  it("lee `como`, `estado`, `pendiente`, `equipo` y la faena, con el período de la cabecera", () => {
    const { filters, sort, page } = parseCargasSearchParams(
      { como: "qr,app", estado: "con-observacion", pendiente: "si", equipo: "veh-9", faena: "w-1", q: " CA-14 ", orden: "asc", pagina: "3" },
      { canViewPersonal: true, period: PERIOD },
    )
    expect(filters).toMatchObject({ origins: ["qr", "app"], stateSlug: "con-observacion", onlyPending: true, vehicleId: "veh-9", worksiteId: "w-1", q: "CA-14", from: "2026-10-01", to: "2026-10-31" })
    expect(sort).toBe("asc")
    expect(page).toBe(3)
  })

  it("`mias=si` filtra por quien mira y se combina con `estado`; sin sesión, o sin `mias`, no filtra por persona", () => {
    const withUser = parseCargasSearchParams({ mias: "si", estado: "por-validar" }, { canViewPersonal: false, period: PERIOD, currentUserId: "user-7" })
    expect(withUser.filters).toMatchObject({ registeredBy: "user-7", stateSlug: "por-validar" })
    expect(parseCargasSearchParams({ mias: "si" }, { canViewPersonal: false, period: PERIOD }).filters.registeredBy).toBeUndefined()
    expect(parseCargasSearchParams({ mias: "no" }, { canViewPersonal: false, period: PERIOD, currentUserId: "user-7" }).filters.registeredBy).toBeUndefined()
    expect(countActiveAdvancedFilters({ mias: "si" }, false)).toBe(1)
  })

  it("con `mias=si` sólo quedan las cargas de terreno: planilla y factura no son «de» nadie", () => {
    expect(fuelLogBranchesFor({ registeredBy: "user-7" })).toEqual({ tae: true, invoiced: false, operation: false })
    expect(fuelLogBranchesFor({ registeredBy: "user-7", origins: ["factura"] })).toEqual({ tae: false, invoiced: false, operation: false })
  })

  it("acepta los nombres de la bitácora y de la lista de registros en terreno de antes", () => {
    const { filters, page } = parseCargasSearchParams(
      { punto: "pt-1", sello: "faltante", evidencia: "faltante", page: "2", revision: "si" },
      { canViewPersonal: false, period: PERIOD },
    )
    expect(filters).toMatchObject({ loadingPointId: "pt-1", sealIncomplete: true, photosIncomplete: true, hasReviewMark: true })
    expect(page).toBe(2)
  })

  it("sin view_personal ignora los filtros por nombre y no los cuenta", () => {
    const sp = { conductor: "Ana", supervisor: "Luis", marca: "Volvo" }
    const { filters } = parseCargasSearchParams(sp, { canViewPersonal: false, period: PERIOD })
    expect(filters.driverName).toBeUndefined()
    expect(filters.supervisorName).toBeUndefined()
    expect(filters.brand).toBe("Volvo")
    expect(countActiveAdvancedFilters(sp, false)).toBe(1)
    expect(countActiveAdvancedFilters(sp, true)).toBe(3)
  })

  it("descarta valores fuera de enum en vez de filtrar por algo que no existe", () => {
    const { filters, page } = parseCargasSearchParams(
      { estado: "submitted", estado_operativo: "inventado", unidad_rendimiento: "mph", anomalia_severidad: "enorme", evidencia_tipo: "selfie", pagina: "abc" },
      { canViewPersonal: true, period: PERIOD },
    )
    expect(filters.stateSlug).toBeUndefined()
    expect(filters.operationalStatus).toBeUndefined()
    expect(filters.performanceUnit).toBeUndefined()
    expect(filters.anomalySeverity).toBeUndefined()
    expect(filters.evidenceKind).toBeUndefined()
    expect(page).toBe(1)
  })
})

describe("filtros que llegan a una Server Action (exportar)", () => {
  it("vuelve a validar los de valor enumerado y las fechas", () => {
    const clean = sanitizeFuelLogFilters({
      stateSlug: "no-existe" as never, origins: ["qr", "hack"] as never, source: "otra" as never,
      from: "2026-13-xx", to: "2026-10-31", performanceUnit: "mph", operationalStatus: "x", q: "  patente  ",
    })
    expect(clean).toMatchObject({ origins: ["qr"], to: "2026-10-31", q: "patente" })
    expect(clean.stateSlug).toBeUndefined()
    expect(clean.source).toBeUndefined()
    expect(clean.from).toBeUndefined()
    expect(clean.performanceUnit).toBeUndefined()
    expect(clean.operationalStatus).toBeUndefined()
  })

  it("tolera una entrada vacía o rara", () => {
    expect(sanitizeFuelLogFilters(undefined)).toEqual({})
    expect(sanitizeFuelLogFilters(null)).toEqual({})
  })
})

describe("columna «Pendiente»", () => {
  const base = { source: "tae_pwa", statusLabel: "validated", reviewMark: null, reviewFlagged: null, reviewFlagReason: null } as Pick<FuelLogRow, "source" | "statusLabel" | "reviewMark" | "reviewFlagged" | "reviewFlagReason">

  it("una carga limpia no tiene nada pendiente", () => {
    expect(fuelLogPending(base)).toEqual([])
  })

  it("dice el motivo de la marca en palabras, no su código", () => {
    expect(fuelLogPending({ ...base, reviewFlagged: true, reviewFlagReason: "duplicate" })).toEqual([{ kind: "decide", label: "Posible carga duplicada" }])
    expect(fuelLogPending({ ...base, anomalyCount: 1 })).toEqual([{ kind: "case", label: "Caso abierto" }])
    expect(fuelLogPending({ ...base, anomalyCount: 3 })).toEqual([{ kind: "case", label: "3 casos abiertos" }])
    expect(fuelLogPending({ ...base, reviewFlagged: true, reviewFlagReason: "late_entry" })[0]?.label).toBe("Registrada después (fecha pasada)")
    expect(fuelLogPending({ ...base, reviewFlagged: true, reviewFlagReason: null })[0]?.label).toBe("Por decidir")
  })

  it("junta por decidir, con observación y pedido abierto, en ese orden; la observación sólo cuenta en registros en terreno", () => {
    const all = fuelLogPending({ ...base, statusLabel: "observed", reviewFlagged: true, reviewFlagReason: "outlier", reviewMark: true })
    expect(all.map((item) => item.kind)).toEqual(["decide", "observed", "requested"])
    expect(fuelLogPending({ ...base, source: "invoiced", statusLabel: "observed" })).toEqual([])
  })
})
