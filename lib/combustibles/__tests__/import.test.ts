import { describe, it, expect } from "vitest"
import { parseFuelExcel } from "../import"
import * as XLSX from "xlsx"

function createTestExcel(rows: Record<string, unknown>[]): ArrayBuffer {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "BASE DE DATOS")
  const wbOut = XLSX.write(wb, { type: "array", bookType: "xlsx" })
  return new Uint8Array(wbOut).buffer as ArrayBuffer
}

describe("parseFuelExcel", () => {
  const validRow = {
    "MES-AÑO": new Date("2026-01-15"),
    "SERVICIO": "TCT",
    "VEHICULO": "CAMION",
    "PROVEEDOR": "COPEC",
    "CLIENTE": "CHOME",
    "FAENA": "FAENA BIODIVERSA",
    "PRODUCTO": "PETROLEO DIESEL",
    "FACTURA": "29533428",
    "LITROS": 9956.51,
    " IEC Fijo": 1041715,
    " IEC Variable": 817517,
    "Base Afecta": 5961897.01,
    "IMPUESTO IEC\n(FIJO + VARIIABLE)": 1859232,
    "IVA (19%)": 1132760.43,
    "TOTAL FACTURA A PAGAR": 8953889.44,
  }

  it("parses a valid row correctly", () => {
    const buffer = createTestExcel([validRow])
    const result = parseFuelExcel(buffer)
    expect(result.loads).toHaveLength(1)
    expect(result.errors).toHaveLength(0)
    expect(result.loads[0]!.serviceType).toBe("TCT")
    expect(result.loads[0]!.vehicle).toBe("CAMION")
    expect(result.loads[0]!.liters).toBe(9956.51)
    expect(result.loads[0]!.totalAmount).toBe(8953889.44)
  })

  it("parses optional odometer and hour meter readings", () => {
    const row = { ...validRow, "KILOMETRAJE": 12500, "HOROMETRO": 440.5 }
    const buffer = createTestExcel([row])
    const result = parseFuelExcel(buffer)
    expect(result.loads).toHaveLength(1)
    expect(result.loads[0]!.odometerReading).toBe(12500)
    expect(result.loads[0]!.hourMeterReading).toBe(440.5)
  })

  it("detects missing required fields", () => {
    const invalidRow = { ...validRow, "VEHICULO": "" }
    const buffer = createTestExcel([invalidRow])
    const result = parseFuelExcel(buffer)
    expect(result.loads).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.field).toBe("VEHICULO")
  })

  it("detects invalid service type", () => {
    const invalidRow = { ...validRow, "SERVICIO": "INVALID" }
    const buffer = createTestExcel([invalidRow])
    const result = parseFuelExcel(buffer)
    expect(result.loads).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.field).toBe("SERVICIO")
  })

  it("detects duplicate receipt numbers", () => {
    const buffer = createTestExcel([validRow, { ...validRow }])
    const result = parseFuelExcel(buffer)
    expect(result.loads).toHaveLength(2)
    expect(result.duplicates).toHaveLength(1)
  })

  it("skips empty rows", () => {
    const buffer = createTestExcel([{}, {}, validRow])
    const result = parseFuelExcel(buffer)
    expect(result.loads).toHaveLength(1)
    expect(result.errors).toHaveLength(0)
  })

  it("handles string dates", () => {
    const row = { ...validRow, "MES-AÑO": "2026-03-15" }
    const buffer = createTestExcel([row])
    const result = parseFuelExcel(buffer)
    expect(result.loads).toHaveLength(1)
    expect(result.loads[0]!.month).toBe("2026-03")
  })

  it("does not shift dates on servers with UTC offset (H11)", () => {
    // A Date at midnight local time: toISOString would give previous day in UTC-X zones.
    // We create the date directly as a JS Date object (as XLSX does with cellDates:true)
    // and verify the parsed loadDate matches the original calendar date.
    const dateWithMidnight = new Date(2026, 0, 15, 0, 0, 0, 0) // Jan 15 at local midnight
    const buffer = createTestExcel([{ ...validRow, "MES-AÑO": dateWithMidnight }])
    const result = parseFuelExcel(buffer)
    expect(result.loads).toHaveLength(1)
    // Should always be 2026-01-15 regardless of server timezone offset
    expect(result.loads[0]!.loadDate).toBe("2026-01-15")
    expect(result.loads[0]!.month).toBe("2026-01")
  })

  it("returns empty for empty file", () => {
    const result = parseFuelExcel(new ArrayBuffer(0))
    expect(result.loads).toHaveLength(0)
  })
})
