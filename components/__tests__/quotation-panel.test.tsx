// @vitest-environment jsdom
/**
 * Panel de cotizaciones de la solicitud (repuestos y servicios).
 *
 * 2026-11-07: el texto «mínimo 3…» dejó de ser fijo (el umbral de repuestos lo
 * cambia: lo dice `requirementHint`) y una solicitud de repuestos que se envió
 * sin cotización se aprueba directo con «Aprobar sin cotización».
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QuotationPanel, type QuotationRow, type QuotationPanelProps } from "@/components/quotation-panel"

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock("@/lib/toast", () => ({ toast: { success: toastSuccess, error: toastError } }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const ok = async () => ({ ok: true, message: "listo" })

function quotation(overrides: Partial<QuotationRow> = {}): QuotationRow {
  return {
    id: "q-1", supplierId: null, supplierNameFree: "Repuestos del Sur", fileName: "cot.pdf",
    totalAmount: 150_000, status: "pending", notes: null, createdAt: "2026-11-07T12:00:00.000Z",
    ...overrides,
  }
}

function panel(overrides: Partial<QuotationPanelProps> = {}) {
  const props: QuotationPanelProps = {
    requestId: "req-1", requestStatus: "draft", quotations: [], canUpload: true, canApprove: false,
    downloadEndpointPrefix: "/api/repuestos/quotaciones",
    uploadQuotationAction: ok, deleteQuotationAction: ok, selectQuotationAction: ok,
    ...overrides,
  }
  return render(<QuotationPanel {...props} />)
}

const approveButton = () => screen.queryByRole("button", { name: "Aprobar sin cotización" })

describe("QuotationPanel · texto de la regla", () => {
  it("sin requirementHint conserva el texto de «mínimo 3» (servicios)", () => {
    panel({ quotations: [] })
    expect(screen.getByText(/0\/3 adjuntadas — mínimo 3, o menos con una justificación en Notas generales/)).toBeInTheDocument()
    expect(screen.getByText(/Mínimo 3, o menos con una justificación en Notas generales\./)).toBeInTheDocument()
  })

  it("con requirementHint reemplaza los dos textos fijos de «mínimo 3»", () => {
    panel({ quotations: [], requirementHint: "Bajo $500.000 puede enviarse sin cotización." })

    expect(screen.getAllByText(/Bajo \$500\.000 puede enviarse sin cotización\./)).toHaveLength(2)
    expect(screen.queryByText(/mínimo 3/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/0\/3/)).not.toBeInTheDocument()
  })

  it("con requirementHint y cotizaciones también reemplaza el subtítulo", () => {
    panel({ quotations: [quotation()], requirementHint: "Sobre $500.000 se requieren 3 cotizaciones." })

    expect(screen.getByText(/1 adjuntadas — Sobre \$500\.000 se requieren 3 cotizaciones\./)).toBeInTheDocument()
    expect(screen.queryByText(/mínimo 3/i)).not.toBeInTheDocument()
  })

  it("requirementHint null o vacío cae al texto de siempre", () => {
    const { rerender } = panel({ quotations: [], requirementHint: null })
    expect(screen.getByText(/mínimo 3/)).toBeInTheDocument()
    rerender(<QuotationPanel
      requestId="req-1" requestStatus="draft" quotations={[]} canUpload canApprove={false}
      downloadEndpointPrefix="/x" uploadQuotationAction={ok} deleteQuotationAction={ok} selectQuotationAction={ok}
      requirementHint=""
    />)
    expect(screen.getByText(/mínimo 3/)).toBeInTheDocument()
  })

  it("el hint sólo se muestra al editar: en revisión no lo repite", () => {
    panel({ requestStatus: "submitted", quotations: [quotation()], requirementHint: "Sobre $500.000 se requieren 3 cotizaciones." })
    expect(screen.queryByText(/se requieren 3 cotizaciones/)).not.toBeInTheDocument()
  })
})

describe("QuotationPanel · aprobar sin cotización", () => {
  const approveWithoutQuotationAction = vi.fn(async () => ({ ok: true, message: "Solicitud aprobada." }))

  it("aparece sólo sin cotizaciones, con permiso de aprobar y en revisión", () => {
    panel({ requestStatus: "submitted", canApprove: true, approveWithoutQuotationAction })
    expect(approveButton()).toBeInTheDocument()
    cleanup()
    panel({ requestStatus: "in_review", canApprove: true, approveWithoutQuotationAction })
    expect(approveButton()).toBeInTheDocument()
  })

  it("no aparece con cotizaciones pendientes: ahí se selecciona la ganadora", () => {
    panel({ requestStatus: "submitted", canApprove: true, quotations: [quotation()], approveWithoutQuotationAction })
    expect(approveButton()).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Seleccionar/ })).toBeInTheDocument()
  })

  it("no aparece sin permiso de aprobar", () => {
    panel({ requestStatus: "submitted", canApprove: false, approveWithoutQuotationAction })
    expect(approveButton()).not.toBeInTheDocument()
  })

  it("no aparece fuera de revisión (borrador, aprobada, cancelada)", () => {
    for (const requestStatus of ["draft", "approved", "cancelled", "rejected"]) {
      panel({ requestStatus, canApprove: true, approveWithoutQuotationAction })
      expect(approveButton(), requestStatus).not.toBeInTheDocument()
      cleanup()
    }
  })

  it("no aparece si el módulo no entrega la acción (servicios)", () => {
    panel({ requestStatus: "submitted", canApprove: true })
    expect(approveButton()).not.toBeInTheDocument()
  })

  it("en revisión sin cotizaciones el subtítulo dice que se puede aprobar directo", () => {
    panel({ requestStatus: "submitted", canApprove: true, approveWithoutQuotationAction })
    expect(screen.getByText(/Sin cotizaciones: puedes aprobar la solicitud directamente/)).toBeInTheDocument()
    expect(screen.queryByText("Selecciona la cotización ganadora")).not.toBeInTheDocument()
  })

  it("pide confirmación con un fundamento opcional y llama a la acción con la solicitud", async () => {
    approveWithoutQuotationAction.mockClear()
    panel({ requestStatus: "submitted", canApprove: true, approveWithoutQuotationAction })

    fireEvent.click(approveButton()!)
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/sin adjudicar una cotización/)).toBeInTheDocument()
    // El fundamento es opcional: el campo no es obligatorio.
    const justification = within(dialog).getByLabelText(/Fundamento/)
    expect(justification).not.toBeRequired()
    fireEvent.change(justification, { target: { value: "Repuesto de bajo costo" } })

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar aprobación" }))

    await waitFor(() => expect(approveWithoutQuotationAction).toHaveBeenCalledTimes(1))
    const sent = (approveWithoutQuotationAction.mock.calls as unknown as Array<[unknown, FormData]>)[0]![1]
    expect(sent.get("requestId")).toBe("req-1")
    expect(sent.get("justification")).toBe("Repuesto de bajo costo")
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Solicitud aprobada."))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("cancelar el diálogo no aprueba nada", async () => {
    approveWithoutQuotationAction.mockClear()
    panel({ requestStatus: "submitted", canApprove: true, approveWithoutQuotationAction })

    fireEvent.click(approveButton()!)
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(approveWithoutQuotationAction).not.toHaveBeenCalled()
  })

  it("si la acción falla deja el diálogo abierto y avisa el error", async () => {
    const failing = vi.fn(async () => ({ ok: false, message: "Hay cotizaciones adjuntas: selecciona la ganadora" }))
    panel({ requestStatus: "submitted", canApprove: true, approveWithoutQuotationAction: failing })

    fireEvent.click(approveButton()!)
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar aprobación" }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Hay cotizaciones adjuntas: selecciona la ganadora"))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("una solicitud aprobada sin cotización no dice «Cotización aprobada»", () => {
    panel({ requestStatus: "approved", quotations: [] })
    expect(screen.getByText(/Aprobada sin cotización\. Ítems listos para orden de compra/)).toBeInTheDocument()
    expect(screen.queryByText(/✓ Cotización aprobada/)).not.toBeInTheDocument()
  })

  it("una solicitud aprobada con cotización conserva el texto de siempre", () => {
    panel({ requestStatus: "approved", quotations: [quotation({ status: "selected" })] })
    expect(screen.getByText(/✓ Cotización aprobada\. Ítems listos para orden de compra/)).toBeInTheDocument()
  })
})
