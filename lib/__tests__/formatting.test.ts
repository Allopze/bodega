import { describe, expect, it } from "vitest"
import {
  formatCLP,
  formatDate,
  formatDateDisplay,
  formatDateSafe,
  formatDateTime,
  formatFileSize,
  formatQty,
} from "@/lib/utils"

describe("formatting helpers", () => {
  it("formats plain ISO dates without shifting the day by timezone", () => {
    expect(formatDate("2026-06-11")).toBe("11-06-2026")
  })

  it("formats datetimes without locale-dependent AM/PM whitespace", () => {
    expect(formatDateTime("2026-06-10T21:14:00.000Z")).toMatch(
      /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/,
    )
  })
})

// ── Snapshots de formato por dominio (auditoría UI/UX §4.4) ─────────────────
// Congelan la salida del contrato compartido de fecha, hora, cantidad y
// tamaño: cualquier cambio de formato aparece aquí como fallo de snapshot.

describe("formato · contrato compartido (§4.4)", () => {
  describe("fecha", () => {
    it("congela formatDate", () => {
      expect(formatDate("2026-06-11")).toMatchInlineSnapshot(`"11-06-2026"`)
    })

    it("congela formatDateDisplay (alias SST)", () => {
      expect(formatDateDisplay("2026-06-15")).toMatchInlineSnapshot(`"15-06-2026"`)
    })

    it("congela formatDateSafe con valores ausentes", () => {
      expect(formatDateSafe(null)).toMatchInlineSnapshot(`"—"`)
      expect(formatDateSafe(undefined)).toMatchInlineSnapshot(`"—"`)
      expect(formatDateSafe("")).toMatchInlineSnapshot(`"—"`)
    })

    it("congela formatDateSafe con timestamps completos", () => {
      expect(formatDateSafe("2026-06-11T15:30:00")).toMatchInlineSnapshot(`"11-06-2026"`)
    })

    it("congela formatDateSafe con entrada no parseable", () => {
      expect(formatDateSafe("no es una fecha")).toMatchInlineSnapshot(`"—"`)
    })
  })

  describe("hora", () => {
    it("congela formatDateTime con zona horaria explícita", () => {
      expect(formatDateTime("2026-06-11T15:30:00-04:00")).toMatchInlineSnapshot(
        `"11-06-2026 15:30"`,
      )
    })

    it("congela formatDateTime con fecha de calendario (sin hora)", () => {
      expect(formatDateTime("2026-06-11")).toMatchInlineSnapshot(`"11-06-2026 00:00"`)
    })
  })

  describe("cantidad", () => {
    it("congela formatQty con separadores chilenos", () => {
      expect(formatQty(1250)).toMatchInlineSnapshot(`"1.250"`)
    })

    it("congela formatQty con unidad concordada", () => {
      expect(formatQty(1, "unidad")).toMatchInlineSnapshot(`"1 unidad"`)
      expect(formatQty(5, "unidad")).toMatchInlineSnapshot(`"5 unidades"`)
    })

    it("no pluraliza abreviaturas de unidad", () => {
      expect(formatQty(3, "kg")).toMatchInlineSnapshot(`"3 kg"`)
    })
  })

  describe("tamaño", () => {
    it("congela formatFileSize por escalas", () => {
      expect(formatFileSize(512)).toMatchInlineSnapshot(`"512 B"`)
      expect(formatFileSize(2048)).toMatchInlineSnapshot(`"2 KB"`)
      expect(formatFileSize(3 * 1024 * 1024)).toMatchInlineSnapshot(`"3 MB"`)
    })

    it("congela formatFileSize con valor ausente", () => {
      expect(formatFileSize(null)).toMatchInlineSnapshot(`"—"`)
    })
  })

  describe("moneda", () => {
    it("congela formatCLP", () => {
      expect(formatCLP(1500000)).toMatchInlineSnapshot(`"$1.500.000"`)
    })

    // I-01 (auditoría 2026-08-05): SUM(NUMERIC) llega como string del driver;
    // antes cualquier string —incluso "0"— se mostraba como "—".
    it("acepta agregados string del driver", () => {
      expect(formatCLP("230000")).toBe("$230.000")
      expect(formatCLP("0")).toBe("$0")
      expect(formatCLP("no-numérico")).toBe("—")
      expect(formatCLP("")).toBe("—")
    })
  })
})
