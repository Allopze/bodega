/**
 * Unit tests for lib/utils.ts — formatting, string, and HTML helpers.
 */

import { describe, it, expect } from "vitest"
import {
  cn,
  formatCLP,
  todayInChile,
  addDaysToPlainDate,
  subtractBusinessDays,
  DELIVERY_BACKDATE_BUSINESS_DAYS,
  formatFileSize,
  formatQty,
  quantityStep,
  pluralize,
  toCode,
  formatDate,
  formatDateRelative,
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
    // El signo va delante del símbolo (decisión de producto, 2026-08-04):
    // `es-CL` produce "$-5.000" y se antepone a "-$5.000".
    expect(formatCLP(-5000)).toBe("-$5.000")
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

  it("appends unit when provided, agreeing in number", () => {
    expect(formatQty(1, "unidad")).toBe("1 unidad")
    expect(formatQty(5, "unidad")).toBe("5 unidades")
    expect(formatQty(1, "par")).toBe("1 par")
    expect(formatQty(8, "rollo")).toBe("8 rollos")
  })

  it("leaves an unknown unit untouched instead of inventing a plural", () => {
    // Las unidades las administra el usuario: una abreviatura no se pluraliza.
    expect(formatQty(3, "kg")).toBe("3 kg")
    expect(formatQty(3, "m2")).toBe("3 m2")
  })

  it("formats zero without unit", () => {
    expect(formatQty(0)).toBe("0")
  })
})

describe("quantityStep()", () => {
  // El bug que motiva el helper: `min="0.01" step="0.01"` sobre un campo vacío
  // convierte cada clic de la flecha en un centésimo. Seis clics para seis
  // buzos registraron 0,06 en producción, catorce veces.
  it("counts whole units for everything the catálogo usa", () => {
    expect(quantityStep("unidad")).toBe(1)
    expect(quantityStep("par")).toBe(1)
    expect(quantityStep("caja")).toBe(1)
    expect(quantityStep("dosis")).toBe(1)
    expect(quantityStep("servicio")).toBe(1)
  })

  it("allows fractions only for measurable units", () => {
    expect(quantityStep("kg")).toBe(0.01)
    expect(quantityStep("litros")).toBe(0.01)
    expect(quantityStep("m2")).toBe(0.01)
  })

  it("normalises case and whitespace, and defaults to whole units", () => {
    expect(quantityStep(" KG ")).toBe(0.01)
    expect(quantityStep("Unidad")).toBe(1)
    expect(quantityStep(undefined)).toBe(1)
    expect(quantityStep(null)).toBe(1)
    expect(quantityStep("")).toBe(1)
  })
})

describe("pluralize()", () => {
  it("keeps the singular for count 1", () => {
    expect(pluralize(1, "submódulo")).toBe("submódulo")
  })

  it("adds -s to words ending in a vowel", () => {
    expect(pluralize(3, "submódulo")).toBe("submódulos")
    expect(pluralize(2, "faena")).toBe("faenas")
    expect(pluralize(2, "vehículo")).toBe("vehículos")
    expect(pluralize(2, "documento")).toBe("documentos")
  })

  it("adds -es to words ending in a consonant", () => {
    expect(pluralize(2, "actividad")).toBe("actividades")
  })

  it("turns -z into -ces", () => {
    expect(pluralize(2, "lápiz")).toBe("lápices")
  })

  it("turns -ión into -iones", () => {
    expect(pluralize(2, "observación")).toBe("observaciones")
  })

  it("uses the known irregulars", () => {
    expect(pluralize(2, "mes")).toBe("meses")
    expect(pluralize(2, "ítem")).toBe("ítems")
  })

  it("supports forcing an explicit plural (compound phrases)", () => {
    expect(pluralize(1, "ítem seleccionado", "ítems seleccionados")).toBe("ítem seleccionado")
    expect(pluralize(5, "ítem seleccionado", "ítems seleccionados")).toBe("ítems seleccionados")
  })
})

