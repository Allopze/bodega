import { describe, expect, it } from "vitest"
import {
  TICKET_SLA_HOURS,
  computeTicketDueAt,
  ticketSlaStage,
} from "@/lib/services/ti/ticket-sla"

/**
 * TIT-001 (auditoría 2026-09-14): la prioridad de un ticket TI no gobernaba
 * ningún plazo —era un rótulo para ordenar la lista—. Estas pruebas fijan que
 * la escala sea la misma que ya aplica el módulo de Soporte (única política de
 * plazos declarada en la plataforma) y que un ticket sin plazo no se invente
 * uno retroactivo.
 */
describe("SLA de tickets TI (TIT-001)", () => {
  it("usa la misma escala por prioridad que el módulo de Soporte", () => {
    expect(TICKET_SLA_HOURS).toEqual({ critica: 24, alta: 48, normal: 120, baja: 240 })
  })

  it("un ticket crítico vence mucho antes que uno bajo", () => {
    const desde = "2026-09-14T00:00:00.000Z"
    expect(computeTicketDueAt("critica", desde)).toBe("2026-09-15T00:00:00.000Z")
    expect(computeTicketDueAt("baja", desde)).toBe("2026-09-24T00:00:00.000Z")
    // Antes, ambos compartían la misma y única señal: la alerta plana del
    // quinto día sin actualización.
    expect(computeTicketDueAt("critica", desde)).not.toBe(computeTicketDueAt("baja", desde))
  })

  it("una prioridad desconocida cae en 'normal' en vez de quedarse sin plazo", () => {
    const desde = "2026-09-14T00:00:00.000Z"
    expect(computeTicketDueAt("inventada", desde)).toBe(computeTicketDueAt("normal", desde))
  })

  it("clasifica el tramo del compromiso y no inventa plazo donde no lo hay", () => {
    const ahora = new Date("2026-09-14T12:00:00.000Z")
    expect(ticketSlaStage("2026-09-14T11:00:00.000Z", ahora)).toBe("overdue")
    expect(ticketSlaStage("2026-09-15T06:00:00.000Z", ahora)).toBe("due_soon")
    expect(ticketSlaStage("2026-09-20T00:00:00.000Z", ahora)).toBe("on_track")
    // Ticket anterior a la migración: no tiene compromiso, y decirlo es más
    // honesto que fabricarle uno.
    expect(ticketSlaStage(null, ahora)).toBeNull()
  })
})
