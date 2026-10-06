import { describe, expect, it } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import {
  buildStageTabs,
  exportStatusesFor,
  requestStageSql,
  splitStageFilter,
  stageFilterSql,
} from "./request-stage"

const dialect = new PgDialect()

describe("etapas de la lista de Solicitudes", () => {
  it("separa claves de etapa de estados crudos (enlaces antiguos del tablero)", () => {
    expect(splitStageFilter(["compra", "draft", "cerradas"])).toEqual({
      stages: ["compra", "cerradas"],
      statuses: ["draft"],
    })
  })

  it("sin etapas no agrega predicado", () => {
    expect(stageFilterSql([])).toBeUndefined()
  })

  it("el CASE distingue compra de recepción por el estado de los ítems, sin parámetros", () => {
    const { sql: text, params } = dialect.sqlToQuery(requestStageSql)
    expect(params).toEqual([])
    expect(text).toContain("'approved', 'pending_purchase', 'in_purchase_order'")
    expect(text).toMatch(/then 'compra'/)
    expect(text).toMatch(/else 'recepcion'/)
  })

  it("el exportador recibe estados de solicitud equivalentes", () => {
    expect(exportStatusesFor(["cerradas"])).toEqual(["closed", "rejected", "cancelled"])
    expect(exportStatusesFor(["draft"])).toEqual(["draft"])
  })

  it("arma las pestañas con contador y 'Todas' suma todo", () => {
    const tabs = buildStageTabs({ borrador: 1, aprobacion: 2, compra: 3, recepcion: 4, cerradas: 5 })
    expect(tabs.map((t) => t.label)).toEqual(["Todas", "Borrador", "En aprobación", "En compra", "En recepción", "Cerradas"])
    expect(tabs[0]!.count).toBe(15)
    expect(tabs.find((t) => t.value === "compra")!.count).toBe(3)
  })
})
