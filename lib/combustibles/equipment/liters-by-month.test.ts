import { describe, expect, it } from "vitest"
import { fillLitersByMonth, litersMonthKeys, litersWindowLabel, LITERS_BY_MONTH_COUNT } from "./liters-by-month"

describe("claves de los 12 meses de «Litros por mes»", () => {
  it("son 12, terminan en el mes pedido y van de la más antigua a la más reciente", () => {
    const keys = litersMonthKeys("2026-03")
    expect(LITERS_BY_MONTH_COUNT).toBe(12)
    expect(keys).toEqual([
      "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09",
      "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03",
    ])
    expect(keys).toEqual([...keys].sort())
  })

  it("cruza el cambio de año sin saltarse ni repetir un mes", () => {
    const keys = litersMonthKeys("2026-01")
    expect(keys[0]).toBe("2025-02")
    expect(keys.slice(-3)).toEqual(["2025-11", "2025-12", "2026-01"])
    expect(new Set(keys).size).toBe(12)
  })

  it("un mes de 31 días como final no se come febrero ni repite marzo", () => {
    // 31 de marzo − 1 mes no existe como «31 de febrero»: con aritmética de fechas ingenua sale marzo otra vez.
    for (const end of ["2026-03", "2026-05", "2026-07", "2026-08", "2026-10", "2026-12"]) {
      const keys = litersMonthKeys(end)
      expect(new Set(keys).size, `${end} repite un mes`).toBe(12)
      expect(keys.at(-1)).toBe(end)
      // Cada clave es exactamente un mes después de la anterior.
      keys.slice(1).forEach((key, index) => {
        const [year, month] = keys[index]!.split("-").map(Number) as [number, number]
        expect(key, `${end}: tras ${keys[index]}`).toBe(month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`)
      })
    }
    expect(litersMonthKeys("2026-03")).toContain("2026-02")
  })

  it("febrero de un año bisiesto cuenta una vez", () => {
    const keys = litersMonthKeys("2024-03")
    expect(keys).toEqual([
      "2023-04", "2023-05", "2023-06", "2023-07", "2023-08", "2023-09",
      "2023-10", "2023-11", "2023-12", "2024-01", "2024-02", "2024-03",
    ])
  })

  it("acepta otro largo", () => {
    expect(litersMonthKeys("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"])
    expect(litersMonthKeys("2026-02", 1)).toEqual(["2026-02"])
  })
})

describe("litros por mes con ceros", () => {
  it("rellena con cero los meses sin cargas y respeta los que sí tuvieron", () => {
    const filled = fillLitersByMonth("2026-03", [
      { month: "2026-03", liters: 300, loads: 3 },
      { month: "2025-08", liters: 100, loads: 1 },
    ])
    expect(filled).toHaveLength(12)
    expect(filled.map((month) => month.month)).toEqual(litersMonthKeys("2026-03"))
    expect(filled.find((month) => month.month === "2026-03")).toEqual({ month: "2026-03", liters: 300, loads: 3 })
    expect(filled.find((month) => month.month === "2025-08")).toEqual({ month: "2025-08", liters: 100, loads: 1 })
    // Un mes sin cargas es un cero explícito, no un hueco ni un `undefined`.
    expect(filled.find((month) => month.month === "2026-02")).toEqual({ month: "2026-02", liters: 0, loads: 0 })
    expect(filled.filter((month) => month.loads === 0)).toHaveLength(10)
  })

  it("sale en orden ascendente aunque las filas lleguen desordenadas", () => {
    const filled = fillLitersByMonth("2026-03", [
      { month: "2026-03", liters: 5, loads: 1 },
      { month: "2025-04", liters: 7, loads: 1 },
      { month: "2025-12", liters: 9, loads: 2 },
    ])
    const months = filled.map((month) => month.month)
    expect(months).toEqual([...months].sort())
    expect(filled[0]).toEqual({ month: "2025-04", liters: 7, loads: 1 })
    expect(filled.at(-1)).toEqual({ month: "2026-03", liters: 5, loads: 1 })
  })

  it("sin ninguna carga son 12 ceros, no una lista vacía", () => {
    const filled = fillLitersByMonth("2026-03", [])
    expect(filled).toHaveLength(12)
    expect(filled.every((month) => month.liters === 0 && month.loads === 0)).toBe(true)
  })

  it("descarta lo que cae fuera de la ventana: ni antes del primer mes ni después del último", () => {
    const filled = fillLitersByMonth("2026-03", [
      { month: "2025-03", liters: 999, loads: 9 },
      { month: "2026-04", liters: 888, loads: 8 },
      { month: "2026-01", liters: 10, loads: 1 },
    ])
    expect(filled.reduce((sum, month) => sum + month.liters, 0)).toBe(10)
    expect(filled.map((month) => month.month)).not.toContain("2025-03")
    expect(filled.map((month) => month.month)).not.toContain("2026-04")
  })

  it("cruza el cambio de año y el 31 de un mes al terminar en enero", () => {
    const filled = fillLitersByMonth("2026-01", [{ month: "2025-12", liters: 50, loads: 1 }, { month: "2026-01", liters: 20, loads: 1 }])
    expect(filled.map((month) => month.month).slice(-2)).toEqual(["2025-12", "2026-01"])
    expect(filled.slice(-2).map((month) => month.liters)).toEqual([50, 20])
    expect(filled[0]!.month).toBe("2025-02")
  })
})

describe("litersWindowLabel", () => {
  it("con el período en curso son «los últimos 12 meses»", () => {
    expect(litersWindowLabel("2026-10", "en_curso")).toBe("Los últimos 12 meses")
  })

  it("con un período pasado o futuro dice dónde termina la ventana", () => {
    expect(litersWindowLabel("2026-08", "cerrado")).toBe("Los 12 meses hasta agosto de 2026")
    expect(litersWindowLabel("2027-01", "futuro")).toBe("Los 12 meses hasta enero de 2027")
  })

  it("un mes ilegible no inventa una fecha", () => {
    expect(litersWindowLabel("", "cerrado")).toBe("Los últimos 12 meses")
  })
})
