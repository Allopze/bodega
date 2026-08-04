// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PrintTrigger } from "./print-trigger"

describe("Delivery PrintTrigger", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("keeps the direct PDF action and reports a download failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    render(<PrintTrigger pdfHref="/entregas/del-1/print/pdf" suggestedFilename="comprobante-entrega-ENT-1.pdf" />)

    expect(screen.getByRole("link", { name: "Volver a entregas" })).toHaveAttribute("href", "/entregas")
    fireEvent.click(screen.getByRole("button", { name: "Descargar PDF" }))

    expect(await screen.findByRole("status")).toHaveTextContent("No se pudo generar el PDF (Error 503). Intenta nuevamente.")
  })
})
