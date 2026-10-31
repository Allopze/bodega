// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ImportedFileRow } from "./imported-files"

const mocks = vi.hoisted(() => ({
  revertBatch: vi.fn(),
  revertOperations: vi.fn(),
  revertControl: vi.fn(),
  revertSeals: vi.fn(),
  exportRejections: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock("@/lib/toast", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }))
vi.mock("../actions-consumos", () => ({ revertBatchAction: mocks.revertBatch }))
vi.mock("../actions-operaciones-batch", () => ({ revertBatchOperationsAction: mocks.revertOperations }))
vi.mock("../control/importar/actions", () => ({ revertControlImportBatchAction: mocks.revertControl, exportBatchRejectionsAction: mocks.exportRejections }))
vi.mock("../tae/importar/actions", () => ({ revertTaeImportBatchAction: mocks.revertSeals }))

import { fileResult, ImportedFilesTable } from "./imported-files-table"

function row(overrides: Partial<ImportedFileRow>): ImportedFileRow {
  return {
    key: "planilla:p-1", kind: "planilla", id: "p-1", fileName: "consolidado.xlsx", createdAt: "2026-10-28T20:02:00.000Z", importedBy: "Paula Soto",
    worksite: null, source: null, period: { from: "2026-10-01", to: "2026-10-28" }, newRows: 1228, updatedRows: null, rejectedRows: 12,
    status: "importado", href: "/combustibles/fuentes/archivos/planilla/p-1", canRevert: true, ...overrides,
  }
}

/** Las dos representaciones (tarjetas y tabla) conviven en el DOM: se busca en la tabla de escritorio. */
const desktop = () => within(screen.getByRole("table", { hidden: true }))

describe("fileResult", () => {
  it("resume lo que trajo el archivo en una frase corta", () => {
    expect(fileResult({ newRows: 1228, updatedRows: null, rejectedRows: 12 })).toBe("1.228 nuevas · 12 rechazadas")
    expect(fileResult({ newRows: 1, updatedRows: 1, rejectedRows: 1 })).toBe("1 nueva · 1 actualizada · 1 rechazada")
    expect(fileResult({ newRows: 580, updatedRows: 0, rejectedRows: 0 })).toBe("580 nuevas")
    expect(fileResult({ newRows: null, updatedRows: null, rejectedRows: null })).toBe("—")
  })
})

describe("ImportedFilesTable", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.revertOperations.mockResolvedValue({ ok: true, message: "Archivo revertido" })
    mocks.revertControl.mockResolvedValue({ ok: true, message: "Archivo revertido" })
  })
  afterEach(() => cleanup())

  it("muestra qué era, cuándo, quién y lo que trajo, con un enlace al detalle", () => {
    render(<ImportedFilesTable rows={[row({})]} />)
    const table = desktop()
    expect(table.getByText("Planilla de cargas")).toBeInTheDocument()
    expect(table.getByText("consolidado.xlsx")).toBeInTheDocument()
    expect(table.getByText("1.228 nuevas · 12 rechazadas")).toBeInTheDocument()
    expect(table.getByText("Paula Soto")).toBeInTheDocument()
    expect(table.getByText("Importado")).toBeInTheDocument()
    expect(table.getByRole("link", { name: "Ver el detalle de consolidado.xlsx" })).toHaveAttribute("href", "/combustibles/fuentes/archivos/planilla/p-1")
  })

  it("revertir pide confirmación, explica lo que borra y sólo entonces llama a la acción de su tipo", async () => {
    render(<ImportedFilesTable rows={[row({})]} />)
    fireEvent.click(desktop().getByRole("button", { name: "Revertir consolidado.xlsx" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/se recalculará el rendimiento de los equipos afectados/)).toBeInTheDocument()
    expect(mocks.revertOperations).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole("button", { name: "Revertir archivo" }))
    await waitFor(() => expect(mocks.revertOperations).toHaveBeenCalledTimes(1))
    const formData = mocks.revertOperations.mock.calls[0]![1] as FormData
    expect(formData.get("batchId")).toBe("p-1")
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Archivo revertido")
  })

  it("cancelar no revierte nada", async () => {
    render(<ImportedFilesTable rows={[row({})]} />)
    fireEvent.click(desktop().getByRole("button", { name: "Revertir consolidado.xlsx" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }))
    expect(mocks.revertOperations).not.toHaveBeenCalled()
  })

  it("si la acción falla, el motivo queda dentro del diálogo, que sigue abierto", async () => {
    mocks.revertOperations.mockResolvedValue({ ok: false, message: "Este lote ya fue revertido" })
    render(<ImportedFilesTable rows={[row({})]} />)
    fireEvent.click(desktop().getByRole("button", { name: "Revertir consolidado.xlsx" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Revertir archivo" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Este lote ya fue revertido")
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it("sin permiso o con el archivo ya revertido no se ofrece «Revertir»", () => {
    render(<ImportedFilesTable rows={[row({ canRevert: false }), row({ key: "planilla:p-2", id: "p-2", fileName: "viejo.xlsx", status: "revertido", canRevert: false })]} />)
    expect(desktop().queryByRole("button", { name: /Revertir/ })).toBeNull()
    expect(desktop().getByText("Revertido")).toBeInTheDocument()
  })

  it("las importaciones del control no tienen ficha: ofrecen los rechazos en línea y se revierten con su acción", async () => {
    render(<ImportedFilesTable rows={[row({ key: "telemetria:c-1", kind: "telemetria", id: "c-1", fileName: "visionlink.xlsx", period: null, newRows: 580, updatedRows: 10, rejectedRows: 10, href: null })]} />)
    const table = desktop()
    expect(table.queryByRole("link", { name: /Ver el detalle/ })).toBeNull()
    expect(table.getByRole("button", { name: "Descargar los rechazos de visionlink.xlsx" })).toBeInTheDocument()

    fireEvent.click(table.getByRole("button", { name: "Revertir visionlink.xlsx" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/Se eliminarán las 580 filas que «visionlink.xlsx» creó\. Las 10 que sólo actualizó conservan los valores nuevos/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Revertir archivo" }))
    await waitFor(() => expect(mocks.revertControl).toHaveBeenCalledWith({ batchId: "c-1" }))
  })

  it("el histórico de sellos se revierte con la acción de sellos", async () => {
    mocks.revertSeals.mockResolvedValue({ ok: true, message: "Archivo revertido: 3 cargas eliminadas" })
    render(<ImportedFilesTable rows={[row({ key: "sellos:s-1", kind: "sellos", id: "s-1", fileName: "sellos.xlsx", period: null })]} />)
    fireEvent.click(desktop().getByRole("button", { name: "Revertir sellos.xlsx" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Revertir archivo" }))
    await waitFor(() => expect(mocks.revertSeals).toHaveBeenCalledWith("s-1"))
  })
})
