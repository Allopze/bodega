// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAddInvoiceAction = vi.fn()
const mockSetInvoiceReceiptsAction = vi.fn()
const mockRefresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }))
vi.mock("../invoice-actions", () => ({
  addInvoiceAction: (...args: unknown[]) => mockAddInvoiceAction(...args),
  deleteInvoiceAction: vi.fn(),
  setInvoiceReceiptsAction: (...args: unknown[]) => mockSetInvoiceReceiptsAction(...args),
}))

const mockUseDteAsInvoice = vi.fn()
vi.mock("../actions/dte-use-invoice", () => ({
  attachDteAsInvoice: (...args: unknown[]) => mockUseDteAsInvoice(...args),
}))

const mockAnalyzeDteLines = vi.fn()
vi.mock("../actions/dte-analyze-lines", () => ({
  analyzeDteCandidateLines: (...args: unknown[]) => mockAnalyzeDteLines(...args),
}))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { InvoicesSection, type DteCandidate } from "./invoices-section"
import { reconcileInvoiceEvidence } from "@/lib/services/purchasing-module/invoice-reconciliation"

function emptyReconciliation(totalOC = 0) {
  return reconcileInvoiceEvidence({ totalOC, orderItems: [], invoices: [] })
}

function candidate() {
  return {
    id: "dte-1",
    tipoDte: "33",
    folio: 3692684,
    razonSocialEmisor: "Proveedor Ficticio SpA",
    montoTotal: 119000,
    fechaEmision: "2026-07-09",
    amountMatches: true,
    referencesOrder: false,
    orderReference: "none" as DteCandidate["orderReference"],
    confidence: "unassessed" as const,
    enrichmentStatus: "pending" as const,
    lineEnrichedAt: null,
    lines: [],
    proposedLinks: [],
    explanation: {
      totalLines: 0,
      matchedLines: 0,
      ambiguousLines: 0,
      unitMismatches: 0,
      quantityExactLines: 0,
      quantityUnderLines: 0,
      quantityOverLines: 0,
    },
  }
}

/** Candidato con evidencia de líneas ya persistida, como lo deja el análisis. */
function enrichedCandidate(overrides: Partial<DteCandidate> = {}): DteCandidate {
  return {
    ...candidate(),
    confidence: "medium" as const,
    enrichmentStatus: "ready" as const,
    lineEnrichedAt: "2026-08-24T10:00:00.000Z",
    lines: [{
      id: "dte-line:dte-1:1",
      lineNumber: 1,
      productCode: "CAS-01",
      productName: "Casco amarillo",
      unitOfMeasure: "UN",
      quantity: 12,
      unitPrice: 10000,
      amount: 120000,
    }],
    proposedLinks: [{
      dteItemId: "dte-line:dte-1:1",
      purchaseOrderItemId: "oc-casco",
      matchType: "sku" as const,
      quantityStatus: "over" as const,
    }],
    explanation: { ...candidate().explanation, totalLines: 1, matchedLines: 1, quantityOverLines: 1 },
    ...overrides,
  }
}

const OC_ITEMS = [{
  id: "oc-casco",
  catalogProductId: "prod-casco",
  productName: "Casco amarillo",
  productCode: "CAS-01",
  unitOfMeasure: "UN",
  quantity: 10,
  unitPrice: 10000,
  subtotal: 100000,
}]

