import { describe, expect, it } from "vitest"
import { checkReading, currentReading, daysBetween, detectJump, JUMP_LIMITS, readingBounds } from "../readings"
import { equipmentStatus } from "../status"
import type { MantReading } from "../types"

const reading = (value: number, date: string, source = "MP-BIO-0001"): MantReading => ({ value, date, source })

describe("daysBetween", () => {
  it("cuenta días calendario sin husos horarios", () => {
    expect(daysBetween("2026-03-01", "2026-03-08")).toBe(7)
    expect(daysBetween("2026-03-08", "2026-03-01")).toBe(-7)
    expect(daysBetween("2026-03-01", "2026-03-01")).toBe(0)
  })

  it("no se altera por el cambio de hora de Chile (septiembre y abril)", () => {
    expect(daysBetween("2026-09-01", "2026-10-01")).toBe(30)
    expect(daysBetween("2026-04-01", "2026-05-01")).toBe(30)
  })
})

describe("regla 1 · lectura vigente", () => {
  it("es la del registro con mayor fecha de trabajo, no la de mayor valor ni la última ingresada", () => {
    const readings = [reading(100, "2026-01-01"), reading(250, "2026-03-01"), reading(180, "2026-02-01")]
    expect(currentReading(readings, reading(10, "2025-12-01", "Lectura inicial"))?.value).toBe(250)
  })

  it("sin registros, es la lectura inicial de la ficha", () => {
    const initial = reading(5_000, "2026-01-15", "Lectura inicial")
    expect(currentReading([], initial)).toBe(initial)
  })

  it("sin registros ni lectura inicial no hay lectura", () => {
    expect(currentReading([], null)).toBeNull()
  })

  it("con registros, la inicial deja de contar aunque sea mayor", () => {
    expect(currentReading([reading(400, "2026-02-01")], reading(500, "2026-01-01", "Lectura inicial"))?.value).toBe(400)
  })

  it("dos registros del mismo día: gana la lectura mayor", () => {
    expect(currentReading([reading(900, "2026-05-02"), reading(950, "2026-05-02")], null)?.value).toBe(950)
  })
})

describe("regla 13 · los anulados no cuentan", () => {
  // La consulta del servidor sólo entrega registros vigentes (`fleet.ts`); aquí se verifica el efecto:
  // sin el registro anulado, la lectura y el estado vuelven a lo que había antes.
  it("la lectura vuelve a la anterior al sacar el registro anulado", () => {
    const vigentes = [reading(1_000, "2026-01-10")]
    const conAnulado = [...vigentes, reading(9_999, "2026-02-10")]
    expect(currentReading(conAnulado, null)?.value).toBe(9_999)
    expect(currentReading(vigentes, null)?.value).toBe(1_000)
  })

  it("el estado se recalcula sin la preventiva anulada", () => {
    const intervals = [10_000, 20_000]
    const p1 = { reading: 10_000, date: "2026-01-10", intervalValue: 10_000 }
    const p2 = { reading: 20_000, date: "2026-06-01", intervalValue: 20_000 }
    const correctiva = reading(20_500, "2026-06-05")
    const base = { retired: false, intervals, initial: null }

    // Con la preventiva de 20.000 km vigente, la próxima toca a los 30.000 km.
    const antes = equipmentStatus({ ...base, readings: [correctiva, reading(p2.reading, p2.date), reading(p1.reading, p1.date)], lastPreventive: p2 })
    expect(antes).toMatchObject({ state: "al_dia", nextReading: 30_000, remaining: 9_500 })

    // Anulada, desaparece su lectura y su preventiva: la última vuelve a ser la de 10.000 km y el equipo queda vencido.
    const despues = equipmentStatus({ ...base, readings: [correctiva, reading(p1.reading, p1.date)], lastPreventive: p1 })
    expect(despues).toMatchObject({ state: "vencida", nextReading: 20_000, remaining: -500 })
  })
})

describe("readingBounds", () => {
  it("la anterior incluye el mismo día; la siguiente es estrictamente posterior", () => {
    const readings = [reading(100, "2026-01-10"), reading(200, "2026-02-10"), reading(300, "2026-03-10")]
    const { previous, next } = readingBounds(readings, null, "2026-02-10")
    expect(previous?.value).toBe(200)
    expect(next?.value).toBe(300)
  })

  it("la inicial hace de anterior cuando no hay registros antes", () => {
    const initial = reading(50, "2026-01-01", "Lectura inicial")
    expect(readingBounds([reading(100, "2026-02-01")], initial, "2026-01-15").previous).toBe(initial)
  })
})

