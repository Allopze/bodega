import { describe, expect, it } from "vitest"
import { attentionClearText, buildFieldAttentionStats, isAttentionClear } from "./cargas-attention"
import { parseCargasSearchParams } from "./fuel-log-params"
import { parseFuelLoadState } from "./fuel-log-shared"
import { FUEL_PATHS } from "./routes"

const ATTENTION = { toValidate: 12, observed: 3, sealIncomplete: 5, photosIncomplete: 7 }
const NONE = { toValidate: 0, observed: 0, sealIncomplete: 0, photosIncomplete: 0 }

function paramsOf(href: string | undefined): URLSearchParams {
  return new URL(href ?? "", "http://localhost").searchParams
}

describe("buildFieldAttentionStats: la tira de señales de terreno", () => {
  it("son cuatro celdas, con estas etiquetas y en este orden", () => {
    const stats = buildFieldAttentionStats(ATTENTION, {})
    expect(stats.map((stat) => stat.label)).toEqual(["Por validar", "Con observación", "Sello incompleto", "Menos de 4 fotos"])
    expect(new Set(stats.map((stat) => stat.key)).size).toBe(4)
  })

  it("una cifra con algo que mirar es un número naranja que lleva a su filtro", () => {
    const stats = buildFieldAttentionStats(ATTENTION, {})
    expect(stats.map((stat) => stat.value)).toEqual([12, 3, 5, 7])
    for (const stat of stats) {
      expect(stat.tone).toBe("signal")
      expect(stat.valueKind ?? "number").toBe("number")
      expect(stat.href).toBeTruthy()
    }
  })

  it("cada celda aplica el parámetro de URL de su filtro", () => {
    const [porValidar, conObservacion, sello, fotos] = buildFieldAttentionStats(ATTENTION, {})
    expect(new URL(porValidar!.href!, "http://localhost").pathname).toBe(FUEL_PATHS.cargas)
    expect(Object.fromEntries(paramsOf(porValidar!.href))).toEqual({ estado: "por-validar" })
    expect(Object.fromEntries(paramsOf(conObservacion!.href))).toEqual({ estado: "con-observacion" })
    expect(Object.fromEntries(paramsOf(sello!.href))).toEqual({ sello: "faltante" })
    expect(Object.fromEntries(paramsOf(fotos!.href))).toEqual({ evidencia: "faltante" })
  })

  it("en cero dice «Ninguna», como texto y sin enlace ni color", () => {
    const stats = buildFieldAttentionStats(NONE, { periodo: "2026-10" })
    for (const stat of stats) {
      expect(stat.value).toBe("Ninguna")
      expect(stat.valueKind).toBe("text")
      expect(stat.href).toBeUndefined()
      expect(stat.tone).toBeUndefined()
    }
  })

  it("cada celda decide por su propia cifra: una en cero no apaga a las demás", () => {
    const stats = buildFieldAttentionStats({ toValidate: 0, observed: 4, sealIncomplete: 0, photosIncomplete: 1 }, {})
    expect(stats.map((stat) => [stat.label, stat.value, Boolean(stat.href)])).toEqual([
      ["Por validar", "Ninguna", false],
      ["Con observación", 4, true],
      ["Sello incompleto", "Ninguna", false],
      ["Menos de 4 fotos", 1, true],
    ])
  })

  it("los enlaces conservan el período, la faena, la búsqueda y «cómo llegó» de la URL actual, y sueltan la página", () => {
    const current = { periodo: "2026-10", faena: "w-1", q: "CA-14", como: "qr,app", pagina: "4", page: "4" }
    for (const stat of buildFieldAttentionStats(ATTENTION, current)) {
      const params = paramsOf(stat.href)
      expect(params.get("periodo")).toBe("2026-10")
      expect(params.get("faena")).toBe("w-1")
      expect(params.get("q")).toBe("CA-14")
      expect(params.get("como")).toBe("qr,app")
      expect(params.has("pagina")).toBe(false)
      expect(params.has("page")).toBe(false)
    }
  })

  it("las dos celdas de estado se reemplazan entre sí; las de sello y fotos se suman al estado activo", () => {
    const current = { estado: "validada", faena: "w-1" }
    const [porValidar, conObservacion, sello, fotos] = buildFieldAttentionStats(ATTENTION, current)
    expect(paramsOf(porValidar!.href).getAll("estado")).toEqual(["por-validar"])
    expect(paramsOf(conObservacion!.href).getAll("estado")).toEqual(["con-observacion"])
    expect(Object.fromEntries(paramsOf(sello!.href))).toEqual({ estado: "validada", faena: "w-1", sello: "faltante" })
    expect(Object.fromEntries(paramsOf(fotos!.href))).toEqual({ estado: "validada", faena: "w-1", evidencia: "faltante" })
  })

  it("el enlace usa el mismo valor de `estado` que entiende el filtro de la lista", () => {
    // Si un slug cambiara en el catálogo, la celda llevaría a una lista sin filtrar (un `estado` desconocido se descarta).
    const [porValidar, conObservacion] = buildFieldAttentionStats(ATTENTION, {})
    expect(parseFuelLoadState(paramsOf(porValidar!.href).get("estado"))).toBe("por-validar")
    expect(parseFuelLoadState(paramsOf(conObservacion!.href).get("estado"))).toBe("con-observacion")
  })

  it("el enlace de sello y el de fotos son los valores que `parseCargasSearchParams` convierte en filtro", () => {
    const period = { from: "2026-10-01", to: "2026-10-31" }
    const [, , sello, fotos] = buildFieldAttentionStats(ATTENTION, {})
    const fromSello = parseCargasSearchParams(Object.fromEntries(paramsOf(sello!.href)), { canViewPersonal: false, period })
    const fromFotos = parseCargasSearchParams(Object.fromEntries(paramsOf(fotos!.href)), { canViewPersonal: false, period })
    expect(fromSello.filters.sealIncomplete).toBe(true)
    expect(fromSello.filters.photosIncomplete).toBeUndefined()
    expect(fromFotos.filters.photosIncomplete).toBe(true)
    expect(fromFotos.filters.sealIncomplete).toBeUndefined()
  })
})

describe("la línea de «todo despejado» (UX-13)", () => {
  it("sólo cuando las cuatro señales están en cero", () => {
    expect(isAttentionClear(NONE)).toBe(true)
    expect(isAttentionClear(ATTENTION)).toBe(false)
    for (const key of ["toValidate", "observed", "sealIncomplete", "photosIncomplete"] as const) {
      expect(isAttentionClear({ ...NONE, [key]: 1 })).toBe(false)
    }
  })

  it("nombra el período que ya resuelve la página, con su «en»", () => {
    expect(attentionClearText("noviembre")).toBe("Nada por validar, observar ni completar en noviembre")
    expect(attentionClearText("la semana del 26 de octubre")).toBe("Nada por validar, observar ni completar en la semana del 26 de octubre")
    expect(attentionClearText("2026")).toBe("Nada por validar, observar ni completar en 2026")
  })

  it("no afirma «nada pendiente» si la lista muestra cargas con algo abierto: las nombra", () => {
    expect(attentionClearText("noviembre", 9)).toBe("Nada por validar ni completar en noviembre; 9 cargas con algo pendiente")
    expect(attentionClearText("noviembre", 1)).toBe("Nada por validar ni completar en noviembre; 1 carga con algo pendiente")
    expect(attentionClearText("noviembre", 0)).toBe("Nada por validar, observar ni completar en noviembre")
  })
})