describe("InvoicesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAnalyzeDteLines.mockResolvedValue({ ok: true, message: "1 DTE analizado(s)." })
  })

  it("refreshes suggestions explicitly and again on focus only after sixty seconds", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-24T10:00:00.000Z"))
    render(
      <InvoicesSection
        purchaseOrderId="oc-1"
        invoices={[]}
        reconciliation={emptyReconciliation()}
        canManage
        canUpdateCatalog={false}
        ocItems={[]}
      />,
    )

    // El clic pide el análisis al portal y sólo entonces relee la lista.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /actualizar sugerencias/i }))
    })
    expect(mockAnalyzeDteLines).toHaveBeenCalledWith("oc-1")
    expect(mockRefresh).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new Event("focus"))
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_001)
    await act(async () => { window.dispatchEvent(new Event("focus")) })
    expect(mockRefresh).toHaveBeenCalledTimes(2)
    // Volver a la pestaña NO sale al portal: sería una descarga con las
    // credenciales de la empresa cada vez que alguien cambia de ventana.
    expect(mockAnalyzeDteLines).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it("does not serialise a pending OC cost as the string null when adding an invoice line", () => {
    render(
      <InvoicesSection
        purchaseOrderId="oc-servicio"
        invoices={[]}
        reconciliation={emptyReconciliation()}
        canManage
        canUpdateCatalog={false}
        ocItems={[{
          id: "oc-linea-servicio",
          catalogProductId: null,
          productName: "Calibración pendiente",
          productCode: null,
          unitOfMeasure: "servicio",
          quantity: 1,
          unitPrice: null,
          subtotal: null,
        }]}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: /agregar ítem/i }))

    const price = screen.getByPlaceholderText("Precio documento") as HTMLInputElement
    expect(price.value).toBe("")
    expect(screen.getByText(/costo de oc pendiente/i)).toBeInTheDocument()
  })

  it("opens the supplier PDF when the operator chooses Ver factura", () => {
    render(
      <InvoicesSection
        purchaseOrderId="oc-1"
        invoices={[]}
        reconciliation={emptyReconciliation(119000)}
        canManage
        canUpdateCatalog={false}
        ocItems={[]}
        dteCandidates={[candidate()]}
      />,
    )

    const link = screen.getByRole("link", { name: /ver factura/i })
    expect(link).toHaveAttribute("href", "/api/purchase-orders/dtes/dte-1/pdf")
    expect(link).toHaveAttribute("target", "_blank")
  })

  it("uses the one-step DTE action instead of only pre-filling a manual upload", async () => {
    mockUseDteAsInvoice.mockResolvedValue({ ok: true, message: "Factura 3692684 adjuntada correctamente" })
    render(
      <InvoicesSection
        purchaseOrderId="oc-1"
        invoices={[]}
        reconciliation={emptyReconciliation(119000)}
        canManage
        canUpdateCatalog={false}
        ocItems={[]}
        receipts={[{
          id: "receipt-1",
          code: "REC-1",
          receivedAt: "2026-08-20T12:00:00.000Z",
          locationType: "faena",
          dispatchGuideNo: "GD-100",
          items: [],
        }]}
        defaultReceiptId="receipt-1"
        dteCandidates={[candidate()]}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: /usar este dte/i }))
    fireEvent.click(screen.getByRole("button", { name: /confirmar y usar dte/i }))

    await waitFor(() => expect(mockUseDteAsInvoice).toHaveBeenCalledWith({
      purchaseOrderId: "oc-1",
      dteDocumentId: "dte-1",
      lineResolutions: undefined,
      receiptIds: ["receipt-1"],
    }))
    expect(screen.getByLabelText(/REC-1/)).toBeChecked()
  })

  it("does not submit the manual invoice form when using a DTE", async () => {
    mockUseDteAsInvoice.mockResolvedValue({ ok: true, message: "Factura 3692684 adjuntada correctamente" })
    render(
      <InvoicesSection
        purchaseOrderId="oc-1"
        invoices={[]}
        reconciliation={emptyReconciliation(119000)}
        canManage
        canUpdateCatalog={false}
        ocItems={[]}
        dteCandidates={[candidate()]}
      />,
    )

    // Satisfy the form's native required-file constraint: a button without an
    // explicit type would otherwise hide its accidental submit behind browser
    // validation and miss the exact regression we are protecting.
    const fileInput = screen.getByLabelText("Archivo")
    fireEvent.change(fileInput, {
      target: { files: [new File(["%PDF-1.7"], "manual.pdf", { type: "application/pdf" })] },
    })

    const useDteButton = screen.getByRole("button", { name: /usar este dte/i })
    const form = useDteButton.closest("form")
    expect(form).not.toBeNull()
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault())
    form!.addEventListener("submit", onSubmit)

    fireEvent.click(useDteButton)
    fireEvent.click(screen.getByRole("button", { name: /confirmar y usar dte/i }))

    await waitFor(() => expect(mockUseDteAsInvoice).toHaveBeenCalledOnce())
    expect(useDteButton).toHaveAttribute("type", "button")
    expect(onSubmit).not.toHaveBeenCalled()
    expect(mockAddInvoiceAction).not.toHaveBeenCalled()
  })

  // La cifra existía en `proposedLinks` y sólo se resumía en la fila, lejos del
  // select donde se decide. Facturar de más es el error caro de esta pantalla.
  it("avisa en la línea, no sólo en el resumen, que el DTE excede lo pendiente", () => {
    render(
      <InvoicesSection
        purchaseOrderId="oc-1"
        invoices={[]}
        reconciliation={emptyReconciliation(119000)}
        canManage
        canUpdateCatalog={false}
        ocItems={OC_ITEMS}
        dteCandidates={[enrichedCandidate()]}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: /usar este dte/i }))

    expect(screen.getByRole("dialog", { name: /revisar asociaciones/i })).toBeTruthy()
    expect(screen.getByText("Excede lo pendiente")).toBeTruthy()
  })

  it("muestra talla y demás atributos para distinguir variantes en el selector DTE", () => {
    render(
      <InvoicesSection
        purchaseOrderId="oc-1"
        invoices={[]}
        reconciliation={emptyReconciliation(119000)}
        canManage
        canUpdateCatalog={false}
        ocItems={[{
          ...OC_ITEMS[0]!,
          productName: "Buzo Dupont Tyvek",
          attributes: [
            { name: "Talla", value: "L" },
            { name: "Color", value: "Blanco" },
          ],
        }]}
        dteCandidates={[enrichedCandidate()]}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: /usar este dte/i }))
    fireEvent.click(screen.getByRole("combobox", { name: /asociar línea dte 1/i }))

    expect(screen.getByRole("option", {
      name: /Buzo Dupont Tyvek · Talla: L · Color: Blanco · 10 UN/i,
    })).toBeInTheDocument()
  })

  // Con el análisis fallido las filas persistidas siguen ahí pero sin
  // sugerencias: el diálogo se veía igual que "se analizó y no coincidió nada",
  // y confirmarlo dejaba la factura sin un solo vínculo de línea.
  it("distingue un análisis fallido de un análisis sin coincidencias", () => {
    render(
      <InvoicesSection
        purchaseOrderId="oc-1"
        invoices={[]}
        reconciliation={emptyReconciliation(119000)}
        canManage
        canUpdateCatalog={false}
        ocItems={OC_ITEMS}
        dteCandidates={[enrichedCandidate({ enrichmentStatus: "failed", proposedLinks: [] })]}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: /usar este dte/i }))

    expect(screen.getByRole("alert").textContent).toContain("El análisis de líneas de este DTE falló")
  })

  // Sin líneas que revisar el servidor vincula solo: es el único camino del
  // flujo donde nadie confirma las asociaciones, y el aviso lo callaba.
  it("advierte que sin análisis previo el servidor vinculará las líneas sin revisión", () => {
    render(
      <InvoicesSection
        purchaseOrderId="oc-1"
        invoices={[]}
        reconciliation={emptyReconciliation(119000)}
        canManage
        canUpdateCatalog={false}
        ocItems={OC_ITEMS}
        dteCandidates={[candidate()]}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: /usar este dte/i }))

    expect(screen.getByRole("alert").textContent).toContain("vinculará las líneas automáticamente")
  })

  // OC anulada: la sección existe sólo para soltar el DTE que quedó colgado.
  // Eliminar sí; adjuntar no, porque el servicio rechaza el alta en `cancelled`.
  it("offers deletion but not attachment when the order can no longer receive invoices", () => {
    render(
      <InvoicesSection
        purchaseOrderId="oc-anulada"
        invoices={[{
          id: "inv-1",
          invoiceNumber: "456999",
          amount: 119000,
          issueDate: "2026-07-09",
          fileName: "DTE-33-456999.pdf",
          mimeType: "application/pdf",
          uploadedAt: "2026-07-09T12:00:00.000Z",
        }]}
        reconciliation={emptyReconciliation(119000)}
        canManage
        canUpdateCatalog={false}
        canAttach={false}
        ocItems={[]}
      />,
    )

    expect(screen.getByRole("button", { name: /eliminar factura 456999/i })).toBeInTheDocument()
    expect(screen.queryByText(/adjuntar factura/i)).not.toBeInTheDocument()
  })

  it("shows current receipt links and applies an explainable suggestion only after confirmation", () => {
    const receipts = [
      { id: "receipt-1", code: "REC-1", receivedAt: "2026-08-20T12:00:00.000Z", locationType: "faena", dispatchGuideNo: "GD-1", items: [] },
      { id: "receipt-2", code: "REC-2", receivedAt: "2026-08-21T12:00:00.000Z", locationType: "faena", dispatchGuideNo: "GD-2", items: [] },
    ]
    render(
      <InvoicesSection
        purchaseOrderId="oc-1"
        invoices={[{
          id: "invoice-1",
          invoiceNumber: "F-100",
          amount: 100,
          issueDate: "2026-08-20",
          fileName: "factura.pdf",
          mimeType: "application/pdf",
          uploadedAt: "2026-08-20T12:00:00.000Z",
          receiptIds: ["receipt-1"],
          receiptSuggestion: {
            receiptIds: ["receipt-2"],
            confidence: "medium",
            ambiguous: false,
            reasons: ["Las cantidades documentadas quedan cubiertas por las recepciones sugeridas."],
          },
        }]}
        receipts={receipts}
        reconciliation={emptyReconciliation(100)}
        canManage
        canUpdateCatalog={false}
        canAttach={false}
        ocItems={[]}
      />,
    )

    expect(screen.getByText("Recepciones: REC-1")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Asociar recepciones" }))
    expect(screen.getByLabelText(/REC-1/)).toBeChecked()
    expect(screen.getByLabelText(/REC-2/)).not.toBeChecked()
    fireEvent.click(screen.getByRole("button", { name: "Aplicar sugerencia" }))
    expect(screen.getByLabelText(/REC-1/)).not.toBeChecked()
    expect(screen.getByLabelText(/REC-2/)).toBeChecked()
  })
})

