// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UUID, account, catalog, freePartsNoteItem, freshDb, ownNote } from "@/lib/mantencion/client/__tests__/fixtures"
import { buildRows } from "@/lib/mantencion/client/fleet-view"
import { buildMyNotes } from "@/lib/mantencion/client/parts-notes-model"
import { enqueueSimple, listQueue } from "@/lib/mantencion/client/queue"
import type { QueueItem, StoredCatalog } from "@/lib/mantencion/client/types"
import type { CatalogPartsNote } from "@/lib/mantencion/contracts"
import { AppActionsProvider, AppDataProvider, type AppActions, type AppData } from "../app-context"
import { MyNotesSheet } from "../my-notes-sheet"

const actions = (): AppActions => ({ syncNow: vi.fn(), refreshCatalog: vi.fn(async () => "unchanged" as const), toast: vi.fn() })
const LINE = (overrides: Partial<CatalogPartsNote["lines"][number]> = {}): CatalogPartsNote["lines"][number] => ({
  id: "l-1", description: "Filtro de aceite", quantity: 5, unit: "unidad", partNumber: null, stage: "pedido", arrived: 0, used: 0, rejectionReason: null, ...overrides,
})

function renderNotes(notes: CatalogPartsNote[], queue: QueueItem[] = []) {
  const stored: StoredCatalog = { userId: "u-1", etag: '"v1"', fetchedAt: "2026-10-28T12:00:00.000Z", catalog: { ...catalog("u-1"), ownPartsNotes: notes }, others: null }
  const data: AppData = {
    deviceId: UUID(900), appVersion: "test", account: account("u-1"), accounts: [account("u-1")], stored,
    rows: buildRows(stored, queue), queue, online: true, now: Date.parse("2026-10-28T18:00:00.000Z"),
  }
  render(
    <AppDataProvider value={data}>
      <AppActionsProvider value={actions()}>
        <div id="mant-content" />
        <MyNotesSheet notes={buildMyNotes(stored.catalog, queue, "u-1")} onClose={() => {}} />
      </AppActionsProvider>
    </AppDataProvider>,
  )
}

const sheet = () => within(screen.getByRole("dialog", { name: "Mis notas" }))

beforeEach(async () => {
  await freshDb()
  document.body.innerHTML = '<div id="mant-modals"></div>'
})
afterEach(cleanup)

