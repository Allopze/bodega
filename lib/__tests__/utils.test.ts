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

describe("formatDate()", () => {
  it("formats a Date object to DD-MM-YYYY", () => {
    const d = new Date(2026, 0, 15) // Jan 15, 2026
    expect(formatDate(d)).toBe("15-01-2026")
  })

  it("formats a plain YYYY-MM-DD string without timezone shift", () => {
    // Plain date strings are parsed as local date (midnight local)
    expect(formatDate("2026-03-01")).toBe("01-03-2026")
  })

  it("formats a timestamp number", () => {
    const ts = new Date(2026, 11, 25).getTime()
    expect(formatDate(ts)).toBe("25-12-2026")
  })
})

describe("formatDateTime()", () => {
  it("includes hours and minutes", () => {
    const d = new Date(2026, 0, 15, 14, 30)
    expect(formatDateTime(d)).toBe("15-01-2026 14:30")
  })

  it("pads single-digit hours and minutes", () => {
    const d = new Date(2026, 0, 1, 9, 5)
    expect(formatDateTime(d)).toBe("01-01-2026 09:05")
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