describe("regla 2 · validación de lectura con fecha", () => {
  const readings = [reading(1_000, "2026-01-10", "MP-BIO-0001"), reading(3_000, "2026-03-20", "MP-BIO-0002")]

  it("sin lecturas previas acepta cualquier valor", () => {
    expect(checkReading({ value: 12, workDate: "2026-05-01", unit: "km", readings: [], initial: null })).toMatchObject({ ok: true, previous: null, jump: null })
  })

  it("acepta una lectura entre la anterior y la posterior", () => {
    const result = checkReading({ value: 2_000, workDate: "2026-02-15", unit: "km", readings, initial: null })
    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.previous?.value).toBe(1_000)
  })

  it("acepta una lectura igual a la anterior y también igual a la posterior", () => {
    expect(checkReading({ value: 1_000, workDate: "2026-02-15", unit: "km", readings, initial: null }).ok).toBe(true)
    expect(checkReading({ value: 3_000, workDate: "2026-02-15", unit: "km", readings, initial: null }).ok).toBe(true)
  })

  it("rechaza una lectura menor que la anterior y dice cuál y de qué fecha", () => {
    const result = checkReading({ value: 900, workDate: "2026-02-15", unit: "km", readings, initial: null })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.conflict.value).toBe(1_000)
      expect(result.message).toContain("menor")
      expect(result.message).toContain("1.000 km")
      expect(result.message).toContain("10-01-2026")
      expect(result.message).toContain("MP-BIO-0001")
    }
  })

  it("rechaza una lectura mayor que una registrada después y dice cuál y de qué fecha", () => {
    const result = checkReading({ value: 3_500, workDate: "2026-02-15", unit: "km", readings, initial: null })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.conflict.value).toBe(3_000)
      expect(result.message).toContain("mayor")
      expect(result.message).toContain("3.000 km")
      expect(result.message).toContain("20-03-2026")
      expect(result.message).toContain("después")
    }
  })

  it("una lectura de ese mismo día cuenta como anterior", () => {
    const result = checkReading({ value: 2_999, workDate: "2026-03-20", unit: "km", readings, initial: null })
    expect(result.ok).toBe(false)
  })

  it("usa la lectura inicial como anterior y respeta la unidad en el mensaje", () => {
    const result = checkReading({ value: 100, workDate: "2026-02-01", unit: "h", readings: [], initial: reading(120, "2026-01-01", "Lectura inicial") })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("120 h")
  })

  it("devuelve además el salto de la regla 3 cuando la lectura es válida", () => {
    const result = checkReading({ value: 363_000 + 40_000, workDate: "2026-06-02", unit: "km", readings: [reading(40_000, "2026-06-01")], initial: null })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.jump?.question).toBe("Son 363.000 km más que la última vez. ¿Está bien?")
  })
})

describe("regla 3 · salto de lectura", () => {
  const prev = reading(10_000, "2026-06-01")

  it("expone los umbrales de la especificación", () => {
    expect(JUMP_LIMITS).toEqual({ km: { absolute: 5_000, perDay: 1_500 }, h: { absolute: 300, perDay: 24 } })
  })

  it("sin lectura anterior no hay salto", () => {
    expect(detectJump(null, 999_999, "2026-06-02", "km")).toBeNull()
  })

  it("una lectura igual o menor no es salto (de eso se ocupa la regla 2)", () => {
    expect(detectJump(prev, 10_000, "2026-06-30", "km")).toBeNull()
    expect(detectJump(prev, 9_000, "2026-06-30", "km")).toBeNull()
  })

  it("km: 5.000 km de aumento en el plazo no es salto, 5.001 sí", () => {
    expect(detectJump(prev, 15_000, "2026-06-30", "km")).toBeNull()
    expect(detectJump(prev, 15_001, "2026-06-30", "km")?.delta).toBe(5_001)
  })

  it("h: 300 h de aumento no es salto, 301 sí", () => {
    const horas = reading(1_000, "2026-06-01")
    expect(detectJump(horas, 1_300, "2026-08-01", "h")).toBeNull()
    expect(detectJump(horas, 1_301, "2026-08-01", "h")?.delta).toBe(301)
  })

  it("km por día: 1.500 km/día no es salto, 1.501 sí aunque el total sea chico", () => {
    expect(detectJump(prev, 11_500, "2026-06-02", "km")).toBeNull()
    expect(detectJump(prev, 11_501, "2026-06-02", "km")?.delta).toBe(1_501)
    // Dos días: el máximo sube a 3.000.
    expect(detectJump(prev, 13_000, "2026-06-03", "km")).toBeNull()
    expect(detectJump(prev, 13_001, "2026-06-03", "km")).not.toBeNull()
  })

  it("h por día: 24 h/día no es salto, 25 sí", () => {
    const horas = reading(1_000, "2026-06-01")
    expect(detectJump(horas, 1_024, "2026-06-02", "h")).toBeNull()
    expect(detectJump(horas, 1_025, "2026-06-02", "h")).not.toBeNull()
  })

  it("el mismo día cuenta como un día", () => {
    expect(detectJump(prev, 11_500, "2026-06-01", "km")).toBeNull()
    expect(detectJump(prev, 11_501, "2026-06-01", "km")).not.toBeNull()
  })

  it("la pregunta nombra el aumento con separador de miles y la unidad", () => {
    expect(detectJump(reading(40_000, "2026-06-01"), 403_000, "2026-06-10", "km")?.question)
      .toBe("Son 363.000 km más que la última vez. ¿Está bien?")
    expect(detectJump(reading(1_000, "2026-06-01"), 1_400, "2026-06-02", "h")?.question)
      .toBe("Son 400 h más que la última vez. ¿Está bien?")
  })
})
