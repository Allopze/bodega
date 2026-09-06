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
      "/bodega/trazabilidad?faena=ws-biodiversa&estado=entregado",
    )
  })
})
