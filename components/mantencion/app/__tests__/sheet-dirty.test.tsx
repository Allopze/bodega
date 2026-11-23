// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { readFileSync } from "node:fs"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ENTRY, UUID, account, catalog, equipment, freshDb, workOrder } from "@/lib/mantencion/client/__tests__/fixtures"
import { buildRows, type WorkshopEntry } from "@/lib/mantencion/client/fleet-view"
import { buildOtViews } from "@/lib/mantencion/client/ot-model"
import type { StoredCatalog } from "@/lib/mantencion/client/types"
import type { CatalogObservation, CatalogWorkOrder } from "@/lib/mantencion/contracts"
import { AppActionsProvider, AppDataProvider, type AppActions, type AppData } from "../app-context"
import { Sheet } from "../dialog"
import { ObservationSheet } from "../observation-sheet"
import { OtSheet } from "../ot-sheet"
import { WorkshopSheet } from "../workshop-sheet"

const USER = { id: "u-1", name: "Javier Roa" }
const ASK = "¿Descartar lo que escribiste?"

function stored(workOrders: CatalogWorkOrder[] = []): StoredCatalog {
  return { userId: "u-1", etag: '"v1"', fetchedAt: "2026-10-28T12:00:00.000Z", catalog: { ...catalog("u-1", [equipment()]), workOrders }, others: null }
}

function withApp(node: React.ReactNode, catalogStored: StoredCatalog = stored()) {
  const data: AppData = {
    deviceId: UUID(900), appVersion: "test", account: account("u-1"), accounts: [account("u-1")], stored: catalogStored,
    rows: buildRows(catalogStored, []), queue: [], online: true, now: Date.now(),
  }
  const actions: AppActions = { syncNow: vi.fn(), refreshCatalog: vi.fn(async () => "unchanged" as const), toast: vi.fn() }
  return render(<AppDataProvider value={data}><AppActionsProvider value={actions}>{node}</AppActionsProvider></AppDataProvider>)
}

const backdrop = () => document.querySelector<HTMLElement>(".sheetbg")!
const tapBackdrop = () => fireEvent.click(backdrop())
const pressEsc = () => fireEvent.keyDown(document, { key: "Escape" })
const asking = () => screen.queryByRole("alertdialog", { name: ASK })

function openOt(order: CatalogWorkOrder, onClose = vi.fn()) {
  const base = stored([order])
  const view = buildOtViews(base.catalog, [], USER).mine[0]!
  withApp(<OtSheet view={view} onClose={onClose} onRegister={() => {}} />, base)
  return onClose
}

beforeEach(async () => {
  await freshDb()
  document.body.innerHTML = '<div id="mant-content"></div><div id="mant-modals"></div>'
})
afterEach(cleanup)

