// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { PartsNoteEvent } from "@/lib/services/mantencion/parts/types"
import { EVENT_KIND_TEXT, eventActionText, NotePeopleLine } from "./note-people-line"

afterEach(cleanup)

const event = (overrides: Partial<PartsNoteEvent> = {}): PartsNoteEvent => ({
  id: "e-x", kind: "transicion", fromStatus: "enviada", toStatus: "aceptada", reason: null, actorName: "Ana Pérez", itemDescription: null,
  createdAt: "2026-11-21T09:30:00.000Z", ...overrides,
})
const line = () => screen.getByText(/^Pide:/)

describe("NotePeopleLine", () => {
  it("con usuario: quién pide, la última acción, quién la hizo y cuándo (hora de Chile, en un <time>)", () => {
    render(<NotePeopleLine requestedByName="Javier Roa" lastEvent={event()} />)
    expect(line().textContent).toBe("Pide: Javier Roa · Última acción: Pasó a «Aceptada» por Ana Pérez · 21-11-2026 06:30")
    expect(line().querySelector("time")?.getAttribute("datetime")).toBe("2026-11-21T09:30:00.000Z")
  })

  it("importada, sin usuario: dice el solicitante que trajo el archivo; y la alta dice «Nota creada»", () => {
    render(<NotePeopleLine requestedByName="Luis Campos (CHOME-123)" lastEvent={event({ kind: "creada", fromStatus: null, toStatus: "enviada", actorName: null })} />)
    expect(line().textContent).toMatch(/^Pide: Luis Campos \(CHOME-123\) · Última acción: Nota creada por el sistema · 21-11-2026 06:30$/)
  })

  it("evento automático (una llegada, la recepción): «el sistema»", () => {
    render(<NotePeopleLine requestedByName="Javier Roa" lastEvent={event({ fromStatus: "en_compra", toStatus: "recibida_parcial", actorName: null })} />)
    expect(line().textContent).toBe("Pide: Javier Roa · Última acción: Pasó a «Recibida parcial» por el sistema · 21-11-2026 06:30")
  })

  it("sin eventos sólo queda quién pide; sin nombre, un guion", () => {
    render(<NotePeopleLine requestedByName="Javier Roa" lastEvent={null} />)
    expect(line().textContent).toBe("Pide: Javier Roa")
    cleanup()
    render(<NotePeopleLine requestedByName="  " lastEvent={null} />)
    expect(line().textContent).toBe("Pide: —")
  })

  it("la acción de cada tipo de evento usa los mismos rótulos del historial", () => {
    expect(eventActionText(event({ kind: "creada", fromStatus: null, toStatus: "enviada" }))).toBe(EVENT_KIND_TEXT.creada)
    expect(eventActionText(event({ kind: "migrada", fromStatus: null, toStatus: "en_compra" }))).toBe(EVENT_KIND_TEXT.migrada)
    expect(eventActionText(event({ toStatus: "anulada" }))).toBe("Pasó a «Anulada»")
  })
})
