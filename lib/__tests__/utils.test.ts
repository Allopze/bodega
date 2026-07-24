/**
 * Unit tests for lib/utils.ts — formatting, string, and HTML helpers.
 */

import { describe, it, expect } from "vitest"
import {
  cn,
  formatCLP,
  formatQty,
  toCode,
  formatDate,
  formatDateTime,
  toTitleCase,
  getInitials,
  escapeHtml,
  matchesQuery,
} from "@/lib/utils"

describe("cn()", () => {
  it("merges Tailwind classes without conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4")
  })

  it("returns empty string for no inputs", () => {
    expect(cn()).toBe("")
  })

  it("handles conditional classes", () => {
    expect(cn("text-red-500", false && "text-blue-500")).toBe("text-red-500")
  })
})

describe("formatCLP()", () => {
  it("formats zero", () => {
    expect(formatCLP(0)).toBe("$0")
  })

  it("formats a positive amount with thousand separators", () => {
    expect(formatCLP(1500000)).toBe("$1.500.000")
  })

  it("formats a negative amount", () => {
    expect(formatCLP(-5000)).toBe("$-5.000")
  })

  it("rounds to whole pesos (no decimals)", () => {
    const formatted = formatCLP(999.6)
    expect(formatted).not.toContain(",")
  })
})

describe("formatQty()", () => {
  it("formats a number with thousand separators", () => {
    expect(formatQty(1250)).toBe("1.250")
  })

  it("appends unit when provided", () => {
    expect(formatQty(5, "unidad")).toBe("5 unidad")
  })

  it("formats zero without unit", () => {
    expect(formatQty(0)).toBe("0")
  })
})

describe("toCode()", () => {
  it("uppercases and removes accents", () => {
    expect(toCode("Santiago")).toBe("SANTIAGO")
  })

  it("strips diacritics from accented chars", () => {
    expect(toCode("Dirección")).toBe("DIRECCION")
  })

  it("replaces spaces and special chars with hyphens", () => {
    expect(toCode("Faena Norte")).toBe("FAENA-NORTE")
  })

  it("collapses multiple hyphens", () => {
    expect(toCode("a  b   c")).toBe("A-B-C")
  })

  it("trims leading/trailing hyphens", () => {
    expect(toCode("  hello  ")).toBe("HELLO")
  })
})

// Los instantes se escriben en UTC a propósito: el resultado esperado es el
// mismo corra el proceso en UTC (contenedor de producción), en Santiago (la
// máquina del desarrollador) o en cualquier otra zona.
describe("formatDate()", () => {
  it("formats a Date object to DD-MM-YYYY in Chilean time", () => {
    // 17:30Z = 14:30 en Santiago (verano, UTC-3)
    expect(formatDate(new Date("2026-01-15T17:30:00Z"))).toBe("15-01-2026")
  })

  it("formats a plain YYYY-MM-DD string without timezone shift", () => {
    // Una fecha de calendario no es un instante: no se convierte de zona.
    expect(formatDate("2026-03-01")).toBe("01-03-2026")
  })

  it("formats a timestamp number", () => {
    expect(formatDate(Date.parse("2026-12-25T15:00:00Z"))).toBe("25-12-2026")
  })
})

describe("formatDateTime()", () => {
  it("includes hours and minutes", () => {
    expect(formatDateTime(new Date("2026-01-15T17:30:00Z"))).toBe("15-01-2026 14:30")
  })

  it("pads single-digit hours and minutes", () => {
    expect(formatDateTime(new Date("2026-01-01T12:05:00Z"))).toBe("01-01-2026 09:05")
  })

  it("renders midnight as 00:00, not 24:00", () => {
    // es-CL con hour12:false rinde "24:00"; por eso se fija hourCycle h23.
    expect(formatDateTime(new Date("2026-07-23T04:00:00Z"))).toBe("23-07-2026 00:00")
  })

  it("uses the Chilean day, not the UTC day, across the date boundary", () => {
    // 02:00Z del 23 son todavía las 22:00 del 22 en Santiago (invierno, UTC-4).
    expect(formatDateTime(new Date("2026-07-23T02:00:00Z"))).toBe("22-07-2026 22:00")
  })

  it("gives a plain date a midnight time component", () => {
    expect(formatDateTime("2026-03-01")).toBe("01-03-2026 00:00")
  })
})

describe("toTitleCase()", () => {
  it("capitalizes each word", () => {
    expect(toTitleCase("hola mundo")).toBe("Hola Mundo")
  })

  it("lowercases the rest", () => {
    expect(toTitleCase("SANTIAGO")).toBe("Santiago")
  })

  it("handles single word", () => {
    expect(toTitleCase("chome")).toBe("Chome")
  })
})

describe("getInitials()", () => {
  it("returns first and last initial for a full name", () => {
    expect(getInitials("Juan Pérez")).toBe("JP")
  })

  it("returns first two chars for a single name", () => {
    expect(getInitials("Ana")).toBe("AN")
  })

  it("returns uppercase initials", () => {
    expect(getInitials("maría garcía")).toBe("MG")
  })

  it("returns empty string for empty input", () => {
    expect(getInitials("")).toBe("")
  })

  it("trims extra whitespace", () => {
    expect(getInitials("  Juan  Pérez  ")).toBe("JP")
  })
})

describe("escapeHtml()", () => {
  it("escapes ampersand", () => {
    expect(escapeHtml("a&b")).toBe("a&amp;b")
  })

  it("escapes angle brackets", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;")
  })

  it("escapes quotes", () => {
    expect(escapeHtml('"hello\'')).toBe("&quot;hello&#039;")
  })

  it("returns clean strings unchanged", () => {
    expect(escapeHtml("Chome Solicitudes")).toBe("Chome Solicitudes")
  })

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("")
  })
})

describe("matchesQuery()", () => {
  it("matches everything when the query is empty", () => {
    expect(matchesQuery("", ["Cemento"])).toBe(true)
    expect(matchesQuery("   ", ["Cemento"])).toBe(true)
  })

  it("matches a case-insensitive substring", () => {
    expect(matchesQuery("cem", ["Cemento Portland"])).toBe(true)
  })

  it("matches accented characters regardless of query accents", () => {
    expect(matchesQuery("direccion", ["Dirección Norte"])).toBe(true)
  })

  it("returns false when no value matches", () => {
    expect(matchesQuery("fierro", ["Cemento", "Portland"])).toBe(false)
  })

  it("skips null/undefined values without throwing", () => {
    expect(matchesQuery("cem", [null, undefined, "Cemento"])).toBe(true)
  })

  it("matches against any of several values", () => {
    expect(matchesQuery("norte", ["Cemento", "Faena Norte"])).toBe(true)
  })
})