describe("Sheet: no se cierra sola con algo escrito", () => {
  it("sin `dirty`, el fondo y Esc cierran directo", () => {
    const onClose = vi.fn()
    withApp(<Sheet title="Hoja" onClose={onClose}><button type="button">Algo</button></Sheet>)
    tapBackdrop()
    expect(onClose).toHaveBeenCalledTimes(1)
    pressEsc()
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(asking()).toBeNull()
  })

  it("con `dirty`, el fondo pregunta en vez de cerrar", () => {
    const onClose = vi.fn()
    withApp(<Sheet title="Hoja" onClose={onClose} dirty><button type="button">Algo</button></Sheet>)
    tapBackdrop()
    expect(asking()).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("con `dirty`, Esc pregunta; una segunda Esc responde «Seguir editando» y la hoja sigue abierta", async () => {
    const onClose = vi.fn()
    withApp(<Sheet title="Hoja" onClose={onClose} dirty><button type="button">Algo</button></Sheet>)
    pressEsc()
    expect(asking()).toBeTruthy()
    pressEsc()
    await waitFor(() => expect(asking()).toBeNull())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog", { name: "Hoja" })).toBeTruthy()
  })

  it("«Seguir editando» conserva la hoja, devuelve el foco y deja el fondo activo", async () => {
    const onClose = vi.fn()
    withApp(<Sheet title="Hoja" onClose={onClose} dirty><button type="button">Algo</button></Sheet>)
    const inside = screen.getByRole("button", { name: "Algo" })
    inside.focus()
    tapBackdrop()
    expect(screen.getByRole("button", { name: "Seguir editando" })).toBe(document.activeElement)
    expect(backdrop().hasAttribute("inert")).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }))
    await waitFor(() => expect(document.activeElement).toBe(inside))
    expect(backdrop().hasAttribute("inert")).toBe(false)
    expect(asking()).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("«Descartar» llama a onClose", () => {
    const onClose = vi.fn()
    withApp(<Sheet title="Hoja" onClose={onClose} dirty><button type="button">Algo</button></Sheet>)
    tapBackdrop()
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("la confirmación atrapa el Tab dentro de sus dos botones", () => {
    // jsdom no calcula el layout: sin esto `offsetParent` es siempre null y nada cuenta como visible.
    const layout = vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(document.body)
    withApp(<Sheet title="Hoja" onClose={() => {}} dirty><button type="button">Algo</button></Sheet>)
    tapBackdrop()
    const keep = screen.getByRole("button", { name: "Seguir editando" })
    const discard = screen.getByRole("button", { name: "Descartar" })
    discard.focus()
    fireEvent.keyDown(document, { key: "Tab" })
    expect(document.activeElement).toBe(keep)
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(discard)
    layout.mockRestore()
  })
})

describe("cada hoja con formulario avisa cuando hay algo escrito", () => {
  it("OtItemsEditor: sin cambios el fondo cierra; al marcar un ítem pregunta", () => {
    const order = workOrder({ status: "en_ejecucion", entry: ENTRY })
    const onClose = openOt(order)
    fireEvent.click(screen.getByRole("button", { name: /Marcar ítems SÍ \/ NO/ }))
    tapBackdrop()
    expect(onClose).toHaveBeenCalledTimes(1)
    cleanup()
    document.body.innerHTML = '<div id="mant-content"></div><div id="mant-modals"></div>'

    const again = openOt(order)
    fireEvent.click(screen.getByRole("button", { name: /Marcar ítems SÍ \/ NO/ }))
    fireEvent.click(screen.getAllByRole("button", { name: "SÍ" })[0]!)
    tapBackdrop()
    expect(asking()).toBeTruthy()
    expect(again).not.toHaveBeenCalled()
  })

  it("OtItemsEditor: «Volver» con cambios pregunta y «Descartar» vuelve a la OT", async () => {
    openOt(workOrder({ status: "en_ejecucion", entry: ENTRY }))
    fireEvent.click(screen.getByRole("button", { name: /Marcar ítems SÍ \/ NO/ }))
    fireEvent.click(screen.getAllByRole("button", { name: "NO" })[0]!)
    fireEvent.click(screen.getByRole("button", { name: "Volver" }))
    expect(asking()).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Guardar marcas" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Guardar marcas" })).toBeNull())
    expect(screen.getByRole("button", { name: /Marcar ítems SÍ \/ NO/ })).toBeTruthy()
  })

  it("OtItemsEditor: un ítem a medio escribir también cuenta", () => {
    openOt(workOrder({ status: "en_ejecucion", entry: ENTRY }))
    fireEvent.click(screen.getByRole("button", { name: /Marcar ítems SÍ \/ NO/ }))
    fireEvent.change(screen.getByLabelText("Agregar ítem a «Mantenciones solicitadas o asignadas en taller»"), { target: { value: "Rev" } })
    tapBackdrop()
    expect(asking()).toBeTruthy()
  })

  it("OtEntryForm: al elegir el tipo de taller pregunta", () => {
    const onClose = openOt(workOrder())
    fireEvent.click(screen.getByRole("button", { name: "Registrar ingreso a taller" }))
    tapBackdrop()
    expect(onClose).toHaveBeenCalledTimes(1)
    cleanup()
    document.body.innerHTML = '<div id="mant-content"></div><div id="mant-modals"></div>'

    const again = openOt(workOrder())
    fireEvent.click(screen.getByRole("button", { name: "Registrar ingreso a taller" }))
    fireEvent.click(screen.getByRole("button", { name: "Interno" }))
    tapBackdrop()
    expect(asking()).toBeTruthy()
    expect(again).not.toHaveBeenCalled()
  })

  it("Cambiar fecha de entrega: escribir el motivo pregunta", () => {
    openOt(workOrder({ status: "en_ejecucion", entry: ENTRY }))
    fireEvent.click(screen.getByRole("button", { name: "Cambiar fecha de entrega" }))
    fireEvent.change(screen.getByLabelText("Motivo del cambio"), { target: { value: "Falta un repuesto" } })
    pressEsc()
    expect(asking()).toBeTruthy()
  })

  it("WorkshopSheet: elegir una opción pregunta, y «Cancelar» también", async () => {
    const entry: WorkshopEntry = {
      vehicleId: "veh-1", recordId: "r1", workOrderId: null, worksiteId: "w1", equipmentCode: "KA-140", equipmentPlate: "SGCP-84",
      folio: "MC-BIO-0003", entryDate: "2026-10-20", lastActivityDate: "2026-10-20", stale: false, daysStopped: 2,
    }
    const onClose = vi.fn()
    withApp(<WorkshopSheet entry={entry} onClose={onClose} />)
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "Sigue en taller" }))
    tapBackdrop()
    expect(asking()).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }))
    await waitFor(() => expect(asking()).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(asking()).toBeTruthy()
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it("ObservationSheet: una respuesta a medias pregunta al cerrar", () => {
    const observation: CatalogObservation = { id: "o1", recordId: "r1", folio: "MC-BIO-0003", equipmentCode: "KA-140", text: "Falta la foto del cárter", by: "Marcela Soto", createdAt: "2026-10-28T12:00:00.000Z", response: null }
    const onClose = vi.fn()
    withApp(<ObservationSheet observations={[observation]} onClose={onClose} />)
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByLabelText("Tu respuesta"), { target: { value: "Ya la subí" } })
    tapBackdrop()
    expect(asking()).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe("aviso breve (.toast)", () => {
  it("no recibe toques y queda por encima del pie fijo", () => {
    const css = readFileSync("app/(mecanico)/mant-app.css", "utf8")
    const rule = (selector: string) => css.split("\n").find((line) => line.startsWith(`${selector} {`)) ?? ""
    const toast = rule(".toast")
    expect(toast).toContain("pointer-events: none")
    const bottom = /bottom: calc\((\d+)px \+ env\(safe-area-inset-bottom\)\)/.exec(toast)
    // .foot: 10px de relleno + botón de 56px + 16px + 1px de borde.
    expect(Number(bottom?.[1])).toBeGreaterThanOrEqual(10 + 56 + 16 + 1)
  })
})
