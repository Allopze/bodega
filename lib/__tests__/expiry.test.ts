import { describe, expect, it } from "vitest"
import {
  civilDaysBetween,
  compareExpiryUrgency,
  EXPIRY_STATE_LABEL,
  EXPIRY_STATE_VARIANT,
  expiryRelativeText,
  expiryState,
} from "@/lib/expiry"
import { todayInChile } from "@/lib/utils"

/**
 * Una sola lógica de «¿está vencido?» para flota, licencias y mantención. Las
 * fechas son civiles y `today` lo pasa el llamador: la función no le pregunta a
 * UTC qué día es hoy.
 */

const TODAY = "2026-09-14"
const WARNING = 30

describe("civilDaysBetween", () => {
  it("cuenta días civiles, positivos hacia adelante y negativos hacia atrás", () => {
    expect(civilDaysBetween("2026-09-14", "2026-09-14")).toBe(0)
    expect(civilDaysBetween("2026-09-14", "2026-09-15")).toBe(1)
    expect(civilDaysBetween("2026-09-14", "2026-09-13")).toBe(-1)
    expect(civilDaysBetween("2026-09-14", "2026-10-14")).toBe(30)
  })

  it("no lo mueven el cambio de hora ni el año bisiesto", () => {
    // 2028 es bisiesto: febrero tiene 29 días.
    expect(civilDaysBetween("2028-02-28", "2028-03-01")).toBe(2)
    expect(civilDaysBetween("2027-02-28", "2027-03-01")).toBe(1)
    // Fin de la hora de verano chilena (abril) y cambio de septiembre.
    expect(civilDaysBetween("2026-04-03", "2026-04-06")).toBe(3)
    expect(civilDaysBetween("2026-09-04", "2026-09-07")).toBe(3)
  })
})

describe("expiryState", () => {
  it("sin fecha no hay estado que calcular", () => {
    for (const empty of [null, undefined, ""]) {
      expect(expiryState(empty, TODAY, WARNING)).toEqual({ state: "sin_fecha", days: null, expiresAt: null })
    }
  })

  it("vence hoy sigue sirviendo hoy: por vencer con 0 días, no vencido", () => {
    expect(expiryState(TODAY, TODAY, WARNING)).toEqual({ state: "por_vencer", days: 0, expiresAt: TODAY })
  })

  it("vencido es estrictamente anterior a hoy", () => {
    expect(expiryState("2026-09-13", TODAY, WARNING)).toEqual({ state: "vencido", days: -1, expiresAt: "2026-09-13" })
    expect(expiryState("2025-09-14", TODAY, WARNING).state).toBe("vencido")
  })

  it("el borde de la ventana: warningDays días es por vencer, un día más ya es vigente", () => {
    expect(expiryState("2026-10-14", TODAY, WARNING)).toMatchObject({ state: "por_vencer", days: 30 })
    expect(expiryState("2026-10-15", TODAY, WARNING)).toMatchObject({ state: "vigente", days: 31 })
  })

  it("respeta una ventana distinta (el ajuste de flota es configurable)", () => {
    expect(expiryState("2026-10-14", TODAY, 7).state).toBe("vigente")
    expect(expiryState("2026-09-21", TODAY, 7).state).toBe("por_vencer")
    expect(expiryState("2026-09-22", TODAY, 7).state).toBe("vigente")
  })

  it("el día es el de Chile, no el de UTC", () => {
    // 03:30 UTC del 15 de junio son las 23:30 del 14 en Chile (UTC-4 en invierno).
    const lateInChile = new Date("2026-06-15T03:30:00.000Z")
    expect(todayInChile(lateInChile)).toBe("2026-06-14")
    expect(expiryState("2026-06-14", todayInChile(lateInChile), WARNING)).toMatchObject({ state: "por_vencer", days: 0 })
    // Medido contra el día UTC habría salido vencido.
    expect(expiryState("2026-06-14", "2026-06-15", WARNING).state).toBe("vencido")
  })
})

describe("expiryRelativeText", () => {
  const text = (expiresAt: string | null, warningDays = WARNING) =>
    expiryRelativeText(expiryState(expiresAt, TODAY, warningDays), warningDays)

  it("sin fecha no hay frase", () => {
    expect(text(null)).toBeNull()
  })

  it("hoy y mañana, sin contar días", () => {
    expect(text(TODAY)).toBe("vence hoy")
    expect(text("2026-09-15")).toBe("vence mañana")
  })

  it("dentro de la ventana cuenta los días, con plural correcto", () => {
    expect(text("2026-09-16")).toBe("vence en 2 días")
    expect(text("2026-09-26")).toBe("vence en 12 días")
    expect(text("2026-10-14")).toBe("vence en 30 días")
  })

  it("más allá de la ventana da la fecha, no «vence en 329 días»", () => {
    expect(text("2026-10-15")).toBe("vence el 15-10-2026")
    expect(text("2027-09-30")).toBe("vence el 30-09-2027")
  })

  it("lo vencido dice hace cuánto, en singular y plural", () => {
    expect(text("2026-09-13")).toBe("venció hace 1 día")
    expect(text("2026-09-11")).toBe("venció hace 3 días")
    expect(text("2025-09-14")).toBe("venció hace 365 días")
  })
})

describe("compareExpiryUrgency", () => {
  const state = (expiresAt: string | null) => expiryState(expiresAt, TODAY, WARNING)

  it("lo vencido más antiguo primero, después lo más próximo, al final lo sin fecha", () => {
    const sorted = [state(null), state("2026-10-01"), state("2026-09-01"), state("2026-09-10"), state("2026-09-14")]
      .sort(compareExpiryUrgency)
      .map((entry) => entry.expiresAt)
    expect(sorted).toEqual(["2026-09-01", "2026-09-10", "2026-09-14", "2026-10-01", null])
  })

  it("dos sin fecha empatan", () => {
    expect(compareExpiryUrgency(state(null), state(null))).toBe(0)
  })
})

describe("rótulos y variantes", () => {
  it("cada estado tiene rótulo y tono, y sólo lo vencido es peligro", () => {
    expect(EXPIRY_STATE_LABEL).toEqual({ vigente: "Vigente", por_vencer: "Por vencer", vencido: "Vencido", sin_fecha: "Sin fecha" })
    expect(EXPIRY_STATE_VARIANT).toEqual({ vigente: "success", por_vencer: "warning", vencido: "danger", sin_fecha: "neutral" })
  })
})
