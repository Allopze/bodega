/**
 * lib/__tests__/operaciones-list-query.test.ts
 *
 * Tests for the Operaciones list filter helpers that power the URL-synced,
 * server-side search & filters.
 */

import { describe, it, expect } from "vitest"
import { purchaseOrders } from "@/db/schema"
import {
  parseListParams,
  textSearchSql,
  statusSql,
  worksiteEqSql,
} from "@/lib/operaciones/list-query"

describe("parseListParams", () => {
  it("returns empty defaults when no params are present", () => {
    expect(parseListParams({})).toEqual({ q: "", estados: [], faena: "", proveedor: "" })
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
})