describe("InvoicesSection · calidad de la referencia citada", () => {
  const render1 = (candidato: ReturnType<typeof candidate>) =>
    render(
      <InvoicesSection
        purchaseOrderId="oc-1"
        invoices={[]}
        reconciliation={emptyReconciliation(119000)}
        canManage
        canUpdateCatalog={false}
        ocItems={[]}
        dteCandidates={[candidato]}
      />,
    )

  it("nombra lo que el proveedor escribió cuando citó sólo el año de la OC", () => {
    render1({ ...candidate(), orderReference: "year" as const })

    expect(screen.getByText(/sólo el año/i)).toBeInTheDocument()
  })

  it("nombra aparte la cita del correlativo, que sí identifica una orden", () => {
    render1({ ...candidate(), orderReference: "correlative" as const })

    expect(screen.getByText(/cita el n° de esta oc/i)).toBeInTheDocument()
    expect(screen.queryByText(/sólo el año/i)).not.toBeInTheDocument()
  })

  it("no muestra el aviso cuando la cita fue exacta", () => {
    render1({ ...candidate(), referencesOrder: true, orderReference: "exact" as const })

    expect(screen.getByText(/^cita esta oc$/i)).toBeInTheDocument()
    expect(screen.queryByText(/sólo el año/i)).not.toBeInTheDocument()
  })

  it("se queda callado cuando el proveedor citó su propia numeración", () => {
    // Es el 86% de los documentos reales: un badge acá sería ruido en todos.
    render1({ ...candidate(), orderReference: "foreign" as const })

    expect(screen.queryByText(/sólo el año/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/cita/i)).not.toBeInTheDocument()
  })
})
