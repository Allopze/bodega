// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { OcReceptionCta } from "./oc-reception-cta"

describe("OcReceptionCta", () => {
  it("links to faena reception when office stock is pending worksite receipt", () => {
    render(
      <OcReceptionCta
        orderId="oc-123"
        pendingFaenaQuantity={20}
        worksiteName="Biodiversa"
        canRegisterFaena
      />,
    )

    const link = screen.getByRole("link", { name: /recepcionar en faena/i })
    expect(link).toHaveAttribute("href", "/recepcion/nueva?oc=oc-123")
    expect(screen.getByText(/20 unidades pendientes para Biodiversa/i)).toBeInTheDocument()
  })

  it("does not render when there is no pending worksite receipt", () => {
    const { container } = render(
      <OcReceptionCta
        orderId="oc-123"
        pendingFaenaQuantity={0}
        worksiteName="Biodiversa"
        canRegisterFaena
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it("does not render without faena reception permission", () => {
    const { container } = render(
      <OcReceptionCta
        orderId="oc-123"
        pendingFaenaQuantity={20}
        worksiteName="Biodiversa"
        canRegisterFaena={false}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
