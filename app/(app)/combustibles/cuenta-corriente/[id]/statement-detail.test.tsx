// @vitest-environment jsdom
/**
 * Detalle de un estado de cuenta (Pagos › Estados de cuenta): el estado dicho en
 * palabras, fechas legibles y ningún valor crudo de enum. `statement-detail.tsx`
 * se queda en esta carpeta (su conteo de colores literales estaba congelado), por
 * eso su prueba también.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAddPayment = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock("../../actions", () => ({ addPaymentAction: mockAddPayment }))
vi.mock("@/lib/toast", () => ({ toast: mockToast }))

import { AddPaymentDialog, StatementDetail } from "./statement-detail"

const statement = {
  id: "st-1",
  month: "2026-09",
  totalLiters: 9410,
  totalBaseAmount: 9_780_000,
  totalIec: 2_180_000,
  totalIva: 2_270_000,
  totalAmount: 14_230_000,
  paidAmount: 5_830_000,
  dueDate: "2026-11-05",
  status: "partial",
  supplier: { name: "Otro proveedor" },
  payments: [{ id: "p-1", paymentDate: "2026-10-15", amount: 5_830_000, paymentMethod: "Transferencia", reference: "TRF-88120" }],
  loads: [
    { id: "load-1", loadDate: "2026-09-12", product: "PETROLEO DIESEL", receiptNumber: "F-55120", liters: 240, totalAmount: 428_760, vehicle: { plate: "AA-BB-11", code: "CA-09" }, worksite: { name: "Santa Fe" } },
  ],
}

describe("StatementDetail", () => {
  it("dice el estado en palabras: cuánto se pagó, cuánto falta y cuándo vence", () => {
    render(<StatementDetail statement={statement} today="2026-10-30" />)

    expect(screen.getByText("Pago parcial")).toBeInTheDocument()
    expect(screen.getByText(/se pagó el 41%/i)).toBeInTheDocument()
    expect(screen.getByText(/vence el 05-11-2026 \(en 6 días\)/i)).toBeInTheDocument()
    expect(screen.queryByText("partial")).toBeNull()
  })

  it("un estado de cuenta vencido se dice vencido aunque la fila siga «abierta»", () => {
    render(<StatementDetail statement={{ ...statement, status: "open", paidAmount: 0, payments: [], dueDate: "2026-10-10" }} today="2026-10-30" />)

    expect(screen.getByText("Vencido")).toBeInTheDocument()
    expect(screen.getByText(/venció el 10-10-2026 \(hace 20 días\)/i)).toBeInTheDocument()
    expect(screen.getByText(/todavía no se registra ningún pago/i)).toBeInTheDocument()
  })

  it("muestra el desglose con IEC e IVA explicados, y las fechas legibles", () => {
    render(<StatementDetail statement={statement} today="2026-10-30" />)

    expect(screen.getByText("IEC")).toHaveAttribute("title", expect.stringMatching(/impuesto específico/i))
    expect(screen.getByText("IVA")).toHaveAttribute("title", expect.stringMatching(/19 %/))
    expect(screen.getByText("$2.180.000")).toBeInTheDocument()
    expect(screen.getByText("15-10-2026")).toBeInTheDocument()
    expect(screen.getByText("05-11-2026")).toBeInTheDocument()
    expect(screen.queryByText("2026-10-15")).toBeNull()
  })

  it("cada carga del estado de cuenta lleva a su ficha", () => {
    render(<StatementDetail statement={statement} today="2026-10-30" />)

    const row = screen.getByRole("link", { name: "12-09-2026" })
    expect(row).toHaveAttribute("href", "/combustibles/cargas/factura/load-1")
    expect(screen.getByText("CA-09 · AA-BB-11")).toBeInTheDocument()
  })
})

describe("AddPaymentDialog", () => {
  beforeEach(() => vi.clearAllMocks())

  it("registra el pago del estado de cuenta, avisa y cierra", async () => {
    mockAddPayment.mockResolvedValue({ ok: true, message: "Pago registrado" })
    render(<AddPaymentDialog statementId="st-1" pendingAmount={8_400_000} />)

    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }))
    const dialog = await screen.findByRole("dialog", { name: "Registrar pago" })
    expect(dialog).toHaveTextContent("Por pagar: $8.400.000")
    const amount = within(dialog).getByLabelText(/monto/i)
    expect(amount).toHaveAttribute("max", "8400000")
    fireEvent.change(amount, { target: { value: "1000000" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar pago" }))

    await waitFor(() => expect(mockAddPayment).toHaveBeenCalledTimes(1))
    const form = mockAddPayment.mock.calls[0]![1] as FormData
    expect(form.get("statementId")).toBe("st-1")
    expect(form.get("amount")).toBe("1000000")
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Pago registrado"))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("si el servidor lo rechaza, deja el diálogo abierto con el motivo", async () => {
    // Otra persona pagó lo que faltaba mientras esta pantalla estaba abierta: el servidor es quien decide.
    mockAddPayment.mockResolvedValue({ ok: false, message: "El pago excede lo que falta por pagar ($0)" })
    render(<AddPaymentDialog statementId="st-1" pendingAmount={8_400_000} />)

    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }))
    const dialog = await screen.findByRole("dialog", { name: "Registrar pago" })
    fireEvent.change(within(dialog).getByLabelText(/monto/i), { target: { value: "1000000" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar pago" }))

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/excede lo que falta por pagar/i)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })
})