describe("formatFileSize()", () => {
  it("uses Chilean separators and explicit binary units", () => {
    expect(formatFileSize(512)).toBe("512 B")
    expect(formatFileSize(1536)).toBe("1,5 KB")
    expect(formatFileSize(1024 * 1024)).toBe("1 MB")
  })

  it("keeps missing or invalid sizes distinct from an empty file", () => {
    expect(formatFileSize(0)).toBe("0 B")
    expect(formatFileSize(null)).toBe("—")
    expect(formatFileSize(-1)).toBe("—")
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

describe("formatDateRelative()", () => {
  // 03:00Z = 00:00 en Santiago (verano, UTC-3), así que el corte del día chileno
  // cae 3 horas después que el de UTC.
  const now = new Date("2026-01-15T06:00:00Z")

  it("cuenta días civiles chilenos, no horas transcurridas", () => {
    // 03:30Z ya es el 15 en Chile; 02:00Z sigue siendo el 14 a las 23:00, aunque
    // los separen 90 minutos y ambos caigan el día 15 en UTC.
    expect(formatDateRelative(new Date("2026-01-15T03:30:00Z"), now)).toBe("hoy")
    expect(formatDateRelative(new Date("2026-01-15T02:00:00Z"), now)).toBe("ayer")
  })

  it("pluraliza en días para lo que quedó atrás", () => {
    expect(formatDateRelative("2025-12-25", now)).toBe("hace 21 días")
  })

  it("nombra el futuro sin decir 'hace'", () => {
    expect(formatDateRelative("2026-01-16", now)).toBe("mañana")
    expect(formatDateRelative("2026-01-20", now)).toBe("en 5 días")
  })

  it("dice el dato ausente o corrupto en vez de inventarlo", () => {
    expect(formatDateRelative(null, now)).toBe("—")
    expect(formatDateRelative("basura", now)).toBe("—")
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

/**
 * `todayInChile` / `addDaysToPlainDate` existen porque medir "hoy" con
 * `toISOString()` adelanta el día 3–4 horas y marcaba como vencidos documentos
 * de flota y mantenciones todavía vigentes.
 */
describe("todayInChile / addDaysToPlainDate", () => {
  it("devuelve el día civil chileno, no el UTC, en la franja nocturna", () => {
    // 2026-08-08T01:30Z = 2026-08-07 21:30 en Chile (UTC-4).
    expect(todayInChile("2026-08-08T01:30:00Z")).toBe("2026-08-07")
    expect(new Date("2026-08-08T01:30:00Z").toISOString().slice(0, 10)).toBe("2026-08-08")
  })

  it("rellena mes y día con cero a la izquierda", () => {
    expect(todayInChile("2026-01-05T15:00:00Z")).toBe("2026-01-05")
  })

  it("suma días sobre la fecha civil sin que la corra el cambio de hora", () => {
    expect(addDaysToPlainDate("2026-08-31", 1)).toBe("2026-09-01")
    // El cambio de hora chileno de 2026 cae el 6 de septiembre.
    expect(addDaysToPlainDate("2026-09-05", 2)).toBe("2026-09-07")
    expect(addDaysToPlainDate("2026-12-31", 30)).toBe("2027-01-30")
  })
})

/**
 * `subtractBusinessDays` acota cuánto se puede retrofechar una entrega de
 * bodega. Contar días corridos regalaría o quitaría margen según el día de la
 * semana en que se digite: un lunes, 5 corridos llegan al miércoles anterior.
 */
describe("subtractBusinessDays()", () => {
  it("salta el fin de semana al retroceder un día", () => {
    // Lunes 17 → viernes 14, no domingo 16.
    expect(subtractBusinessDays("2026-08-17", 1)).toBe("2026-08-14")
  })

  it("retrocede 5 días hábiles al mismo día de la semana anterior", () => {
    expect(subtractBusinessDays("2026-08-17", DELIVERY_BACKDATE_BUSINESS_DAYS)).toBe("2026-08-10")
    expect(subtractBusinessDays("2026-08-20", DELIVERY_BACKDATE_BUSINESS_DAYS)).toBe("2026-08-13")
  })

  it("cruza el fin de año", () => {
    expect(subtractBusinessDays("2026-01-05", DELIVERY_BACKDATE_BUSINESS_DAYS)).toBe("2025-12-29")
  })

  it("con 0 días es la identidad", () => {
    expect(subtractBusinessDays("2026-08-16", 0)).toBe("2026-08-16")
  })
})
