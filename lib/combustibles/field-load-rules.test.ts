import { describe, expect, it } from "vitest"
import { parseFieldNumber } from "./field-load-number"
import { suggestSupplyMedium } from "./field-load-media"
import {
  checkLiters,
  checkSealInputs,
  litersLimitFor,
  meterRegressionMessage,
  requiredEvidenceKinds,
  resolveLoadedAt,
  trimSeal,
} from "./field-load-rules"

describe("checkSealInputs", () => {
  it("acepta dos sellos reales", () => {
    expect(checkSealInputs({ removedSealNumber: "0504", installedSealNumber: "0505" })).toBeNull()
  })
  it("rechaza sellos de relleno con el valor tal como se escribió", () => {
    const issue = checkSealInputs({ removedSealNumber: "777777", installedSealNumber: "1234" })
    expect(issue?.field).toBe("removedSealNumber")
    expect(issue?.message).toContain("777777")
    expect(checkSealInputs({ removedSealNumber: "123", installedSealNumber: "000000" })?.field).toBe("installedSealNumber")
  })
  it("exige motivo cuando falta un sello", () => {
    expect(checkSealInputs({ removedSealNumber: "", installedSealNumber: "55" })?.field).toBe("noSealReason")
    expect(checkSealInputs({ removedSealNumber: "", installedSealNumber: "55", noSealReason: "Sello cortado" })).toBeNull()
  })
})

describe("checkLiters y capacidad", () => {
  it("rechaza litros en cero o negativos", () => {
    expect(checkLiters(0, 100)?.field).toBe("liters")
    expect(checkLiters(-5, null)?.field).toBe("liters")
  })
  it("usa la capacidad del estanque y cae a 2.000 L sin ella", () => {
    expect(litersLimitFor(350)).toBe(350)
    expect(litersLimitFor(null)).toBe(2000)
    expect(checkLiters(351, 350)?.message).toContain("capacidad del estanque")
    expect(checkLiters(350, 350)).toBeNull()
    expect(checkLiters(2001, null)).not.toBeNull()
    expect(checkLiters(3000, 5000)).toBeNull()
  })
})

describe("resolveLoadedAt (S-5)", () => {
  const now = Date.parse("2026-10-21T12:00:00.000Z")
  it("en línea sella la hora del servidor e ignora la del dispositivo", () => {
    const result = resolveLoadedAt({ offline: false, capturedAt: "2026-10-20T08:00:00.000Z" }, now)
    expect(result).toEqual({ ok: true, loadedAt: "2026-10-21T12:00:00.000Z", source: "server" })
  })
  it("desde la cola conserva la hora de captura dentro de la ventana", () => {
    const result = resolveLoadedAt({ offline: true, capturedAt: "2026-10-20T08:00:00.000Z" }, now)
    expect(result).toEqual({ ok: true, loadedAt: "2026-10-20T08:00:00.000Z", source: "device_offline" })
  })
  it("rechaza capturas fuera de 30 días atrás o 15 minutos adelante", () => {
    expect(resolveLoadedAt({ offline: true, capturedAt: "2026-09-01T00:00:00.000Z" }, now).ok).toBe(false)
    expect(resolveLoadedAt({ offline: true, capturedAt: "2026-10-21T12:30:00.000Z" }, now).ok).toBe(false)
  })
})

describe("fotos exigidas (D-9)", () => {
  it("odómetro y litros siempre; cada sello solo si tiene número", () => {
    expect(requiredEvidenceKinds({ removedSealNumber: "", installedSealNumber: "" })).toEqual(["odometer", "liter_meter"])
    expect(requiredEvidenceKinds({ removedSealNumber: "55", installedSealNumber: "" })).toEqual(["odometer", "liter_meter", "removed_seal"])
    expect(requiredEvidenceKinds({ removedSealNumber: "55", installedSealNumber: "56" })).toHaveLength(4)
  })
  it("trimSeal conserva ceros a la izquierda", () => {
    expect(trimSeal(" 0504 ")).toBe("0504")
    expect(trimSeal("  ")).toBeNull()
  })
})

describe("mensajes y números", () => {
  it("el rechazo por retroceso incluye la lectura anterior en es-CL y la salida para el operador", () => {
    const message = meterRegressionMessage(120_000, 125_430.5)
    expect(message).toContain("125.430,5")
    expect(message).toContain("supervisor")
  })
  it("parseFieldNumber acepta coma o punto decimal y separador de miles con coma", () => {
    expect(parseFieldNumber("101,5")).toBe(101.5)
    expect(parseFieldNumber("101.5")).toBe(101.5)
    expect(parseFieldNumber("12.345,6")).toBe(12345.6)
    expect(parseFieldNumber("abc")).toBeNull()
    expect(parseFieldNumber("")).toBeNull()
    expect(parseFieldNumber("1.2.3")).toBeNull()
  })
})

describe("suggestSupplyMedium", () => {
  const media = [{ id: "a", name: "TCT" }, { id: "b", name: "CMPC" }, { id: "c", name: "Aramco" }]
  it("preselecciona solo cuando es evidente", () => {
    expect(suggestSupplyMedium("Surtidor CMPC", media)).toBe("b")
    expect(suggestSupplyMedium("Surtidor principal", media)).toBeNull()
    expect(suggestSupplyMedium("Surtidor", [{ id: "x", name: "Único" }])).toBe("x")
    expect(suggestSupplyMedium(null, media)).toBeNull()
  })
})
