// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { ItemLeadTime } from "@/lib/services/analytics-module/lead-time-item"
import { plainDateToDay } from "@/lib/services/analytics-module/lead-time-shape"
import { ItemLeadTimeCard } from "./trazabilidad-item-lead-time"

/** 2026-10-01 (un jueves cualquiera: sólo importa que las fechas se lean como las del calendario chileno). */
const D = plainDateToDay("2026-10-01")

function leadTime(over: Partial<ItemLeadTime["milestones"]> = {}, status = "delivered"): ItemLeadTime {
  return {
    itemId: "it-1",
    status,
    milestones: {
      submittedDay: D, approvedDay: D + 1, issuedDay: D + 3, arrivedDay: D + 9, deliveredDay: D + 10, closedDay: D + 10,
      ...over,
    },
  }
}

const stage = (key: string) => document.querySelector(`[data-stage="${key}"]`) as HTMLElement

describe("ItemLeadTimeCard", () => {
  it("ítem cerrado: la frase, los cuatro tramos con su rango de fechas y sus días, y el tramo más lento marcado con texto", () => {
    render(<ItemLeadTimeCard leadTime={leadTime()} todayDay={D + 100} />)

    expect(screen.getByRole("heading", { name: "Plazos por etapa" })).toBeInTheDocument()
    expect(screen.getByText("Se cerró 10 días después de la solicitud. El tramo más lento fue «Llegada» (6 días).")).toBeInTheDocument()

    const list = screen.getByRole("list", { name: "Días por etapa del ítem" })
    expect(within(list).getAllByRole("listitem")).toHaveLength(4)
    // Fechas con el formato del producto (DD-MM-AAAA), no el del navegador.
    expect(within(stage("arrival")).getByText("04-10-2026 → 10-10-2026")).toBeInTheDocument()
    expect(within(stage("arrival")).getByText("6 días")).toBeInTheDocument()
    expect(within(stage("arrival")).getByText("Más lento")).toBeInTheDocument()
    expect(within(stage("approval")).queryByText("Más lento")).toBeNull()
    expect(screen.getByText("Plazo total (solicitud → cierre):")).toBeInTheDocument()
  })

  it("ítem abierto: el tramo en curso lo dice con palabras y cuenta hasta hoy; los que faltan dicen que aún no llegan", () => {
    const open = leadTime({ arrivedDay: null, deliveredDay: null, closedDay: null }, "purchased")
    render(<ItemLeadTimeCard leadTime={open} todayDay={D + 14} />)

    expect(screen.getByText(/Lleva 14 días desde la solicitud y está en el tramo «Llegada» desde hace 11 días/)).toBeInTheDocument()
    expect(within(stage("arrival")).getByText("Desde 04-10-2026 · en curso")).toBeInTheDocument()
    expect(within(stage("arrival")).getByText("11 días")).toBeInTheDocument()
    expect(within(stage("arrival")).getByText("en curso")).toBeInTheDocument()
    expect(within(stage("delivery")).getByText("Aún no llega a este tramo")).toBeInTheDocument()
    expect(within(stage("delivery")).getByText("—")).toBeInTheDocument()
    expect(screen.getByText("Plazo hasta hoy (solicitud → hoy):")).toBeInTheDocument()
  })

  it("lo que no se midió no se inventa: tramo sin fecha, fechas al revés y tramo que no ocurrió", () => {
    render(<ItemLeadTimeCard leadTime={leadTime({ approvedDay: D + 5, issuedDay: D + 3, deliveredDay: null, closedDay: D + 9 })} todayDay={D + 100} />)

    expect(within(stage("purchase")).getByText(/Fechas fuera de orden/)).toBeInTheDocument()
    expect(within(stage("purchase")).getByText("—")).toBeInTheDocument()
    expect(within(stage("delivery")).getByText("No ocurrió en este ítem")).toBeInTheDocument()
  })

  it("ítem rechazado: sin total ni días, y la frase no dice que «lleva» tiempo", () => {
    const rejected = leadTime({ approvedDay: null, issuedDay: null, arrivedDay: null, deliveredDay: null, closedDay: null }, "rejected")
    render(<ItemLeadTimeCard leadTime={rejected} todayDay={D + 40} />)

    expect(screen.getByText("El ítem se rechazó: no hay plazos que medir después de la solicitud.")).toBeInTheDocument()
    expect(screen.queryByText(/Plazo total|Plazo hasta hoy/)).toBeNull()
    expect(screen.queryByText(/Lleva/)).toBeNull()
  })

  it("si la consulta falló lo dice (no se confunde con «sin plazos»)", () => {
    render(<ItemLeadTimeCard leadTime={null} todayDay={D} />)

    expect(screen.getByText(/No se pudieron calcular los plazos de este ítem/)).toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Días por etapa del ítem" })).toBeNull()
  })

  it("aclara que los días son corridos y qué hito mide cada tramo", () => {
    render(<ItemLeadTimeCard leadTime={leadTime()} todayDay={D + 100} />)

    expect(screen.getByText(/Los días son corridos/)).toBeInTheDocument()
    expect(screen.getByText(/la primera recepción y la primera entrega/)).toBeInTheDocument()
  })
})
