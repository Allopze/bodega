import { describe, expect, it } from "vitest"
import { resolveImportTab } from "./import-tab"

describe("resolveImportTab", () => {
  it("abre el log operacional cuando se pide y el rol puede importarlo", () => {
    expect(resolveImportTab("operaciones", true)).toBe("operaciones")
  })

  it("cae en consumos cuando el rol no puede importar el log operacional", () => {
    expect(resolveImportTab("operaciones", false)).toBe("consumos")
  })

  it("abre consumos sin parámetro, con un valor desconocido o repetido", () => {
    expect(resolveImportTab(undefined, true)).toBe("consumos")
    expect(resolveImportTab("consumos", true)).toBe("consumos")
    expect(resolveImportTab("otra", true)).toBe("consumos")
    expect(resolveImportTab(["operaciones", "consumos"], true)).toBe("consumos")
  })
})
