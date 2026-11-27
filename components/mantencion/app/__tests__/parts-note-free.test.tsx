// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UUID, account, catalog, equipment, freePartsNoteItem, freshDb, ownNote } from "@/lib/mantencion/client/__tests__/fixtures"
import { buildRows } from "@/lib/mantencion/client/fleet-view"
import { enqueueSimple, listQueue } from "@/lib/mantencion/client/queue"
import type { QueueItem, QueuePartsNoteItem, StoredCatalog } from "@/lib/mantencion/client/types"
import type { CatalogPartsNote, MantCatalog } from "@/lib/mantencion/contracts"
import { AppActionsProvider, AppDataProvider, type AppActions, type AppData } from "../app-context"
import { PartsHomeSection } from "../parts-home"

const actions = (): AppActions => ({ syncNow: vi.fn(), refreshCatalog: vi.fn(async () => "unchanged" as const), toast: vi.fn() })

const TWO_SITES: Partial<MantCatalog> = {
  worksites: [{ id: "ws-bio", name: "Biodiversa" }, { id: "ws-cho", name: "Cholguán" }],
  user: { id: "u-1", name: "Javier Roa", worksiteIds: ["ws-bio", "ws-cho"], canRequestParts: true },
}

function mantCatalog(extra: Partial<MantCatalog> = {}): MantCatalog {
  return {
    ...catalog("u-1", [equipment(), equipment({ id: "veh-2", code: "CR-52", plate: "CR-52", typeName: "Retroexcavadora" }), equipment({ id: "veh-9", code: "ZZ-1", plate: "ZZ-1", worksiteId: "ws-cho", worksiteName: "Cholguán" })]),
    user: { id: "u-1", name: "Javier Roa", worksiteIds: ["ws-bio"], canRequestParts: true },
    costCenters: [{ id: "cc-bio", name: "Taller", worksiteId: "ws-bio" }, { id: "cc-cho", name: "Taller Cholguán", worksiteId: "ws-cho" }],
    ...extra,
  }
}

function stored(extra: Partial<MantCatalog> = {}): StoredCatalog {
  return { userId: "u-1", etag: '"v1"', fetchedAt: "2026-10-28T12:00:00.000Z", catalog: mantCatalog(extra), others: null }
}

function dataFor(catalogStored: StoredCatalog | null, queue: QueueItem[] = []): AppData {
  return {
    deviceId: UUID(900), appVersion: "test", account: account("u-1"), accounts: [account("u-1")], stored: catalogStored,
    rows: catalogStored ? buildRows(catalogStored, queue) : [], queue, online: true, now: Date.parse("2026-10-28T18:00:00.000Z"),
  }
}

function renderHome(catalogStored: StoredCatalog | null, queue: QueueItem[] = []) {
  const bag = actions()
  render(
    <AppDataProvider value={dataFor(catalogStored, queue)}>
      <AppActionsProvider value={bag}>
        <div id="mant-content"><PartsHomeSection /></div>
      </AppActionsProvider>
    </AppDataProvider>,
  )
  return bag
}

const parts = async () => (await listQueue()).filter((item): item is QueuePartsNoteItem => item.type === "parts_note")
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }))
const line = (n: number) => within(screen.getByRole("group", { name: `Repuesto ${n}` }))
const dialog = () => within(screen.getByRole("dialog", { name: "Pedir repuestos" }))

beforeEach(async () => {
  await freshDb()
  document.body.innerHTML = '<div id="mant-modals"></div>'
})
afterEach(cleanup)

describe("«Repuestos» en el inicio", () => {
  it("sin permiso para pedir y sin notas no ocupa lugar; un catálogo antiguo tampoco ofrece pedir", () => {
    const old: StoredCatalog = { userId: "u-1", etag: null, fetchedAt: "2026-10-28T12:00:00.000Z", catalog: catalog("u-1"), others: null }
    renderHome(old)
    expect(screen.queryByRole("region", { name: "Repuestos" })).toBeNull()
    cleanup()
    renderHome(null)
    expect(screen.queryByRole("region", { name: "Repuestos" })).toBeNull()
  })

  it("con permiso ofrece «Pedir repuestos»; «Mis notas» aparece con la primera nota y cuenta las que siguen en curso", () => {
    renderHome(stored())
    expect(screen.getByRole("button", { name: "Pedir repuestos" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Mis notas/ })).toBeNull()
    cleanup()
    const notes: CatalogPartsNote[] = [ownNote({ id: "a", status: "en_compra" }), ownNote({ id: "b", status: "cerrada" }), ownNote({ id: "c", status: "enviada" })]
    renderHome(stored({ ownPartsNotes: notes }))
    expect(screen.getByRole("button", { name: "Mis notas (2)" })).toBeTruthy()
  })

  it("quien sólo ve sus notas (sin permiso para pedir) tiene «Mis notas» y no «Pedir repuestos»", () => {
    renderHome(stored({ user: { id: "u-1", name: "Javier Roa", worksiteIds: ["ws-bio"], canRequestParts: false }, ownPartsNotes: [ownNote()] }))
    expect(screen.queryByRole("button", { name: "Pedir repuestos" })).toBeNull()
    expect(screen.getByRole("button", { name: "Mis notas (1)" })).toBeTruthy()
  })

  it("un pedido que sólo está en el teléfono ya cuenta en «Mis notas»", () => {
    renderHome(stored(), [freePartsNoteItem(1)])
    expect(screen.getByRole("button", { name: "Mis notas (1)" })).toBeTruthy()
  })
})

