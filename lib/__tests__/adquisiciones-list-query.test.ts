/**
 * lib/__tests__/adquisiciones-list-query.test.ts
 *
 * Tests for the Adquisiciones list filter helpers that power the URL-synced,
 * server-side search & filters.
 */

import { describe, it, expect } from "vitest"
import { purchaseOrders } from "@/db/schema"
import {
  parseListParams,
  textSearchSql,
  statusSql,
  worksiteEqSql,
  periodSql,
} from "@/lib/adquisiciones/list-query"
import type { SQL } from "drizzle-orm"

/** Serializa un SQL de Drizzle a texto plano para aserciones (tests). */
function sqlText(sql: SQL | undefined): string {
  if (!sql) return ""
  const chunks = (sql as { queryChunks?: unknown[] }).queryChunks ?? []
  return chunks
    .map((chunk) => {
      if (typeof chunk === "string") return chunk
      if (chunk == null) return ""
      const c = chunk as { value?: unknown; queryChunks?: unknown[] }
      if ("value" in c) return String(c.value ?? "")
      if (Array.isArray(c.queryChunks)) return sqlText(c as SQL)
      return ""
    })
    .join("")
}

describe("parseListParams", () => {
  it("returns empty defaults when no params are present", () => {
    expect(parseListParams({})).toEqual({ q: "", estados: [], faena: "", proveedor: "", urgencia: "", factura: "", desde: "", hasta: "" })
  })

  it("reads a valid period window and drops malformed bounds", () => {
    expect(parseListParams({ desde: "2026-08-01", hasta: "2026-09-01" })).toMatchObject({ desde: "2026-08-01", hasta: "2026-09-01" })
    expect(parseListParams({ desde: "not-a-date", hasta: "01/08/2026" }).desde).toBe("")
    expect(parseListParams({ desde: "not-a-date", hasta: "01/08/2026" }).hasta).toBe("")
  })

  it("reads the pending-invoice filter", () => {
    expect(parseListParams({ factura: "pendiente" }).factura).toBe("pendiente")
  })

  it("trims the free-text query", () => {
    expect(parseListParams({ q: "  OC-001  " }).q).toBe("OC-001")
  })

  it("splits comma-separated statuses and drops blanks", () => {
    expect(parseListParams({ estado: "sent, ,received" }).estados).toEqual(["sent", "received"])
  })

  it("reads a single status", () => {
    expect(parseListParams({ estado: "draft" }).estados).toEqual(["draft"])
  })

  it("reads the faena id", () => {
    expect(parseListParams({ faena: "ws-1" }).faena).toBe("ws-1")
  })

  it("reads the proveedor id", () => {
    expect(parseListParams({ proveedor: "sup-1" }).proveedor).toBe("sup-1")
  })

  it("uses the first value when a param is an array", () => {
    expect(parseListParams({ q: ["abc", "def"] }).q).toBe("abc")
  })
})

describe("filter SQL builders", () => {
  it("textSearchSql is undefined for empty query", () => {
    expect(textSearchSql("", [purchaseOrders.code])).toBeUndefined()
    expect(textSearchSql("   ", [purchaseOrders.code])).toBeUndefined()
  })

  it("textSearchSql produces a condition for a real query", () => {
    expect(textSearchSql("OC", [purchaseOrders.code])).toBeDefined()
  })

  it("statusSql is undefined when no statuses are selected", () => {
    expect(statusSql(purchaseOrders.status, [])).toBeUndefined()
  })

  it("statusSql produces a condition when statuses are selected", () => {
    expect(statusSql(purchaseOrders.status, ["sent"])).toBeDefined()
  })

  it("worksiteEqSql is undefined when faena is empty", () => {
    expect(worksiteEqSql(purchaseOrders.worksiteId, "")).toBeUndefined()
  })

  it("worksiteEqSql produces a condition when faena is set", () => {
    expect(worksiteEqSql(purchaseOrders.worksiteId, "ws-1")).toBeDefined()
  })

  it("periodSql is undefined when no bounds are given", () => {
    expect(periodSql(purchaseOrders.issuedAt, "", "")).toBeUndefined()
  })

  it("periodSql treats hasta as INCLUSIVE: upper bound becomes the next day", () => {
    // off-by-one §3.3: una OC emitida el día `hasta` debe entrar en el drill-down.
    const sql = periodSql(purchaseOrders.issuedAt, "2026-08-01", "2026-08-31")
    const text = sqlText(sql)
    expect(text).toContain("2026-08-01") // desde inclusivo
    expect(text).toContain("2026-09-01") // límite exclusivo = día siguiente
    expect(text).not.toContain("2026-08-31") // nunca un cierre en el último día
  })
})