describe("hoja «Mis notas»", () => {
  it("sin notas explica dónde se piden", () => {
    renderNotes([])
    expect(sheet().getByText(/Todavía no pediste repuestos/)).toBeTruthy()
  })

  it("cada nota dice su estado con palabras, su faena u OT, y el avance de cada línea («Llegó 2 de 5»)", () => {
    renderNotes([
      ownNote({
        id: "a", code: "NP-2026-0101", status: "recibida_parcial", urgent: true, createdAt: "2026-10-28T17:00:00.000Z",
        lines: [LINE({ id: "a1", description: "Filtro de aceite", quantity: 5, stage: "en_bodega", arrived: 2 }), LINE({ id: "a2", description: "Correa", quantity: 1, stage: "en_compra" })],
      }),
      ownNote({
        id: "b", code: "NP-2026-0100", status: "en_gestion", workOrderId: "ot-1", workOrderFolio: "OT-BIO-0001", equipmentCode: "KA-140", equipmentPlate: "SGCP-84", createdAt: "2026-10-27T10:00:00.000Z",
        lines: [LINE({ id: "b1", description: "Manguera", stage: "pedido" })],
      }),
    ])
    const first = within(sheet().getByRole("region", { name: "NP-2026-0101" }))
    expect(first.getByText("Llegó una parte")).toBeTruthy()
    expect(first.getByText("Urgente")).toBeTruthy()
    expect(first.getByText("Sin OT · Biodiversa")).toBeTruthy()
    expect(first.getByText("Llegó 2 de 5")).toBeTruthy()
    expect(first.getByText("En compra")).toBeTruthy()
    expect(first.getByText("hoy 14:00")).toBeTruthy()

    const second = within(sheet().getByRole("region", { name: "NP-2026-0100" }))
    expect(second.getByText("En gestión")).toBeTruthy()
    expect(second.getByText("KA-140 · SGCP-84 · OT-BIO-0001")).toBeTruthy()
    expect(second.getByText("Pedido")).toBeTruthy()
  })

  it("una nota en espera muestra el motivo de la espera, sin tener que abrir nada", () => {
    renderNotes([ownNote({ id: "a", code: "NP-2026-0101", status: "en_espera", statusReason: "Esperando la cotización del proveedor" })])
    const note = within(sheet().getByRole("region", { name: "NP-2026-0101" }))
    expect(note.getByText("En espera", { selector: ".dtag" })).toBeTruthy()
    expect(note.getByText("Motivo de la espera: Esperando la cotización del proveedor")).toBeTruthy()
  })

  it("una nota rechazada muestra su motivo, y una línea rechazada de una nota abierta, el suyo", () => {
    renderNotes([
      ownNote({ id: "a", code: "NP-2026-0101", status: "rechazada", createdAt: "2026-10-28T09:00:00.000Z", lines: [LINE({ id: "a1", stage: "rechazado", rejectionReason: "Ya hay en bodega" })] }),
      ownNote({ id: "b", code: "NP-2026-0102", status: "en_gestion", createdAt: "2026-10-28T10:00:00.000Z", lines: [LINE({ id: "b1", description: "Pastillas", stage: "rechazado", rejectionReason: "No es compatible" }), LINE({ id: "b2", description: "Correa", stage: "pedido" })] }),
    ])
    // La rechazada ya está cerrada: vive en el plegable.
    const open = within(sheet().getByRole("region", { name: "NP-2026-0102" }))
    expect(open.getByText("Rechazado: No es compatible")).toBeTruthy()
    fireEvent.click(sheet().getByRole("button", { name: /Cerradas, rechazadas y anuladas \(1\)/ }))
    const rejected = within(sheet().getByRole("region", { name: "NP-2026-0101" }))
    expect(rejected.getByText("Rechazada", { selector: ".dtag" })).toBeTruthy()
    expect(rejected.getByText("Motivo: Ya hay en bodega")).toBeTruthy()
  })

  it("las cerradas, rechazadas y anuladas van plegadas; las abiertas, a la vista", () => {
    renderNotes([
      ownNote({ id: "a", code: "NP-2026-0101", status: "en_compra", createdAt: "2026-10-28T09:00:00.000Z" }),
      ownNote({ id: "b", code: "NP-2026-0102", status: "cerrada", createdAt: "2026-10-28T10:00:00.000Z" }),
      ownNote({ id: "c", code: "NP-2026-0103", status: "anulada", statusReason: "Se pidió dos veces", createdAt: "2026-10-28T11:00:00.000Z" }),
    ])
    expect(sheet().getByRole("region", { name: "NP-2026-0101" })).toBeTruthy()
    expect(sheet().queryByRole("region", { name: "NP-2026-0102" })).toBeNull()
    const toggle = sheet().getByRole("button", { name: /Cerradas, rechazadas y anuladas \(2\)/ })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(sheet().getByRole("region", { name: "NP-2026-0102" })).toBeTruthy()
    expect(within(sheet().getByRole("region", { name: "NP-2026-0103" })).getByText("Motivo: Se pidió dos veces")).toBeTruthy()
  })

  it("un pedido que sólo está en el teléfono sale «Por enviar» y su línea también", async () => {
    const pending = freePartsNoteItem(1, { urgent: true })
    renderNotes([], [pending])
    const card = within(sheet().getByRole("region", { name: "Pedido de repuestos" }))
    expect(card.getByText("Por enviar", { selector: ".dtag" })).toBeTruthy()
    expect(card.getByText("Por enviar", { selector: ".pst" })).toBeTruthy()
    expect(card.getByText("Urgente")).toBeTruthy()
    expect(card.getByText("Rodamiento 6205")).toBeTruthy()
  })

  it("un envío rechazado dice su motivo y «Entendido» lo saca de la cola", async () => {
    const rejected = { ...freePartsNoteItem(1), status: "rejected" as const, lastError: "Esa faena no es de tu alcance." }
    await enqueueSimple(rejected)
    renderNotes([], [rejected])
    const card = within(sheet().getByRole("region", { name: "Pedido de repuestos" }))
    expect(card.getByText("No se pudo enviar")).toBeTruthy()
    expect(card.getByText("Motivo: Esa faena no es de tu alcance.")).toBeTruthy()
    fireEvent.click(card.getByRole("button", { name: "Entendido" }))
    await waitFor(async () => expect((await listQueue()).some((item) => item.type === "parts_note")).toBe(false))
  })
})
