// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { RecordListRow } from "@/lib/services/mantencion/records-query"

const markRecordsReviewedAction = vi.hoisted(() => vi.fn())
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }))
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router }))
vi.mock("@/app/(app)/mantencion/registros/[id]/actions", () => ({ markRecordsReviewedAction }))
vi.mock("@/lib/toast", () => ({ toast: toastMock }))

const { RecordSelectionProvider, RecordsBulkBar, RecordsSelectAll } = await import("./record-selection")
const { RecordsTable } = await import("./records-table")

const equipment = { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Biodiversa", unit: "km" as const }

function row(id: string, overrides: Partial<RecordListRow> = {}): RecordListRow {
  return {
    id, folio: `MP-${id}`, kind: "P", vehicleId: "veh-1", equipment, worksiteName: "Biodiversa", reading: 40_312, unit: "km",
    workDate: "2026-10-27", signedAt: "2026-10-27T15:00:00.000Z", receivedAt: "2026-10-27T15:01:00.000Z", status: "vigente", review: "pendiente",
    intervalValue: 40_000, executorKind: "yo", executorName: "Javier Roa", registeredById: "u-1", registeredByName: "Javier Roa", notDoneCount: 0,
    alerts: { jump: false, outOfWorksite: false, manualSchedule: false, duplicate: false }, workshop: null, ...overrides,
  }
}

const ROWS = [
  row("1"),
  row("2", { review: "observado" }),
  row("3", { review: "revisado" }),
  row("4", { status: "anulado" }),
]

function renderList(rows = ROWS, selectable = true) {
  return render(
    <RecordSelectionProvider rows={rows.map((item) => ({ id: item.id, status: item.status, review: item.review }))}>
      <RecordsBulkBar />
      <RecordsSelectAll />
      <RecordsTable rows={rows} sort="fecha" dir="desc" sortHref={() => "/x"} listQuery="" selectable={selectable} />
    </RecordSelectionProvider>,
  )
}

/** La tabla y las tarjetas conviven en el DOM: se mira cada una por separado. */
const table = () => within(screen.getByRole("region", { name: "Registros de mantención" }))
const cards = () => within(screen.getByRole("list", { name: "Registros de mantención como tarjetas" }))

beforeEach(() => {
  markRecordsReviewedAction.mockResolvedValue({ ok: true, message: "2 registros marcados como revisados", data: { marked: 2, markedIds: ["1", "2"], skipped: [] } })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("elegir registros para revisarlos en lote", () => {
  it("sólo los que admiten revisión llevan casilla: ni el ya revisado ni el anulado", () => {
    renderList()
    expect(table().getAllByRole("checkbox", { name: /^Elegir el registro/ }).map((box) => box.closest("label")?.textContent)).toEqual([
      "Elegir el registro MP-1", "Elegir el registro MP-2",
    ])
    expect(table().queryByRole("checkbox", { name: "Elegir el registro MP-3" })).toBeNull()
    expect(table().queryByRole("checkbox", { name: "Elegir el registro MP-4" })).toBeNull()
  })

  it("funciona también en las tarjetas, y la tabla y las tarjetas marcan lo mismo", () => {
    renderList()
    fireEvent.click(cards().getByRole("checkbox", { name: "Elegir el registro MP-1" }))
    expect((table().getByRole("checkbox", { name: "Elegir el registro MP-1" }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByRole("region", { name: "Registros elegidos" }).textContent).toContain("1 registro elegido")
    fireEvent.click(table().getByRole("checkbox", { name: "Elegir el registro MP-1" }))
    expect(screen.queryByRole("region", { name: "Registros elegidos" })).toBeNull()
  })

  it("«Seleccionar todos los de esta página» elige sólo los que admiten revisión y se puede quitar", () => {
    renderList()
    const all = screen.getByRole("checkbox", { name: "Seleccionar todos los de esta página" }) as HTMLInputElement
    fireEvent.click(all)
    expect(screen.getByRole("button", { name: "Marcar 2 como revisados" })).toBeDefined()
    fireEvent.click(all)
    expect(screen.queryByRole("button", { name: /Marcar .* como revisad/ })).toBeNull()
  })

  it("marcar no pide confirmación: envía los ids, avisa con el mensaje del servidor, limpia y refresca", async () => {
    renderList()
    fireEvent.click(screen.getByRole("checkbox", { name: "Seleccionar todos los de esta página" }))
    fireEvent.click(screen.getByRole("button", { name: "Marcar 2 como revisados" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    await waitFor(() => expect(markRecordsReviewedAction).toHaveBeenCalledWith({ recordIds: ["1", "2"] }))
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("2 registros marcados como revisados"))
    expect(router.refresh).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole("region", { name: "Registros elegidos" })).toBeNull())
  })

  it("si no se marcó ninguno avisa como información, no como éxito", async () => {
    markRecordsReviewedAction.mockResolvedValue({ ok: true, message: "No se marcó ninguno: 1 ya estaba revisado", data: { marked: 0, markedIds: [], skipped: [] } })
    renderList()
    fireEvent.click(table().getByRole("checkbox", { name: "Elegir el registro MP-1" }))
    fireEvent.click(screen.getByRole("button", { name: "Marcar 1 como revisado" }))
    await waitFor(() => expect(toastMock.info).toHaveBeenCalledWith("No se marcó ninguno: 1 ya estaba revisado"))
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it("si el servidor rechaza el lote, muestra el error y conserva la selección", async () => {
    markRecordsReviewedAction.mockResolvedValue({ ok: false, message: "No tienes permiso para marcar registros como revisados." })
    renderList()
    fireEvent.click(table().getByRole("checkbox", { name: "Elegir el registro MP-1" }))
    fireEvent.click(screen.getByRole("button", { name: "Marcar 1 como revisado" }))
    expect((await screen.findByRole("alert")).textContent).toContain("No tienes permiso")
    expect(screen.getByRole("region", { name: "Registros elegidos" })).toBeDefined()
    expect(router.refresh).not.toHaveBeenCalled()
  })

  it("sin proveedor (quien no revisa) o sin `selectable` no hay casillas", () => {
    render(<RecordsTable rows={ROWS} sort="fecha" dir="desc" sortHref={() => "/x"} listQuery="" />)
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
    cleanup()
    renderList(ROWS, false)
    expect(screen.queryAllByRole("checkbox", { name: /^Elegir el registro/ })).toHaveLength(0)
  })
})
