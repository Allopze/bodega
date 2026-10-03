// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { beforeForwardNavigation, clearFichaDraft, readCollapsedActivities, readFichaDraft, readSavedScroll, rememberScroll, revealActivity, writeCollapsedActivities, writeFichaDraft } from "./workspace-memory"

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

  it("revealActivity despliega sólo esa actividad y no escribe si ya estaba abierta (Resumen, Fase B)", () => {
    writeCollapsedActivities("m1", ["a", "b"])
    revealActivity("m1", "a")
    expect([...readCollapsedActivities("m1")]).toEqual(["b"])
    const setItem = vi.spyOn(Storage.prototype, "setItem")
    revealActivity("m1", "zzz")
    expect(setItem).not.toHaveBeenCalled()
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
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("SecurityError") })
    expect(() => writeCollapsedActivities("m1", ["a"])).not.toThrow()
    expect(() => rememberScroll("/x", 10)).not.toThrow()
    expect(readCollapsedActivities("m1").size).toBe(0)
    expect(readSavedScroll("/x")).toBeNull()
    expect(() => beforeForwardNavigation("/x?tarea=k")).not.toThrow()
    expect(() => writeFichaDraft("m1", 1, { a: 1 })).not.toThrow()
    expect(() => clearFichaDraft("m1", 1)).not.toThrow()
    expect(readFichaDraft("m1", 1)).toBeNull()
  })

  it("el borrador de la ficha se guarda por MIPER y versión, bajo miper:ficha:<matrixId>:<version>", () => {
    writeFichaDraft("m1", 3, { iperCode: "RE-04-B" })
    expect(sessionStorage.getItem("miper:ficha:m1:3")).toBe(JSON.stringify({ iperCode: "RE-04-B" }))
    expect(readFichaDraft("m1", 3)).toEqual({ iperCode: "RE-04-B" })
    // Otra versión (alguien guardó la ficha después) no lo ve.
    expect(readFichaDraft("m1", 4)).toBeNull()
    clearFichaDraft("m1", 3)
    expect(readFichaDraft("m1", 3)).toBeNull()
  })

  it("un borrador ilegible o que no es un objeto no se ofrece", () => {
    sessionStorage.setItem("miper:ficha:m1:1", "{roto")
    expect(readFichaDraft("m1", 1)).toBeNull()
    sessionStorage.setItem("miper:ficha:m1:1", JSON.stringify(["a"]))
    expect(readFichaDraft("m1", 1)).toBeNull()
  })

  it("antes de navegar hacia adelante guarda el scroll de la vista que se deja y olvida el del destino", () => {
    window.history.replaceState(null, "", "/prevencion/miper/m1?buscar=cami")
    sessionStorage.setItem("miper:scroll:/prevencion/miper/m1?tarea=k", "300")
    const well = document.createElement("div")
    well.setAttribute("data-shell-scroll", "")
    well.scrollTop = 480
    document.body.appendChild(well)
    try {
      beforeForwardNavigation("/prevencion/miper/m1?tarea=k")
      expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?buscar=cami")).toBe("480")
      expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?tarea=k")).toBeNull()
    } finally {
      well.remove()
    }
  })

  it("el destino se reconoce aunque venga absoluto: la clave es ruta + query, como currentViewUrl()", () => {
    sessionStorage.setItem("miper:scroll:/prevencion/miper/m1?tarea=k", "300")
    beforeForwardNavigation(`${window.location.origin}/prevencion/miper/m1?tarea=k`)
    expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?tarea=k")).toBeNull()
  })

  it("fuera del shell (sin pozo) sólo olvida el destino", () => {
    window.history.replaceState(null, "", "/prevencion/miper/m1")
    sessionStorage.setItem("miper:scroll:/prevencion/miper/m1?tarea=k", "300")
    beforeForwardNavigation("/prevencion/miper/m1?tarea=k")
    expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1?tarea=k")).toBeNull()
    expect(sessionStorage.getItem("miper:scroll:/prevencion/miper/m1")).toBeNull()
  })
})
