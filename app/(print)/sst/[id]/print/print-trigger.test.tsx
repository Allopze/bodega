// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PrintTrigger } from "./print-trigger"

describe("PrintTrigger del acta SST", () => {
  it("por defecto el enlace de vuelta dice «Volver al Acta»", () => {
    render(<PrintTrigger backHref="/prevencion/sst-1" pdfHref="/sst/sst-1/print/pdf" suggestedFilename="acta.pdf" />)

    expect(screen.getByRole("link", { name: "Volver al Acta" })).toHaveAttribute("href", "/prevencion/sst-1")
  })

  it("acepta otro rótulo para que cada documento nombre su destino", () => {
    render(
      <PrintTrigger
        backHref="/prevencion/inspecciones/run-1"
        backLabel="Volver a la inspección"
        pdfHref="/prevencion/inspecciones/run-1/print/pdf"
        suggestedFilename="INSP-0001.pdf"
      />,
    )

    expect(screen.getByRole("link", { name: "Volver a la inspección" })).toHaveAttribute("href", "/prevencion/inspecciones/run-1")
    expect(screen.queryByRole("link", { name: "Volver al Acta" })).toBeNull()
  })
})
