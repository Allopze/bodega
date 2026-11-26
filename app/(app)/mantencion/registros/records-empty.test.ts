import { describe, expect, it } from "vitest"
import { emptyCopy, isSearchOnly } from "./records-empty"

describe("vacío de «Registros firmados» con una búsqueda", () => {
  it("la búsqueda sola dice que no hay un registro con ese folio, código o patente, sin hablar de períodos ni filtros", () => {
    const copy = emptyCopy(undefined, true, true)
    expect(copy.title).toBe("No hay un registro con ese folio, código o patente")
    expect(copy.description).toBeUndefined()
  })

  it("dentro de una pestaña de revisión dice que sólo se buscó ahí: el folio puede estar en otra", () => {
    expect(emptyCopy("pendiente", true, true).description).toBe("Se buscó sólo entre los registros por revisar.")
    expect(emptyCopy("observado", true, true).description).toBe("Se buscó sólo entre los registros observados.")
    expect(emptyCopy("revisado", true, true).description).toBe("Se buscó sólo entre los registros revisados.")
  })

  it("con otros filtros además de la búsqueda, el vacío sigue hablando de filtros", () => {
    expect(emptyCopy(undefined, true, false)).toEqual({ title: "Ningún registro coincide con estos filtros", description: "Prueba con otro período o quita algún filtro." })
    expect(emptyCopy("pendiente", true, false).title).toBe("No hay registros por revisar con estos filtros")
  })

  it("sin filtros, cada pestaña explica qué significa estar vacía", () => {
    expect(emptyCopy("pendiente", false, false).title).toBe("No hay registros por revisar")
    expect(emptyCopy("observado", false, false).title).toBe("No hay registros observados")
    expect(emptyCopy("revisado", false, false).title).toBe("Aún no hay registros revisados")
    expect(emptyCopy(undefined, false, false).title).toBe("Aún no hay registros firmados")
  })
})

describe("isSearchOnly", () => {
  it("es cierto sólo con la búsqueda, con o sin pestaña de revisión", () => {
    expect(isSearchOnly({ equipment: "MP-STF-0147" })).toBe(true)
    expect(isSearchOnly({ equipment: "ka91", review: "pendiente" })).toBe(true)
  })

  it("es falso sin búsqueda o con otro filtro además de ella", () => {
    expect(isSearchOnly({})).toBe(false)
    expect(isSearchOnly({ review: "pendiente" })).toBe(false)
    expect(isSearchOnly({ equipment: "ka91", kind: "C" })).toBe(false)
    expect(isSearchOnly({ equipment: "ka91", from: "2026-11-01" })).toBe(false)
  })
})
