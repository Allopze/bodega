// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PublicFormQrDialog } from "./public-form-qr-dialog"

const toDataURL = vi.fn().mockResolvedValue("data:image/png;base64,qr")

vi.mock("qrcode", () => ({ default: { toDataURL } }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const option = {
  id: "tae-link-1",
  label: "Santa Fe · Surtidor principal",
  url: "https://chome.test/tae/acceso/secret-token",
  pdfTitle: "Santa Fe",
  pdfFileName: "tae-acceso.pdf",
}

describe("PublicFormQrDialog", () => {
  it("only creates the QR once the dialog is opened", async () => {
    render(
      <PublicFormQrDialog
        title="Acceso TAE"
        description="Comparte el acceso"
        selectorLabel="Punto de carga"
        options={[option]}
        selectedOptionId={option.id}
        onSelectedOptionChange={() => {}}
        pdfSubtitle="Formulario TAE"
        qrAlt={() => "QR TAE"}
      />,
    )

    expect(toDataURL).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: /qr \/ enlace/i }))
    await waitFor(() => expect(toDataURL).toHaveBeenCalledWith(option.url, { width: 320, margin: 2 }))
    expect(screen.getByAltText("QR TAE")).toBeInTheDocument()
    expect(screen.getByText(option.url)).toBeInTheDocument()
  })
})
