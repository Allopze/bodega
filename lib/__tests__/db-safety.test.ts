import { describe, expect, it } from "vitest"

/**
 * Guard: la suite NUNCA debe apuntar a la base de datos de dev/producción.
 * La BD real se llama `bodega`; los tests deben usar una desechable
 * (p.ej. `bodega_test`) o pglite. Si alguien revierte vitest.config.ts,
 * este test falla antes de que cualquier test mute datos reales.
 */
describe("test database safety", () => {
  it("does not point DATABASE_URL at the dev/prod database", () => {
    const url = process.env.DATABASE_URL ?? ""
    expect(url, "DATABASE_URL apunta a la BD de dev/prod 'bodega'").not.toMatch(/\/bodega(\?|$)/)
  })
})
