import { describe, expect, it } from "vitest"
import { parseFeedbackListParams } from "@/lib/services/feedback-list-query"

describe("parseFeedbackListParams", () => {
  it("keeps the supported filters and trims the search term", () => {
    expect(parseFeedbackListParams({
      q: "  recepción pendiente  ",
      estado: "en_progreso",
      tipo: "bug",
      prioridad: "alta",
    })).toEqual({
      q: "recepción pendiente",
      estado: "en_progreso",
      tipo: "bug",
      priority: "alta",
    })
  })

  it("drops malformed, repeated and oversized URL values", () => {
    expect(parseFeedbackListParams({
      q: ["primero", "segundo"],
      estado: "desconocido",
      tipo: "incidente",
      prioridad: "urgente",
    })).toEqual({ q: "" })
  })
})
