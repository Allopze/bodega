// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { OcReceptionCta, pendingReceptionStage } from "./oc-reception-cta"

const base = {
  orderId: "oc-123",
  worksiteName: "Biodiversa",
  canRegisterOffice: true,
  canRegisterFaena: true,
}

describe("OcReceptionCta", () => {
  it("offers the office stage first on a freshly sent via_oficina order", () => {
    render(
      <OcReceptionCta
        {...base}
        status="sent"
        deliveryMode="via_oficina"
        pendingOfficeQuantity={20}
        pendingFaenaQuantity={0}
      />,
    )

    const link = screen.getByRole("link", { name: /registrar llegada a oficina/i })
    expect(link).toHaveAttribute("href", "/recepcion/nueva?oc=oc-123")
    expect(screen.getByText(/20 unidades por llegar a oficina/i)).toBeInTheDocument()
  })

  it("continues in Recepciones when office stock is pending dispatch to faena", () => {
    render(
      <OcReceptionCta
        {...base}
        status="office_received"
        deliveryMode="via_oficina"
        pendingOfficeQuantity={0}
        pendingFaenaQuantity={20}
      />,
    )

    const link = screen.getByRole("link", { name: /continuar en recepciones/i })
    expect(link).toHaveAttribute("href", "/recepcion")
    expect(screen.getByText(/queda pendiente preparar el despacho a faena/i)).toBeInTheDocument()
  })

  it("skips the office stage entirely for a directo_faena order", () => {
    render(
      <OcReceptionCta
        {...base}
        status="sent"
        deliveryMode="directo_faena"
        pendingOfficeQuantity={20}
        pendingFaenaQuantity={20}
      />,
    )

    expect(screen.getByRole("link", { name: /recepcionar en faena/i })).toBeInTheDocument()
    expect(screen.queryByText(/oficina/i)).not.toBeInTheDocument()
  })

  it("does not render when there is nothing left to receive", () => {
    const { container } = render(
      <OcReceptionCta
        {...base}
        status="received"
        deliveryMode="via_oficina"
        pendingOfficeQuantity={0}
        pendingFaenaQuantity={0}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it("names the next step without a link when the stage permission is missing", () => {
    render(
      <OcReceptionCta
        {...base}
        canRegisterFaena={false}
        status="office_received"
        deliveryMode="via_oficina"
        pendingOfficeQuantity={0}
        pendingFaenaQuantity={20}
      />,
    )

    expect(screen.queryByRole("link")).not.toBeInTheDocument()
    expect(screen.getByText(/siguiente paso: preparar el despacho desde recepciones/i)).toBeInTheDocument()
  })
})

describe("pendingReceptionStage", () => {
  it("no reporta etapa pendiente en una OC directo a faena ya recibida", () => {
    // `quantityOfficeReceived` es 0 por diseño en esta vía, así que el saldo de
    // oficina es el total pedido: derivarlo por separado hacía creer que faltaba
    // recibir y degradaba el CTA de factura a secundario.
    expect(pendingReceptionStage({
      status: "received",
      deliveryMode: "directo_faena",
      pendingOfficeQuantity: 5,
      pendingFaenaQuantity: 0,
    })).toBeNull()
  })

  it("prioriza oficina mientras quede saldo por llegar allí", () => {
    expect(pendingReceptionStage({
      status: "sent",
      deliveryMode: "via_oficina",
      pendingOfficeQuantity: 10,
      pendingFaenaQuantity: 10,
    })).toBe("office")
  })

  it("pasa a faena cuando la oficina ya recibió todo", () => {
    expect(pendingReceptionStage({
      status: "office_received",
      deliveryMode: "via_oficina",
      pendingOfficeQuantity: 0,
      pendingFaenaQuantity: 10,
    })).toBe("faena")
  })
})
