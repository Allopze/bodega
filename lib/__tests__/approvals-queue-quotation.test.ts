import { describe, expect, it } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"
import { approvalQueueFilter, quotationQueueFilter } from "@/lib/approvals-queue"

const dialect = new PgDialect()
const q = (condition: SQL | undefined) => dialect.sqlToQuery(condition as SQL)

describe("quotationQueueFilter (ADQ-05)", () => {
  it("sin tipos aprobables la cola es vacía", () => {
    expect(q(quotationQueueFilter({ isGlobal: true, worksiteIds: [] }, [])).sql).toBe("false")
  })

  it("filtra por los tipos que el usuario puede aprobar y por ítems por decidir", () => {
    const { sql, params } = q(quotationQueueFilter({ isGlobal: true, worksiteIds: [] }, ["repuestos"]))
    expect(params).toContain("repuestos")
    expect(params).not.toContain("servicios")
    expect(sql).toContain("pending_items.status = 'requested'")
  })

  it("acota por faena cuando el rol no es global, y sin faenas no devuelve nada", () => {
    expect(q(quotationQueueFilter({ isGlobal: false, worksiteIds: ["w1"] }, ["servicios"])).params).toContain("w1")
    expect(q(quotationQueueFilter({ isGlobal: false, worksiteIds: [] }, ["servicios"])).sql).toContain("false")
  })

  it("no cambia el predicado de la cola ítem-a-ítem, que sigue excluyendo estos tipos", () => {
    expect(q(approvalQueueFilter({ isGlobal: true, worksiteIds: [] })).sql).toContain("NOT IN ('repuestos', 'servicios')")
  })
})
