import { describe, expect, it } from "vitest"
import { resolveAddDataKind } from "./add-data-kind"

const allowed = [
  { kind: "facturas", allowed: true },
  { kind: "telemetria", allowed: true },
  { kind: "surtidor", allowed: false },
  { kind: "planilla", allowed: true },
] as const

describe("resolveAddDataKind", () => {
  it("abre el importador que se pide cuando la persona puede usarlo", () => {
    expect(resolveAddDataKind("facturas", allowed)).toBe("facturas")
    expect(resolveAddDataKind("telemetria", allowed)).toBe("telemetria")
  })

  it("no abre un importador sin permiso: la URL no lo concede", () => {
    expect(resolveAddDataKind("surtidor", allowed)).toBeNull()
  })

  it("ignora un valor ausente, desconocido o repetido", () => {
    expect(resolveAddDataKind(undefined, allowed)).toBeNull()
    expect(resolveAddDataKind("otra", allowed)).toBeNull()
    expect(resolveAddDataKind(["facturas", "telemetria"], allowed)).toBeNull()
  })

  it("los importadores con pantalla propia (planilla, tarjeta, sellos) no se abren por aquí", () => {
    expect(resolveAddDataKind("planilla", allowed)).toBeNull()
    expect(resolveAddDataKind("sellos", allowed)).toBeNull()
  })
})
