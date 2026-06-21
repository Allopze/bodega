import { describe, it, expect } from "vitest"
import { workerResultView } from "@/lib/ppa/badges"

describe("workerResultView", () => {
  it("permite iniciar cuando fue aprobado automáticamente", () => {
    const v = workerResultView("aprobado_auto")
    expect(v.canStart).toBe(true)
    expect(v.tone).toBe("success")
    expect(v.showReasons).toBe(false)
  })

  it("permite iniciar cuando el responsable autorizó", () => {
    const v = workerResultView("autorizado")
    expect(v.canStart).toBe(true)
    expect(v.tone).toBe("success")
  })

  it("detiene y muestra motivos cuando está detenido", () => {
    const v = workerResultView("detenido")
    expect(v.canStart).toBe(false)
    expect(v.tone).toBe("danger")
    expect(v.showReasons).toBe(true)
    expect(v.title.toLowerCase()).toContain("detenga")
  })

  it("refleja la solicitud de corrección del responsable", () => {
    const v = workerResultView("en_correccion")
    expect(v.canStart).toBe(false)
    expect(v.tone).toBe("warning")
  })

  it("refleja el rechazo del responsable", () => {
    const v = workerResultView("rechazado")
    expect(v.canStart).toBe(false)
    expect(v.tone).toBe("danger")
  })

  it("muestra el caso cerrado en tono neutral", () => {
    const v = workerResultView("cerrado")
    expect(v.canStart).toBe(false)
    expect(v.tone).toBe("neutral")
    expect(v.showReasons).toBe(false)
  })
})
