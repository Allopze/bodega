import { describe, expect, it } from "vitest"
import { incidentSlaBreached } from "@/lib/prevention/incident-sla"

describe("incidentSlaBreached (Feature B)", () => {
  const base = { type: "accidente", severity: "grave" }

  it("marca excedido cuando un accidente grave se registra > 24h después del evento", () => {
    expect(incidentSlaBreached({
      ...base,
      occurredAt: "2026-07-01T08:00:00.000Z",
      createdAt: "2026-07-02T09:00:00.000Z", // 25h
    })).toBe(true)
  })

  it("no marca excedido dentro de las 24h", () => {
    expect(incidentSlaBreached({
      ...base,
      occurredAt: "2026-07-01T08:00:00.000Z",
      createdAt: "2026-07-01T20:00:00.000Z", // 12h
    })).toBe(false)
  })

  it("no aplica SLA a incidentes que no son accidentes", () => {
    expect(incidentSlaBreached({
      type: "incidente", severity: "grave",
      occurredAt: "2026-07-01T08:00:00.000Z",
      createdAt: "2026-07-10T08:00:00.000Z",
    })).toBe(false)
  })

  it("no aplica SLA a accidentes leves (sin umbral definido)", () => {
    expect(incidentSlaBreached({
      type: "accidente", severity: "leve",
      occurredAt: "2026-07-01T08:00:00.000Z",
      createdAt: "2026-07-10T08:00:00.000Z",
    })).toBe(false)
  })
})
