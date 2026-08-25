import { describe, expect, it } from "vitest"
import { parseFeedbackListParams } from "@/lib/services/feedback-list-query"

describe("parseFeedbackListParams", () => {
  it("keeps the supported filters and trims the search term", () => {
    expect(parseFeedbackListParams({
      q: "  recepción pendiente  ",
      estado: "en_progreso",
      tipo: "bug",
      prioridad: "alta",
      sla: "overdue",
    })).toEqual({
      q: "recepción pendiente",
      estado: "en_progreso",
      tipo: "bug",
      priority: "alta",
      sla: "overdue",
    })
  })

  it("drops malformed, repeated and oversized URL values", () => {
    expect(parseFeedbackListParams({
      q: ["primero", "segundo"],
      estado: "desconocido",
      tipo: "incidente",
      prioridad: "urgente",
      sla: "mañana",
    })).toEqual({ q: "" })
  })
})
