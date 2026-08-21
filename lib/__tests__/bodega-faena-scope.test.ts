/**
 * lib/__tests__/bodega-faena-scope.test.ts
 *
 * Bodega parte en la bodega propia del usuario. Lo único con lógica en eso es
 * distinguir "no elegí faena" (→ la propia) de "elegí ver todas" (→ ninguna).
 */

import { describe, it, expect } from "vitest"
import { resolveFaena, ALL_WORKSITES } from "@/app/(app)/bodega/faena-scope"

describe("resolveFaena", () => {
  it("sin parámetro muestra la bodega propia", () => {
    expect(resolveFaena("", "ws-propia")).toBe("ws-propia")
  })

  it("el centinela abre todas las faenas visibles", () => {
    expect(resolveFaena(ALL_WORKSITES, "ws-propia")).toBe("")
  })

  it("una faena elegida gana sobre la propia", () => {
    expect(resolveFaena("ws-otra", "ws-propia")).toBe("ws-otra")
  })

  it("sin bodega propia la pantalla sigue mostrando todas", () => {
    expect(resolveFaena("", "")).toBe("")
    expect(resolveFaena(ALL_WORKSITES, "")).toBe("")
  })
})
