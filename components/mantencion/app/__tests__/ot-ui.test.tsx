// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ENTRY, UUID, account, catalog, equipment, freshDb, otOpItem, workOrder } from "@/lib/mantencion/client/__tests__/fixtures"
import { buildRows } from "@/lib/mantencion/client/fleet-view"
import { buildOtViews, type OtView } from "@/lib/mantencion/client/ot-model"
import { listQueue } from "@/lib/mantencion/client/queue"
import type { QueueItem, QueueWorkOrderItem, StoredCatalog } from "@/lib/mantencion/client/types"
import type { CatalogWorkOrder } from "@/lib/mantencion/contracts"
import { AppActionsProvider, AppDataProvider, type AppActions, type AppData } from "../app-context"
import { OtSection } from "../ot-lists"
import { OtSheet } from "../ot-sheet"

const USER = { id: "u-1", name: "Javier Roa" }
const actions = (): AppActions => ({ syncNow: vi.fn(), refreshCatalog: vi.fn(async () => "unchanged" as const), toast: vi.fn() })

function stored(workOrders: CatalogWorkOrder[], available: CatalogWorkOrder[] = []): StoredCatalog {
  return {
    userId: "u-1", etag: '"v1"', fetchedAt: "2026-10-28T12:00:00.000Z",
    catalog: { ...catalog("u-1", [equipment()]), workOrders, availableWorkOrders: available }, others: null,
  }
}

function dataFor(catalogStored: StoredCatalog, queue: QueueItem[] = []): AppData {
  return {
    deviceId: UUID(900), appVersion: "test", account: account("u-1"), accounts: [account("u-1")], stored: catalogStored,
    rows: buildRows(catalogStored, queue), queue, online: true, now: Date.now(),
  }
}

function views(catalogStored: StoredCatalog, queue: QueueItem[] = []) {
  return buildOtViews(catalogStored.catalog, queue, USER)
}

function renderSheet(view: OtView, catalogStored: StoredCatalog, onRegister = vi.fn(), queue: QueueItem[] = []) {
  const bag = actions()
  render(
    <AppDataProvider value={dataFor(catalogStored, queue)}>
      <AppActionsProvider value={bag}>
        <OtSheet view={view} onClose={() => {}} onRegister={onRegister} />
      </AppActionsProvider>
    </AppDataProvider>,
  )
  return { bag, onRegister }
}

const queued = async () => (await listQueue()).filter((item): item is QueueWorkOrderItem => item.type === "ot")
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }))

beforeEach(async () => {
  await freshDb()
  document.body.innerHTML = '<div id="mant-content"></div><div id="mant-modals"></div>'
})
afterEach(cleanup)

describe("inicio: «Órdenes de trabajo»", () => {
  it("lista Mis OT con folio, equipo, estado, entrega estimada y la marca «Devuelta» con su motivo", () => {
    const returned = workOrder({ id: "a", folio: "OT-BIO-0007", status: "en_ejecucion", entry: ENTRY, lastRejection: { count: 1, reason: "Falta apretar la manguera", at: "2026-10-28T17:00:00.000Z" } })
    const plain = workOrder({ id: "b", folio: "OT-BIO-0008" })
    render(<OtSection views={views(stored([returned, plain]))} onOpen={() => {}} />)
    const section = screen.getByRole("region", { name: "Órdenes de trabajo" })
    const devuelta = within(section).getByRole("button", { name: /OT-BIO-0007/ })
    expect(devuelta.textContent).toContain("KA-140 · SGCP-84")
    expect(devuelta.textContent).toContain("En taller")
    expect(devuelta.textContent).toContain("Entrega estimada: 30-10-2026")
    expect(devuelta.textContent).toContain("Devuelta: Falta apretar la manguera")
    expect(within(section).getByRole("button", { name: /OT-BIO-0008/ }).textContent).toContain("Asignada")
  })

  it("«OT disponibles (N)» está plegada y se abre; el equipo de otra faena lleva un aviso suave", () => {
    const mine = workOrder()
    const free = workOrder({ id: "c", folio: "OT-CHO-0002", status: "solicitada", assignedToUserId: null, assignedToName: null, outOfWorksite: true, worksiteName: "Cholguan" })
    render(<OtSection views={views(stored([mine], [free]))} onOpen={() => {}} />)
    expect(screen.queryByRole("button", { name: /OT-CHO-0002/ })).toBeNull()
    const toggle = screen.getByRole("button", { name: "OT disponibles (1)" })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(toggle)
    const card = screen.getByRole("button", { name: /OT-CHO-0002/ })
    expect(card.textContent).toContain("Por asignar")
    expect(card.textContent).toContain("Equipo de otra faena · Cholguan")
  })

  it("sin OT en el catálogo (o con un catálogo anterior a las OT) la sección no ocupa lugar", () => {
    const { container } = render(<OtSection views={views({ ...stored([]), catalog: catalog() })} onOpen={() => {}} />)
    expect(container.innerHTML).toBe("")
  })

  it("una operación guardada sin enviar se nota en la tarjeta", () => {
    const base = stored([workOrder()])
    render(<OtSection views={views(base, [otOpItem(1, { action: "start", entry: { ...ENTRY, workshopId: null, operatorDriverId: null } })])} onOpen={() => {}} />)
    const card = screen.getByRole("button", { name: /OT-BIO-0001/ })
    expect(card.textContent).toContain("En taller")
    expect(card.textContent).toContain("Sin enviar")
  })
})

