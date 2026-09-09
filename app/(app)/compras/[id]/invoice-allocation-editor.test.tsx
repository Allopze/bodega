// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock("../actions/invoice-allocations", () => ({ saveInvoiceLineAllocationsAction: mocks.save }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn() } }))
import { InvoiceAllocationEditor } from "./invoice-allocation-editor"

const line = { id: "line", productName: "Cascos de seguridad", productCode: "CAS", unitOfMeasure: "unidad", quantity: 10, subtotal: 100000, allocationFingerprint: "alloc-v1:current", allocations: [{ id: "aa", purchaseOrderItemId: "a", quantity: 6, subtotal: 60000 }, { id: "ab", purchaseOrderItemId: "b", quantity: 4, subtotal: 40000 }] }
const orderItems = [{ id: "a", productName: "Casco blanco", productCode: "CAS-B", unitOfMeasure: "unidad", quantity: 6, subtotal: 60000, unitPrice: 10000, catalogProductId: "pa" }, { id: "b", productName: "Casco azul", productCode: "CAS-A", unitOfMeasure: "unidad", quantity: 4, subtotal: 40000, unitPrice: 10000, catalogProductId: "pb" }]
describe("InvoiceAllocationEditor", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.save.mockResolvedValue({ ok: true, message: "Reparto guardado" }) })
  it("shows split totals and prevents over-allocation", async () => {
    render(<InvoiceAllocationEditor purchaseOrderId="order" line={line} orderItems={orderItems} />)
    fireEvent.click(screen.getByRole("button", { name: "Dividir línea" }))
    expect(screen.getByText(/no se recordará.*correspondencia/i)).toBeInTheDocument()
    expect(screen.getByText(/Cantidad asignada: 10/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Cantidad 1"), { target: { value: "7" } })
    expect(screen.getByRole("button", { name: "Guardar reparto" })).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Cantidad 1"), { target: { value: "6" } })
    expect(screen.getByRole("button", { name: "Guardar reparto" })).toBeEnabled()
  })
  it("returns keyboard focus to its trigger and surfaces stale evidence", async () => {
    mocks.save.mockResolvedValue({ ok: false, code: "STALE_EVIDENCE", message: "La línea cambió. Recarga para revisar el reparto actual." })
    render(<InvoiceAllocationEditor purchaseOrderId="order" line={line} orderItems={orderItems} />)
    const trigger = screen.getByRole("button", { name: "Dividir línea" })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole("button", { name: "Guardar reparto" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/recarga/i)
    expect(await screen.findByRole("button", { name: "Guardar reparto" })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    await waitFor(() => expect(trigger).toHaveFocus())
  })
  it("disables repeat submission while saving and refreshes after success", async () => {
    let complete!: (value: { ok: boolean; message: string }) => void
    mocks.save.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    render(<InvoiceAllocationEditor purchaseOrderId="order" line={line} orderItems={orderItems} />)
    fireEvent.click(screen.getByRole("button", { name: "Dividir línea" }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar reparto" }))
    fireEvent.click(screen.getByRole("button", { name: "Guardando…" }))
    expect(screen.getByRole("button", { name: "Guardando…" })).toBeDisabled()
    complete({ ok: true, message: "Reparto guardado" })
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    expect(mocks.save).toHaveBeenCalledOnce()
  })

  it("preserves the edited rows when the server cannot be reached", async () => {
    mocks.save.mockRejectedValue(new Error("offline"))
    render(<InvoiceAllocationEditor purchaseOrderId="order" line={line} orderItems={orderItems} />)
    fireEvent.click(screen.getByRole("button", { name: "Dividir línea" }))
    fireEvent.change(screen.getByLabelText("Cantidad 1"), { target: { value: "5" } })
    fireEvent.change(screen.getByLabelText("Cantidad 2"), { target: { value: "5" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar reparto" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/cambios siguen aquí/i)
    expect(screen.getByLabelText("Cantidad 1")).toHaveValue(5)
    expect(screen.getByLabelText("Cantidad 2")).toHaveValue(5)
  })
})
