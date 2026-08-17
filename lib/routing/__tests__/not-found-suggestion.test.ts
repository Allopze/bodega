import { describe, expect, it } from "vitest"
import { resolveNotFound } from "@/lib/routing/not-found-suggestion"
import type { NavTarget } from "@/components/layout/nav-items"

const target = (label: string, href: string): NavTarget => ({
  label, href, areaLabel: "Operación", iconName: "SquaresFour",
})

const TARGETS: NavTarget[] = [
  target("Inicio", "/dashboard"),
  target("Solicitudes", "/solicitudes"),
  target("Compras", "/compras"),
  target("Bodega", "/bodega"),
  target("MIPER", "/prevencion/miper"),
  target("Evaluaciones", "/prevencion/evaluaciones"),
]

describe("resolveNotFound", () => {
  it("ofrece el listado dueño cuando falla un registro", () => {
    expect(resolveNotFound("/solicitudes/abc-123", TARGETS)).toEqual({
      kind: "record", target: TARGETS[1],
    })
  })

  it("elige el destino más específico en rutas anidadas", () => {
    expect(resolveNotFound("/prevencion/miper/xyz", TARGETS)).toEqual({
      kind: "record", target: TARGETS[4],
    })
  })

  it("no ofrece volver a la misma pantalla que acaba de fallar", () => {
    expect(resolveNotFound("/solicitudes", TARGETS)).toEqual({ kind: "unknown" })
  })

  it("sugiere el módulo parecido ante un typo, con o sin id", () => {
    expect(resolveNotFound("/compars", TARGETS)).toEqual({ kind: "typo", target: TARGETS[2] })
    expect(resolveNotFound("/bodgea/kardex", TARGETS)).toEqual({ kind: "typo", target: TARGETS[3] })
  })

  it("sugiere por etiqueta cuando la ruta no se parece al href", () => {
    expect(resolveNotFound("/inicio", TARGETS)).toEqual({ kind: "typo", target: TARGETS[0] })
  })

  it("sugiere una subruta viva cuando la pedida ya no existe", () => {
    expect(resolveNotFound("/prevencion/inexistente", TARGETS)).toEqual({
      kind: "typo", target: TARGETS[4],
    })
  })

  it("no sugiere nada que el usuario no pueda abrir", () => {
    const sinCompras = TARGETS.filter((t) => t.href !== "/compras")
    expect(resolveNotFound("/compras/abc-123", sinCompras)).toEqual({ kind: "unknown" })
  })

  it("cae a la grilla cuando la ruta no se parece a nada", () => {
    expect(resolveNotFound("/xyzzy/plugh", TARGETS)).toEqual({ kind: "unknown" })
    expect(resolveNotFound("/", TARGETS)).toEqual({ kind: "unknown" })
    expect(resolveNotFound(null, TARGETS)).toEqual({ kind: "unknown" })
  })

  it("ignora query y hash, y tolera mayúsculas y acentos", () => {
    expect(resolveNotFound("/Solicitudes/ABC?tab=items#x", TARGETS)).toEqual({
      kind: "record", target: TARGETS[1],
    })
    expect(resolveNotFound("/bodéga", TARGETS)).toEqual({ kind: "typo", target: TARGETS[3] })
  })
})
