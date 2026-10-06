// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ConsolidatedKpis } from "./consolidated-kpis"

const FILTERS = {
  faena: "ws-biodiversa",
  estado: "",
  categoria: "",
  solicitante: "",
  proveedor: "",
  q: "",
  desde: "",
  hasta: "",
  pendientes: false,
  ocPendiente: false,
}

describe("ConsolidatedKpis", () => {
  it("lleva cada tarjeta a la bandeja operativa de su métrica", () => {
    render(
      <ConsolidatedKpis
        filters={FILTERS}
        kpis={{
          openRequests: 6,
          pendingPurchase: 2,
          awaitingSupplier: 5,
          inOffice: 1,
          inFaena: 2,
          partiallyDelivered: 1,
          fullyDelivered: 3,
        }}
      />,
    )

    expect(screen.getByRole("link", { name: /Solicitudes abiertas/ })).toHaveAttribute(
      "href",
      "/solicitudes?faena=ws-biodiversa&estado=draft%2Csubmitted%2Cin_review%2Cpartially_approved%2Capproved%2Cin_purchasing",
    )
    expect(screen.getByRole("link", { name: /Pendientes de compra/ })).toHaveAttribute(
      "href",
      "/compras?faena=ws-biodiversa",
    )
    expect(screen.getByRole("link", { name: /Esperando proveedor/ })).toHaveAttribute(
      "href",
      "/recepcion?faena=ws-biodiversa",
    )
    expect(screen.getByRole("link", { name: /Cerrados \/ entregados/ })).toHaveAttribute(
      "href",
      "/seguimiento?faena=ws-biodiversa&estado=entregado",
    )
  })

  it("en 'todas las faenas' no pasa un id de faena inexistente a las otras bandejas", () => {
    render(
      <ConsolidatedKpis
        filters={{ ...FILTERS, faena: "todas" }}
        kpis={{
          openRequests: 1,
          pendingPurchase: 1,
          awaitingSupplier: 1,
          inOffice: 0,
          inFaena: 0,
          partiallyDelivered: 0,
          fullyDelivered: 1,
        }}
      />,
    )

    expect(screen.getByRole("link", { name: /Pendientes de compra/ })).toHaveAttribute("href", "/compras")
    expect(screen.getByRole("link", { name: /Esperando proveedor/ })).toHaveAttribute("href", "/recepcion")
    expect(screen.getByRole("link", { name: /Cerrados \/ entregados/ })).toHaveAttribute(
      "href",
      "/seguimiento?estado=entregado",
    )
  })
})