describe("pedir repuestos sin OT", () => {
  it("con una sola faena queda fija y no se pregunta; guarda el pedido con faena, urgencia, observación y cargo por línea", async () => {
    const bag = renderHome(stored())
    click("Pedir repuestos")
    expect(dialog().getByText("Biodiversa")).toBeTruthy()
    expect(dialog().queryByLabelText("Faena")).toBeNull()

    fireEvent.change(line(1).getByLabelText("¿Qué repuesto necesitas?"), { target: { value: "Rodamiento 6205" } })
    fireEvent.click(line(1).getByRole("button", { name: "Sumar uno al repuesto 1" }))
    fireEvent.change(line(1).getByLabelText("Cargo · opcional"), { target: { value: "c:cc-bio" } })
    click("+ Otro repuesto")
    // La línea nueva hereda el cargo de la anterior: casi siempre es para lo mismo.
    expect((line(2).getByLabelText("Cargo · opcional") as HTMLSelectElement).value).toBe("c:cc-bio")
    fireEvent.change(line(2).getByLabelText("¿Qué repuesto necesitas?"), { target: { value: "Cable de acero" } })
    fireEvent.change(line(2).getByLabelText("Cargo · opcional"), { target: { value: "v:veh-2" } })
    fireEvent.click(screen.getByRole("switch", { name: "Es urgente" }))
    fireEvent.change(screen.getByLabelText("Observación · opcional"), { target: { value: "Para el taller de Biodiversa" } })
    click("Enviar pedido")

    await waitFor(async () => expect(await parts()).toHaveLength(1))
    const [item] = await parts()
    expect(item).toMatchObject({
      type: "parts_note", authorUserId: "u-1", status: "pending", id: item!.payload.id,
      summary: { workOrderId: null, folio: null, equipmentCode: null, equipmentPlate: null, worksiteName: "Biodiversa" },
    })
    expect(item!.payload).toMatchObject({
      worksiteId: "ws-bio", urgent: true, equipmentStopped: false, deviceId: UUID(900), notes: "Para el taller de Biodiversa",
      lines: [
        { description: "Rodamiento 6205", quantity: 2, unitOfMeasure: "unidad", chargeCostCenterId: "cc-bio" },
        { description: "Cable de acero", quantity: 1, unitOfMeasure: "unidad", chargeVehicleId: "veh-2" },
      ],
    })
    expect(item!.payload).not.toHaveProperty("workOrderId")
    expect(item!.payload.lines[0]).not.toHaveProperty("chargeVehicleId")
    expect(item!.payload.lines[1]).not.toHaveProperty("chargeCostCenterId")
    expect(bag.syncNow).toHaveBeenCalled()
    expect(bag.toast).toHaveBeenCalledWith("Pedido guardado en el teléfono. Se envía cuando haya señal.")
    expect(screen.queryByRole("dialog", { name: "Pedir repuestos" })).toBeNull()
  })

  it("el cargo es opcional: sin elegirlo el pedido viaja sin claves de cargo", async () => {
    renderHome(stored())
    click("Pedir repuestos")
    fireEvent.change(line(1).getByLabelText("¿Qué repuesto necesitas?"), { target: { value: "Filtro de aire" } })
    click("Enviar pedido")
    await waitFor(async () => expect(await parts()).toHaveLength(1))
    const [item] = await parts()
    expect(item!.payload).toMatchObject({ worksiteId: "ws-bio", urgent: false })
    expect(item!.payload.lines[0]).not.toHaveProperty("chargeVehicleId")
    expect(item!.payload.lines[0]).not.toHaveProperty("chargeCostCenterId")
  })

  it("el cargo ofrece los centros de costo y los equipos de la faena; sin centros en el catálogo sólo equipos; sin nada, no hay cargo", () => {
    renderHome(stored())
    click("Pedir repuestos")
    const select = line(1).getByLabelText("Cargo · opcional") as HTMLSelectElement
    expect([...select.options].map((option) => option.textContent)).toEqual(["Sin cargo", "Taller", "CR-52 · Retroexcavadora", "KA-140 · SGCP-84 · Camión"])
    cleanup()
    renderHome(stored({ costCenters: undefined }))
    click("Pedir repuestos")
    expect([...(line(1).getByLabelText("Cargo · opcional") as HTMLSelectElement).options].map((option) => option.textContent)).toEqual(["Sin cargo", "CR-52 · Retroexcavadora", "KA-140 · SGCP-84 · Camión"])
    cleanup()
    renderHome(stored({ costCenters: undefined, equipment: [] }))
    click("Pedir repuestos")
    expect(line(1).queryByLabelText("Cargo · opcional")).toBeNull()
  })

  it("con varias faenas hay que elegir una; mientras no se elija no se guarda nada y se dice junto al campo", async () => {
    const bag = renderHome(stored(TWO_SITES))
    click("Pedir repuestos")
    fireEvent.change(line(1).getByLabelText("¿Qué repuesto necesitas?"), { target: { value: "Rodamiento 6205" } })
    click("Enviar pedido")
    expect(await screen.findByText("Elige la faena a la que pides los repuestos.")).toBeTruthy()
    expect(await parts()).toHaveLength(0)
    expect(bag.syncNow).not.toHaveBeenCalled()

    const sites = dialog().getByLabelText("Faena") as HTMLSelectElement
    expect([...sites.options].map((option) => option.textContent)).toEqual(["Elige la faena", "Biodiversa", "Cholguán"])
    fireEvent.change(sites, { target: { value: "ws-cho" } })
    // Sin cargo elegido en otra faena: las opciones son las de Cholguán.
    expect([...(line(1).getByLabelText("Cargo · opcional") as HTMLSelectElement).options].map((option) => option.textContent)).toEqual(["Sin cargo", "Taller Cholguán", "ZZ-1 · Camión"])
    click("Enviar pedido")
    await waitFor(async () => expect(await parts()).toHaveLength(1))
    expect((await parts())[0]).toMatchObject({ payload: { worksiteId: "ws-cho" }, summary: { worksiteName: "Cholguán" } })
  })

  it("al cambiar de faena se sueltan los cargos que eran de la anterior", () => {
    renderHome(stored(TWO_SITES))
    click("Pedir repuestos")
    fireEvent.change(dialog().getByLabelText("Faena"), { target: { value: "ws-bio" } })
    fireEvent.change(line(1).getByLabelText("Cargo · opcional"), { target: { value: "v:veh-2" } })
    expect((line(1).getByLabelText("Cargo · opcional") as HTMLSelectElement).value).toBe("v:veh-2")
    fireEvent.change(dialog().getByLabelText("Faena"), { target: { value: "ws-cho" } })
    expect((line(1).getByLabelText("Cargo · opcional") as HTMLSelectElement).value).toBe("")
  })

  it("valida junto al campo como el pedido de una OT, y lo escrito se conserva", async () => {
    renderHome(stored())
    click("Pedir repuestos")
    fireEvent.change(line(1).getByLabelText("¿Qué repuesto necesitas?"), { target: { value: "ab" } })
    click("Enviar pedido")
    expect(await screen.findByText("Describe el repuesto (al menos 3 letras).")).toBeTruthy()
    expect((line(1).getByLabelText("¿Qué repuesto necesitas?") as HTMLInputElement).value).toBe("ab")
    expect(await parts()).toHaveLength(0)
  })

  it("lo escrito se protege: cerrar con cambios pregunta antes de descartar", () => {
    renderHome(stored())
    click("Pedir repuestos")
    fireEvent.change(line(1).getByLabelText("¿Qué repuesto necesitas?"), { target: { value: "Filtro" } })
    click("Cancelar")
    expect(screen.getByRole("alertdialog").textContent).toContain("¿Descartar lo que escribiste?")
    click("Descartar")
    expect(screen.queryByRole("dialog", { name: "Pedir repuestos" })).toBeNull()
  })

  it("lo guardado se ve enseguida en «Mis notas» como «Por enviar»", async () => {
    // El estado de la cola llega por `AppData`: aquí se simula con el elemento ya guardado.
    const pending = freePartsNoteItem(1)
    await enqueueSimple(pending)
    renderHome(stored(), await listQueue())
    click("Mis notas (1)")
    const sheet = within(screen.getByRole("dialog", { name: "Mis notas" }))
    expect(sheet.getByText("Por enviar", { selector: ".dtag" })).toBeTruthy()
    expect(sheet.getByText("Sin OT · Biodiversa")).toBeTruthy()
  })
})
