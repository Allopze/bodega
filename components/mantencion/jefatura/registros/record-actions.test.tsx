// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const exportRecordAction = vi.fn()
const downloaded = vi.fn()

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock("@/app/(app)/mantencion/registros/[id]/actions", () => ({
  exportRecordAction: (...args: unknown[]) => exportRecordAction(...args),
  markRecordReviewedAction: vi.fn(),
  observeRecordAction: vi.fn(),
  voidRecordAction: vi.fn(),
}))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
// La descarga real crea un <a> con data URI; aquí sólo importa que se pida con el nombre correcto.
HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) { downloaded(this.download) }

const { RecordActions } = await import("./record-actions")

const BASE = {
  recordId: "rec-1", folio: "MP-BIO-0001", status: "vigente" as const, review: "pendiente" as const,
  canExport: true, canObserve: false, canReview: false, canVoid: false, canCorrect: false, queue: null,
}

describe("RecordActions: menú Exportar", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it("ofrece PDF (enlace de descarga) y Excel (acción) dentro de un solo botón «Exportar»", async () => {
    exportRecordAction.mockResolvedValue({ ok: true, data: { base64: "AAAA", filename: "registro-MP-BIO-0001.xlsx" } })
    render(<RecordActions {...BASE} />)
    expect(screen.queryByRole("link", { name: /PDF/ })).toBeNull()

    fireEvent.keyDown(screen.getByRole("button", { name: "Exportar" }), { key: "Enter" })
    const pdf = await screen.findByRole("menuitem", { name: "PDF" })
    expect(pdf.getAttribute("href")).toBe("/api/mantencion/registros/rec-1/pdf")
    expect(pdf.hasAttribute("download")).toBe(true)

    fireEvent.click(screen.getByRole("menuitem", { name: "Excel" }))
    await waitFor(() => expect(downloaded).toHaveBeenCalledWith("registro-MP-BIO-0001.xlsx"))
    expect(exportRecordAction).toHaveBeenCalledWith({ recordId: "rec-1" })
  })

  it("sin permiso de exportar no se dibuja el menú", () => {
    render(<RecordActions {...BASE} canExport={false} />)
    expect(screen.queryByRole("button", { name: "Exportar" })).toBeNull()
  })
})
