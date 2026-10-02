// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { readCollapsedActivities, readSavedScroll, rememberScroll, writeCollapsedActivities } from "./workspace-memory"

afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
})

describe("memoria del espacio de trabajo (sessionStorage)", () => {
  it("las actividades plegadas se guardan por matriz, bajo miper:<matrixId>:collapsed", () => {
    writeCollapsedActivities("m1", ["a", "b"])
    expect(sessionStorage.getItem("miper:m1:collapsed")).toBe(JSON.stringify(["a", "b"]))
    expect([...readCollapsedActivities("m1")]).toEqual(["a", "b"])
    // Otra matriz no hereda nada.
    expect(readCollapsedActivities("m2").size).toBe(0)
  })

  it("un valor ilegible o de otra forma se ignora: ninguna actividad plegada", () => {
    sessionStorage.setItem("miper:m1:collapsed", "{no es json")
    expect(readCollapsedActivities("m1").size).toBe(0)
    sessionStorage.setItem("miper:m1:collapsed", JSON.stringify({ a: true }))
    expect(readCollapsedActivities("m1").size).toBe(0)
    sessionStorage.setItem("miper:m1:collapsed", JSON.stringify(["a", 3, null]))
    expect([...readCollapsedActivities("m1")]).toEqual(["a"])
  })

  it("el scroll se guarda por URL completa (ruta y query), bajo miper:scroll:<url>", () => {
    rememberScroll("/prevencion/miper/m1?buscar=cami", 640.4)
    expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?buscar=cami")).toBe("640")
    expect(readSavedScroll("/prevencion/miper/m1?buscar=cami")).toBe(640)
    expect(readSavedScroll("/prevencion/miper/m1")).toBeNull()
  })

  it("un scroll guardado que no es un número no positivo válido no se restaura", () => {
    sessionStorage.setItem("miper:scroll:/x", "abc")
    expect(readSavedScroll("/x")).toBeNull()
    sessionStorage.setItem("miper:scroll:/x", "-20")
    expect(readSavedScroll("/x")).toBeNull()
  })

  it("sin sessionStorage (modo privado, bloqueado) nada falla: se lee vacío y escribir no lanza", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError") })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError") })
    expect(() => writeCollapsedActivities("m1", ["a"])).not.toThrow()
    expect(() => rememberScroll("/x", 10)).not.toThrow()
    expect(readCollapsedActivities("m1").size).toBe(0)
    expect(readSavedScroll("/x")).toBeNull()
  })
})
