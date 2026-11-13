import { describe, expect, it } from "vitest"
import {
  compareInboxRows,
  inboxDueDate,
  inboxRowKey,
  parseInboxRowKey,
  type FuelInboxRow,
} from "./types"

const row = (key: string, dueDate: string, waitingSince: string): Pick<FuelInboxRow, "key" | "dueDate" | "waitingSince"> => ({ key, dueDate, waitingSince })

describe("fecha límite de la bandeja", () => {
  it("es el último día del mes del dato", () => {
    expect(inboxDueDate("2026-10")).toBe("2026-10-31")
    expect(inboxDueDate("2026-02")).toBe("2026-02-28")
    expect(inboxDueDate("2028-02")).toBe("2028-02-29")
    expect(inboxDueDate("2026-12")).toBe("2026-12-31")
  })

  it("detectado dentro del mes de su dato, sigue siendo el fin de ese mes", () => {
    expect(inboxDueDate("2026-11", "2026-11-13T15:00:00.000Z")).toBe("2026-11-30")
    expect(inboxDueDate("2026-11", "2026-11-01T03:30:00.000Z")).toBe("2026-11-30")
  })

  it("detectado con el mes ya cerrado, vence a la detección + 7 días", () => {
    expect(inboxDueDate("2026-01", "2026-11-13T15:00:00.000Z")).toBe("2026-11-20")
    expect(inboxDueDate("2026-10", "2026-11-28T15:00:00.000Z")).toBe("2026-12-05")
    expect(inboxDueDate("2026-12", "2027-01-02T15:00:00.000Z")).toBe("2027-01-09")
  })

  it("el día de detección se mide en hora de Chile, no en UTC", () => {
    // 2026-11-01 01:00 UTC es el 31 de octubre a las 22:00 en Chile: todavía dentro de octubre.
    expect(inboxDueDate("2026-10", "2026-11-01T01:00:00.000Z")).toBe("2026-10-31")
    // 2026-11-01 04:00 UTC ya es el 1 de noviembre en Chile (UTC-3): octubre cerró.
    expect(inboxDueDate("2026-10", "2026-11-01T04:00:00.000Z")).toBe("2026-11-08")
  })

  it("una detección ilegible o ausente cae al fin de mes", () => {
    expect(inboxDueDate("2026-01", null)).toBe("2026-01-31")
    expect(inboxDueDate("2026-01", "no-es-una-fecha")).toBe("2026-01-31")
  })
})

describe("orden de la bandeja", () => {
  it("lo que vence primero va primero", () => {
    const rows = [
      row("carga:c", "2026-10-31", "2026-10-01T00:00:00.000Z"),
      row("caso:a", "2026-09-30", "2026-10-20T00:00:00.000Z"),
      row("pedido:b", "2026-10-31", "2026-10-02T00:00:00.000Z"),
    ]
    expect(rows.sort(compareInboxRows).map((entry) => entry.key)).toEqual(["caso:a", "carga:c", "pedido:b"])
  })

  it("a igual fecha límite, lo que lleva más tiempo esperando va primero", () => {
    const rows = [
      row("carga:nueva", "2026-10-31", "2026-10-25T10:00:00.000Z"),
      row("patente:vieja", "2026-10-31", "2026-10-05T10:00:00.000Z"),
    ]
    expect(rows.sort(compareInboxRows).map((entry) => entry.key)).toEqual(["patente:vieja", "carga:nueva"])
  })

  it("es estable: dos filas idénticas se desempatan por clave, siempre igual", () => {
    const rows = [
      row("carga:b", "2026-10-31", "2026-10-05T10:00:00.000Z"),
      row("carga:a", "2026-10-31", "2026-10-05T10:00:00.000Z"),
    ]
    expect(rows.sort(compareInboxRows).map((entry) => entry.key)).toEqual(["carga:a", "carga:b"])
    expect(rows.reverse().sort(compareInboxRows).map((entry) => entry.key)).toEqual(["carga:a", "carga:b"])
  })

  it("un caso histórico detectado tarde va después de la carga del mes que vence antes", () => {
    const rows = [
      { key: "caso:enero", dueDate: inboxDueDate("2026-01", "2026-11-28T15:00:00.000Z"), waitingSince: "2026-11-28T15:00:00.000Z" },
      { key: "carga:noviembre", dueDate: inboxDueDate("2026-11", "2026-11-05T15:00:00.000Z"), waitingSince: "2026-11-05T15:00:00.000Z" },
    ]
    expect(rows.sort(compareInboxRows).map((entry) => entry.key)).toEqual(["carga:noviembre", "caso:enero"])
  })

  it("lo vencido de un mes anterior va antes que lo del mes en curso", () => {
    const rows = [row("carga:oct", "2026-10-31", "2026-10-10T00:00:00.000Z"), row("carga:sep", "2026-09-30", "2026-10-28T00:00:00.000Z")]
    expect(rows.sort(compareInboxRows)[0]!.key).toBe("carga:sep")
  })
})

describe("clave de una fila", () => {
  it("se arma y se vuelve a leer, también con ids que traen dos puntos (patentes)", () => {
    expect(inboxRowKey("carga", "abc")).toBe("carga:abc")
    expect(parseInboxRowKey("carga:abc")).toEqual({ kind: "carga", id: "abc" })
    expect(parseInboxRowKey("patente:tarjeta:lote-1:HXJT21")).toEqual({ kind: "patente", id: "tarjeta:lote-1:HXJT21" })
  })

  it("rechaza lo que no es una clave", () => {
    expect(parseInboxRowKey(undefined)).toBeNull()
    expect(parseInboxRowKey("")).toBeNull()
    expect(parseInboxRowKey("sin-dos-puntos")).toBeNull()
    expect(parseInboxRowKey("inventado:1")).toBeNull()
    expect(parseInboxRowKey("carga:")).toBeNull()
  })
})
