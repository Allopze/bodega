import { describe, expect, it } from "vitest"
import { responsibleText, workshopText } from "./history-format"

describe("workshopText: días en taller", () => {
  it("dice «1 día» en singular y «N días» en plural, también para cero", () => {
    expect(workshopText({ workshopDays: 1, inWorkshop: false })).toBe("1 día")
    expect(workshopText({ workshopDays: 3, inWorkshop: false })).toBe("3 días")
    expect(workshopText({ workshopDays: 0, inWorkshop: false })).toBe("0 días")
  })

  it("agrega «sigue en taller» sólo cuando el equipo todavía está en el taller", () => {
    expect(workshopText({ workshopDays: 3, inWorkshop: true })).toBe("3 días · sigue en taller")
    expect(workshopText({ workshopDays: 1, inWorkshop: true })).toBe("1 día · sigue en taller")
  })

  it("sin días calculables, dice «En taller» si sigue ahí y «—» si no, sin inventar un cero", () => {
    expect(workshopText({ workshopDays: null, inWorkshop: true })).toBe("En taller")
    expect(workshopText({ workshopDays: null, inWorkshop: false })).toBe("—")
  })
})

describe("responsibleText: responsable del trabajo", () => {
  it("dice «—» cuando el trabajo no informa si fue interno o externo, aunque traiga un nombre", () => {
    expect(responsibleText({ external: null, detail: { responsible: "Taller de prueba" } })).toBe("—")
  })

  it("dice «Interno» cuando el taller es propio", () => {
    expect(responsibleText({ external: false, detail: { responsible: null } })).toBe("Interno")
  })

  it("dice «Externo · nombre» cuando el taller externo informa su nombre", () => {
    expect(responsibleText({ external: true, detail: { responsible: "Taller de prueba" } })).toBe("Externo · Taller de prueba")
  })

  it("dice sólo «Externo» cuando el taller externo no informa nombre", () => {
    expect(responsibleText({ external: true, detail: { responsible: null } })).toBe("Externo")
  })
})