describe("hoja de la OT", () => {
  it("tomar una OT disponible la guarda en la cola, avisa y manda sincronizar (sin diálogo de confirmación)", async () => {
    const free = workOrder({ status: "solicitada", assignedToUserId: null, assignedToName: null })
    const base = stored([], [free])
    const { bag } = renderSheet(views(base).available[0]!, base)
    click("Tomar esta OT")
    await waitFor(async () => expect(await queued()).toHaveLength(1))
    expect((await queued())[0]?.payload).toMatchObject({ action: "take", workOrderId: "ot-1", deviceId: UUID(900) })
    expect(bag.toast).toHaveBeenCalledWith(expect.stringContaining("Tomaste la OT"))
    expect(bag.syncNow).toHaveBeenCalled()
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("registrar el ingreso: pide lo que falta con su motivo y luego guarda el ingreso completo", async () => {
    const base = stored([workOrder()])
    renderSheet(views(base).mine[0]!, base)
    click("Registrar ingreso a taller")
    expect(screen.getByRole("heading", { name: "Ingreso a taller" })).toBeTruthy()

    click("Registrar ingreso")
    expect(await screen.findByText("Elige si es taller interno o externo.")).toBeTruthy()
    expect(screen.getByText("Ingresa la lectura del odómetro.")).toBeTruthy()
    expect(screen.getByText("Indica la fecha estimada de entrega.")).toBeTruthy()
    expect(await queued()).toHaveLength(0)

    click("Externo")
    expect(screen.getByLabelText("Taller externo")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Taller externo"), { target: { value: "w-1" } })
    fireEvent.change(screen.getByLabelText("Encargado del taller · si lo sabes"), { target: { value: "Pedro Silva" } })
    fireEvent.change(screen.getByLabelText("Operador · quien trae el equipo"), { target: { value: "d-1" } })
    // Una lectura menor que la última conocida (40.312 km) no pasa.
    fireEvent.change(screen.getByLabelText("Odómetro al ingresar"), { target: { value: "39000" } })
    fireEvent.change(screen.getByLabelText("Fecha estimada de entrega"), { target: { value: "2099-01-01" } })
    click("Registrar ingreso")
    expect(await screen.findByText(/Es menor que la lectura de 40\.312 km/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText("Odómetro al ingresar"), { target: { value: "40500" } })
    expect(screen.getByLabelText("Odómetro al ingresar")).toHaveProperty("value", "40.500")
    click("Registrar ingreso")
    await waitFor(async () => expect(await queued()).toHaveLength(1))
    const [op] = await queued()
    expect(op?.payload).toMatchObject({
      action: "start",
      entry: { workshopKind: "externo", workshopId: "w-1", workshopManagerName: "Pedro Silva", operatorDriverId: "d-1", operatorName: null, odometer: 40_500, hourmeter: null, estimatedDeliveryDate: "2099-01-01" },
    })
  })

  it("ítems: marca SÍ/NO, agrega uno del taller y guarda una sola operación", async () => {
    const base = stored([workOrder({ status: "en_ejecucion", entry: ENTRY })])
    renderSheet(views(base).mine[0]!, base)
    click(/Marcar ítems SÍ \/ NO \(2\)/)
    const first = screen.getByRole("group", { name: "Cambiar manguera de freno" })
    fireEvent.click(within(first).getByRole("button", { name: "SÍ" }))
    const second = screen.getByRole("group", { name: "Cambio de aceite" })
    fireEvent.click(within(second).getByRole("button", { name: "NO" }))
    fireEvent.change(screen.getByLabelText("Motivo de «Cambio de aceite» (opcional)"), { target: { value: "no había aceite" } })
    fireEvent.change(screen.getByLabelText("Agregar ítem a «Mantenciones solicitadas o asignadas en taller»"), { target: { value: "Revisar luces" } })
    click("Agregar a «Mantenciones solicitadas o asignadas en taller»")
    expect(screen.getByText("Revisar luces")).toBeTruthy()
    click("Guardar marcas")
    await waitFor(async () => expect(await queued()).toHaveLength(1))
    const [op] = await queued()
    expect(op?.payload).toMatchObject({
      action: "items",
      marks: [{ itemId: "it-1", done: "si", note: null }, { itemId: "it-2", done: "no", note: "no había aceite" }],
      added: [{ kind: "mantencion", description: "Revisar luces" }],
    })
  })

  it("el tope de 12 ítems por lista se respeta al agregar", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, kind: "mantencion" as const, origin: "solicitud" as const, description: `Ítem ${i + 1}`, done: null, note: null }))
    const base = stored([workOrder({ status: "en_ejecucion", entry: ENTRY, items })])
    renderSheet(views(base).mine[0]!, base)
    click(/Marcar ítems SÍ \/ NO/)
    expect(screen.getByText("Llegaste al máximo de 12 ítems en esta lista.")).toBeTruthy()
  })

  it("cambiar la fecha estimada exige un motivo y una fecha distinta", async () => {
    const base = stored([workOrder({ status: "en_ejecucion", entry: ENTRY })])
    renderSheet(views(base).mine[0]!, base)
    click("Cambiar fecha de entrega")
    click("Guardar fecha")
    expect(await screen.findByText("Elige una fecha distinta a la actual.")).toBeTruthy()
    expect(screen.getByText("Cuenta por qué cambia la fecha.")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Nueva fecha estimada de entrega"), { target: { value: "2026-11-05" } })
    fireEvent.change(screen.getByLabelText("Motivo del cambio"), { target: { value: "Espera un repuesto" } })
    click("Guardar fecha")
    await waitFor(async () => expect(await queued()).toHaveLength(1))
    expect((await queued())[0]?.payload).toMatchObject({ action: "estimate", estimatedDeliveryDate: "2026-11-05", reason: "Espera un repuesto" })
  })

  it("terminar dice qué falta; con todo listo guarda la salida con fecha y hora", async () => {
    const blocked = stored([workOrder({ status: "en_ejecucion", entry: ENTRY })])
    const first = renderSheet(views(blocked).mine[0]!, blocked)
    click(/Terminar \(salida de taller\)/)
    expect(screen.getByText("Faltan 2 ítems por marcar con SÍ o NO")).toBeTruthy()
    expect(screen.getByText("Registra al menos una correctiva o preventiva de esta OT")).toBeTruthy()
    click("Terminar y avisar")
    expect(await screen.findByText(/Todavía no puedes terminarla: faltan 2 ítems por marcar/)).toBeTruthy()
    expect(await queued()).toHaveLength(0)
    expect(first.bag.syncNow).not.toHaveBeenCalled()
    cleanup()

    const ready = stored([workOrder({
      status: "en_ejecucion", entry: ENTRY, items: workOrder().items.map((item) => ({ ...item, done: "si" as const })),
      linkedRecords: [{ id: UUID(9), folio: "MC-BIO-0003", kind: "C", signedAt: "2026-10-28T16:00:00.000Z" }],
    })])
    renderSheet(views(ready).mine[0]!, ready)
    expect(screen.getByText("MC-BIO-0003", { exact: false })).toBeTruthy()
    click(/Terminar \(salida de taller\)/)
    expect(screen.getByText("Todo listo: ítems marcados y trabajo registrado.")).toBeTruthy()
    click("Terminar y avisar")
    await waitFor(async () => expect(await queued()).toHaveLength(1))
    expect((await queued())[0]?.payload).toMatchObject({ action: "finish", note: null })
  })

  it("«Registrar correctiva» y «Registrar preventiva» arrancan el flujo desde la OT", () => {
    const base = stored([workOrder({ status: "en_ejecucion", entry: ENTRY })])
    const view = views(base).mine[0]!
    const { onRegister } = renderSheet(view, base)
    click("Registrar correctiva")
    expect(onRegister).toHaveBeenLastCalledWith("C", view)
    click("Registrar preventiva")
    expect(onRegister).toHaveBeenLastCalledWith("P", view)
  })

  it("una OT devuelta muestra el motivo; una operación rechazada se explica y se puede descartar", async () => {
    const returned = workOrder({ status: "en_ejecucion", entry: ENTRY, lastRejection: { count: 1, reason: "Falta apretar la manguera", at: "2026-10-28T17:00:00.000Z" } })
    const base = stored([returned])
    const rejected = { ...otOpItem(1, { action: "items", marks: [{ itemId: "it-1", done: "si", note: null }], added: [] }), status: "rejected" as const, lastError: "La OT ya no está en ejecución." }
    renderSheet(views(base, [rejected]).mine[0]!, base, vi.fn(), [rejected])
    expect(screen.getByText("Devuelta: Falta apretar la manguera")).toBeTruthy()
    expect(screen.getByText("No se pudo enviar: Marcas de ítems")).toBeTruthy()
    expect(screen.getByText("La OT ya no está en ejecución.")).toBeTruthy()
  })

  it("una OT por recibir no ofrece acciones de trabajo, sólo cerrar", () => {
    const base = stored([workOrder({ status: "trabajo_terminado", entry: ENTRY, exitAt: "2026-10-29T12:00:00.000Z" })])
    renderSheet(views(base).mine[0]!, base)
    expect(screen.queryByRole("button", { name: "Registrar correctiva" })).toBeNull()
    expect(screen.queryByRole("button", { name: /Terminar/ })).toBeNull()
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeTruthy()
    expect(screen.getByText("Salida taller")).toBeTruthy()
  })
})
