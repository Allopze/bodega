import { describe, expect, it } from "vitest"
import { parseFieldNumber } from "./field-load-number"
import { suggestSupplyMedium } from "./field-load-media"
import {
  checkLiters,
  checkPastLoad,
  checkSealInputs,
  isPastLoadNotAllowed,
  isPossibleDuplicateLoad,
  litersLimitFor,
  MAX_PAST_LOAD_DAYS,
  meterAboveNextMessage,
  meterRegressionMessage,
  PastLoadNotAllowed,
  pastLoadWindow,
  PossibleDuplicateLoad,
  possibleDuplicateMessage,
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

describe("carga de otro día (resolveLoadedAt con pastLoad)", () => {
  // 2026-10-21 12:00 UTC = 09:00 del 21 de octubre en Chile (horario de verano, UTC-3).
  const now = Date.parse("2026-10-21T12:00:00.000Z")
  const reason = "Se anotó en papel y no se ingresó a tiempo"

  it("la ventana son 62 días civiles de Chile: desde el 20 de agosto hasta hoy", () => {
    expect(MAX_PAST_LOAD_DAYS).toBe(62)
    expect(pastLoadWindow(now)).toEqual({ earliestDay: "2026-08-20", latestDay: "2026-10-21" })
  })

  it("acepta una fecha pasada, la guarda como `backdated` con su motivo y la hora de Chile convertida a UTC", () => {
    const result = resolveLoadedAt({ pastLoad: { loadedAt: "2026-10-12T14:30", reason } }, now)
    expect(result).toEqual({ ok: true, loadedAt: "2026-10-12T17:30:00.000Z", source: "backdated", backdateReason: reason })
  })

  it("respeta el cambio de horario: en invierno Chile va a UTC-4", () => {
    const result = resolveLoadedAt({ pastLoad: { loadedAt: "2026-08-25T14:30", reason } }, now)
    expect(result).toMatchObject({ ok: true, loadedAt: "2026-08-25T18:30:00.000Z", source: "backdated" })
  })

  it("el día 62 se acepta y el 63 se rechaza, aunque falten minutos para completar las 24 horas", () => {
    expect(resolveLoadedAt({ pastLoad: { loadedAt: "2026-08-20T00:00", reason } }, now).ok).toBe(true)
    const tooOld = resolveLoadedAt({ pastLoad: { loadedAt: "2026-08-19T23:59", reason } }, now)
    expect(tooOld.ok).toBe(false)
    if (!tooOld.ok) {
      expect(tooOld.issue.field).toBe("pastLoadAt")
      expect(tooOld.issue.message).toContain("62 días")
      expect(tooOld.issue.message).toContain("20-08-2026")
    }
  })

  it("rechaza una fecha futura, aunque sea de hoy", () => {
    expect(resolveLoadedAt({ pastLoad: { loadedAt: "2026-10-21T08:59", reason } }, now).ok).toBe(true)
    const future = resolveLoadedAt({ pastLoad: { loadedAt: "2026-10-21T09:01", reason } }, now)
    expect(future.ok).toBe(false)
    if (!future.ok) expect(future.issue.message).toContain("futuras")
    expect(resolveLoadedAt({ pastLoad: { loadedAt: "2026-10-22T08:00", reason } }, now).ok).toBe(false)
  })

  it("rechaza fechas que no existen en el calendario y formatos sueltos", () => {
    for (const loadedAt of ["2026-02-30T10:00", "2026-13-01T10:00", "2026-10-12T25:00", "12-10-2026 14:30", "", "2026-10-12"]) {
      const result = checkPastLoad({ loadedAt, reason }, now)
      expect(result.ok, loadedAt).toBe(false)
    }
  })

  it("el motivo pide palabras: menos de 10 caracteres se rechaza y el límite superior también", () => {
    const short = checkPastLoad({ loadedAt: "2026-10-12T14:30", reason: "olvido" }, now)
    expect(short.ok).toBe(false)
    if (!short.ok) { expect(short.issue.field).toBe("pastLoadReason"); expect(short.issue.message).toContain("10 caracteres") }
    expect(checkPastLoad({ loadedAt: "2026-10-12T14:30", reason: "1234567890" }, now).ok).toBe(true)
    expect(checkPastLoad({ loadedAt: "2026-10-12T14:30", reason: "x".repeat(501) }, now).ok).toBe(false)
    // Los espacios de los bordes no cuentan.
    expect(checkPastLoad({ loadedAt: "2026-10-12T14:30", reason: "   corto   " }, now).ok).toBe(false)
  })

  it("`pastLoad` manda sobre la hora del dispositivo y sobre la del servidor", () => {
    const result = resolveLoadedAt({ offline: true, capturedAt: "2026-10-20T08:00:00.000Z", pastLoad: { loadedAt: "2026-10-12T14:30", reason } }, now)
    expect(result).toMatchObject({ ok: true, source: "backdated", loadedAt: "2026-10-12T17:30:00.000Z" })
  })

  it("sin `pastLoad` el resultado no trae motivo: la carga normal sigue igual", () => {
    expect(resolveLoadedAt({}, now)).toEqual({ ok: true, loadedAt: "2026-10-21T12:00:00.000Z", source: "server" })
    expect(resolveLoadedAt({ pastLoad: null }, now)).toEqual({ ok: true, loadedAt: "2026-10-21T12:00:00.000Z", source: "server" })
  })
})

describe("avisos de la carga de otro día", () => {
  it("la lectura mayor que la siguiente dice cuál es y de cuándo", () => {
    const message = meterAboveNextMessage(125_000, 120_500.5, "2026-10-20T15:00:00.000Z")
    expect(message).toContain("125.000")
    expect(message).toContain("120.500,5")
    expect(message).toContain("20-10-2026 12:00")
  })

  it("la posible duplicada muestra la otra carga y la salida", () => {
    const message = possibleDuplicateMessage({ loadedAt: "2026-10-12T17:25:00.000Z", liters: 120 })
    expect(message).toContain("12-10-2026 14:25")
    expect(message).toContain("120 L")
    expect(message).toContain("registrarla igual")
  })

  it("los rechazos se reconocen por forma, también entre copias del módulo", () => {
    const other = { id: "sub-9", loadedAt: "2026-10-12T17:25:00.000Z", liters: 120, equipment: "CA-14", href: "/x" }
    const duplicate = new PossibleDuplicateLoad(other)
    expect(duplicate.status).toBe(422)
    expect(duplicate.code).toBe("possible_duplicate")
    expect(isPossibleDuplicateLoad(duplicate)).toBe(true)
    expect(isPossibleDuplicateLoad(new Error("otro"))).toBe(false)
    expect(isPastLoadNotAllowed(new PastLoadNotAllowed())).toBe(true)
    expect(new PastLoadNotAllowed().status).toBe(403)
    expect(isPastLoadNotAllowed(duplicate)).toBe(false)
  })
})

describe("fotos exigidas (D-9)", () => {
  it("odómetro y litros siempre; cada sello solo si tiene número", () => {
    expect(requiredEvidenceKinds({ removedSealNumber: "", installedSealNumber: "" })).toEqual(["odometer", "liter_meter"])
    expect(requiredEvidenceKinds({ removedSealNumber: "55", installedSealNumber: "" })).toEqual(["odometer", "liter_meter", "removed_seal"])
    expect(requiredEvidenceKinds({ removedSealNumber: "55", installedSealNumber: "56" })).toHaveLength(4)
  })
  it("una carga de otro día no exige ninguna foto: el detector de evidencia faltante no le abre un caso", () => {
    const stored = { removedSealNumber: "55", installedSealNumber: "56" }
    expect(requiredEvidenceKinds({ ...stored, loadedAtSource: "backdated" })).toEqual([])
    expect(requiredEvidenceKinds({ ...stored, loadedAtSource: "server" })).toHaveLength(4)
    expect(requiredEvidenceKinds({ ...stored, loadedAtSource: null })).toHaveLength(4)
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
