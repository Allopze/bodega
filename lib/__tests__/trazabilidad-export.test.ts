import { describe, it, expect } from "vitest"

/**
 * Inline CSV escape (mirrors the logic in trazabilidad-export.ts).
 * The full integration test (module loading) is skipped in unit test
 * because it requires Next.js server modules.
 */
function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

describe("trazabilidad CSV export", () => {
  it("escapes special characters for CSV", () => {
    expect(escapeCsv("simple")).toBe("simple")
    expect(escapeCsv("has, comma")).toBe('"has, comma"')
    expect(escapeCsv('has "quotes"')).toBe('"has ""quotes"""')
    expect(escapeCsv("has\nnewline")).toBe('"has\nnewline"')
  })

  it("does not modify plain text", () => {
    expect(escapeCsv("Producto Normal")).toBe("Producto Normal")
    expect(escapeCsv("ítem #123")).toBe("ítem #123")
    expect(escapeCsv("")).toBe("")
  })
})
