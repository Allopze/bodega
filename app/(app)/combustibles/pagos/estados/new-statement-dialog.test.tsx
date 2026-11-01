// @vitest-environment jsdom
/**
 * «Crear estado de cuenta»: la vista previa es el paso de confirmación. El botón
 * de crear sólo se habilita cuando ya se mostró lo que entra (cargas, neto, IEC,
 * IVA), manda lo que se vio, y no hay un segundo diálogo.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StatementPreview } from "@/lib/combustibles/statements-preview"

const mockCreate = vi.hoisted(() => vi.fn())
const mockPreview = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock("../../actions-module/statements", () => ({
  createMonthlyStatementAction: mockCreate,
  previewMonthlyStatementAction: mockPreview,
}))
vi.mock("@/lib/toast", () => ({ toast: mockToast }))

import { NewStatementDialog } from "./new-statement-dialog"

const preview = (overrides: Partial<StatementPreview> = {}): StatementPreview => ({
  month: "2020-09", fuelSupplierId: "sup-1", supplierName: "Otro proveedor",
  loads: 64, firstLoadDate: "2020-09-01", lastLoadDate: "2020-09-30", equipmentCount: 12,
  totals: { totalLiters: 9410, totalBaseAmount: 9_780_000, totalIec: 2_180_000, totalIva: 2_270_000, totalAmount: 14_230_000 },
  existing: null, excluded: { draft: 0, cancelled: 0, alreadyInStatement: 0 }, monthInProgress: false,
  ...overrides,
})

const suppliers = [{ id: "sup-1", name: "Otro proveedor" }, { id: "sup-2", name: "Copec" }]

async function openRowDialog() {
  render(<NewStatementDialog suppliers={suppliers} defaultMonth="2020-09" defaultSupplierId="sup-1" trigger="row" />)
  fireEvent.click(screen.getByRole("button", { name: /crear el estado de cuenta de otro proveedor de septiembre 2020/i }))
  return { dialog: await screen.findByRole("dialog", { name: "Crear estado de cuenta" }) }
}

describe("NewStatementDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPreview.mockResolvedValue({ ok: true, data: { preview: preview() } })
  })

  it("al abrir pide la vista previa del mes y proveedor y muestra lo que entra", async () => {
    const { dialog } = await openRowDialog()

    await waitFor(() => expect(within(dialog).getByText(/^Entran/)).toBeInTheDocument())
    expect(mockPreview).toHaveBeenCalledWith({ month: "2020-09", fuelSupplierId: "sup-1" })
    const text = dialog.textContent ?? ""
    expect(text).toContain("64 cargas")
    expect(text).toContain("12 equipos")
    expect(text).toContain("01-09-2020 al 30-09-2020")
    for (const figure of ["$9.780.000", "$2.180.000", "$2.270.000", "$14.230.000"]) expect(text).toContain(figure)
  })

  it("el botón de crear es la confirmación: sale con las cargas y manda lo que se vio", async () => {
    const { dialog } = await openRowDialog()

    const create = await within(dialog).findByRole("button", { name: "Crear con 64 cargas" })
    expect(create).toBeEnabled()
    expect(dialog.querySelector<HTMLInputElement>('input[name="expectedLoadCount"]')?.value).toBe("64")
    expect(dialog.querySelector<HTMLInputElement>('input[name="expectedTotalAmount"]')?.value).toBe("14230000")
    expect(dialog.querySelector<HTMLInputElement>('input[name="month"]')?.value).toBe("2020-09")
    expect(dialog.querySelector<HTMLInputElement>('input[name="fuelSupplierId"]')?.value).toBe("sup-1")
  })

  it("no se puede crear antes de ver la vista previa", async () => {
    // Una respuesta que se hace esperar, y que se libera al final: una promesa que nunca se resuelve dejaría trabada la cola de acciones de React para las pruebas siguientes.
    let release: (value: unknown) => void = () => {}
    mockPreview.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const { dialog } = await openRowDialog()

    expect(within(dialog).getByText(/calculando lo que entra/i)).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Crear estado de cuenta" })).toBeDisabled()

    release({ ok: true, data: { preview: preview() } })
    expect(await within(dialog).findByRole("button", { name: "Crear con 64 cargas" })).toBeEnabled()
  })

  it("si ya existe, dice cuánto se pagó, enlaza al existente y no deja crear otro", async () => {
    mockPreview.mockResolvedValue({
      ok: true,
      data: { preview: preview({ loads: 0, existing: { id: "st-9", status: "partial", totalAmount: 14_230_000, paidAmount: 5_830_000, pendingAmount: 8_400_000, dueDate: "2020-10-05" } }) },
    })
    const { dialog } = await openRowDialog()

    expect(await within(dialog).findByText(/ya existe el estado de cuenta/i)).toBeInTheDocument()
    expect(dialog.textContent).toContain("$5.830.000")
    expect(within(dialog).getByRole("link", { name: "Abrirlo" })).toHaveAttribute("href", "/combustibles/pagos/estados/st-9")
    expect(within(dialog).getByRole("button", { name: "Crear estado de cuenta" })).toBeDisabled()
    expect(dialog.querySelector('input[name="expectedLoadCount"]')).toBeNull()
  })

  it("un mes sin cargas se dice y no deja crear; lo que no entra se explica", async () => {
    mockPreview.mockResolvedValue({ ok: true, data: { preview: preview({ loads: 0, firstLoadDate: null, lastLoadDate: null, excluded: { draft: 2, cancelled: 1, alreadyInStatement: 0 } }) } })
    const { dialog } = await openRowDialog()

    expect(await within(dialog).findByText(/no hay cargas facturadas sin estado de cuenta/i)).toBeInTheDocument()
    expect(dialog.textContent).toContain("2 en borrador, 1 anulada")
    expect(within(dialog).getByRole("button", { name: "Crear estado de cuenta" })).toBeDisabled()
  })

  it("avisa si el mes todavía no termina", async () => {
    mockPreview.mockResolvedValue({ ok: true, data: { preview: preview({ monthInProgress: true }) } })
    const { dialog } = await openRowDialog()

    expect(await within(dialog).findByText(/el mes todavía no termina/i)).toBeInTheDocument()
  })

  it("si la vista previa falla, lo dice y no deja crear", async () => {
    mockPreview.mockResolvedValue({ ok: false, message: "No se pudo armar la vista previa" })
    const { dialog } = await openRowDialog()

    expect(await within(dialog).findByText("No se pudo armar la vista previa")).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Crear estado de cuenta" })).toBeDisabled()
  })

  it("al confirmar crea con lo que se vio, avisa y cierra", async () => {
    mockCreate.mockResolvedValue({ ok: true, message: "Estado de cuenta creado con 64 cargas", data: { id: "st-new" } })
    const { dialog } = await openRowDialog()

    fireEvent.click(await within(dialog).findByRole("button", { name: "Crear con 64 cargas" }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    const form = mockCreate.mock.calls[0]![1] as FormData
    expect(Object.fromEntries([...form.entries()].filter(([key]) => ["month", "fuelSupplierId", "expectedLoadCount", "expectedTotalAmount"].includes(key)))).toEqual({
      month: "2020-09", fuelSupplierId: "sup-1", expectedLoadCount: "64", expectedTotalAmount: "14230000",
    })
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Estado de cuenta creado con 64 cargas"))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("si las cargas cambiaron, no cierra: muestra el aviso y recalcula la vista previa", async () => {
    mockCreate.mockResolvedValue({ ok: false, message: "Las cargas de este mes cambiaron mientras revisabas. Mira la vista previa de nuevo antes de crear el estado de cuenta." })
    const { dialog } = await openRowDialog()
    fireEvent.click(await within(dialog).findByRole("button", { name: "Crear con 64 cargas" }))
    mockPreview.mockResolvedValue({ ok: true, data: { preview: preview({ loads: 65, totals: { totalLiters: 9500, totalBaseAmount: 9_900_000, totalIec: 2_200_000, totalIva: 2_300_000, totalAmount: 14_400_000 } }) } })

    expect(await within(dialog).findByText(/cambiaron mientras revisabas/i)).toBeInTheDocument()
    expect(mockToast.success).not.toHaveBeenCalled()
  })
})
