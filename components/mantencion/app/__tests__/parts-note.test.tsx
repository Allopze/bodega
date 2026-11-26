// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { useReducer, useState } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UUID, account, catalog, correctivePayload, equipment, freshDb, partsNoteItem, workOrder } from "@/lib/mantencion/client/__tests__/fixtures"
import { buildRows } from "@/lib/mantencion/client/fleet-view"
import { flowReducer } from "@/lib/mantencion/client/flow"
import { loadDraft, saveDraft } from "@/lib/mantencion/client/drafts"
import { newDraft, newJob, type FlowDraft } from "@/lib/mantencion/client/flow-types"
import { buildOtViews, isStockPart, type OtView } from "@/lib/mantencion/client/ot-model"
import { enqueueSimple, listQueue, newRecordItem } from "@/lib/mantencion/client/queue"
import type { QueueItem, QueuePartsNoteItem, StoredCatalog } from "@/lib/mantencion/client/types"
import { correctivePartSchema, type CatalogPartsAvailable, type CatalogPartsNote, type CatalogWorkOrder } from "@/lib/mantencion/contracts"
import { AppActionsProvider, AppDataProvider, type AppActions, type AppData } from "../app-context"
import { OtSheet } from "../ot-sheet"
import { PartsNoteSheet } from "../parts-note-sheet"
import { StepTrabajo } from "../step-trabajo"

const USER = { id: "u-1", name: "Javier Roa" }
const actions = (): AppActions => ({ syncNow: vi.fn(), refreshCatalog: vi.fn(async () => "unchanged" as const), toast: vi.fn() })

const AVAILABLE = (overrides: Partial<CatalogPartsAvailable> = {}): CatalogPartsAvailable => ({
  allocationId: "al-1", productId: "pr-1", name: "Filtro de aceite", partNumber: "FA-100", unit: "unidad", wholeOnly: true,
  worksiteId: "ws-bio", worksiteName: "Biodiversa", remaining: 2, ...overrides,
})

const NOTE = (lines: CatalogPartsNote["lines"], overrides: Partial<CatalogPartsNote> = {}): CatalogPartsNote => ({
  id: "np-1", code: "NP-2026-0001", status: "en_gestion", equipmentStopped: false, createdAt: "2026-10-28T10:00:00.000Z", lines, ...overrides,
})
const LINE = (overrides: Partial<CatalogPartsNote["lines"][number]> = {}): CatalogPartsNote["lines"][number] => ({
  id: "l-1", description: "Filtro de aceite", quantity: 2, unit: "unidad", partNumber: null, stage: "pedido", arrived: 0, used: 0, rejectionReason: null, ...overrides,
})

function stored(workOrders: CatalogWorkOrder[]): StoredCatalog {
  return { userId: "u-1", etag: '"v1"', fetchedAt: "2026-10-28T12:00:00.000Z", catalog: { ...catalog("u-1", [equipment()]), workOrders }, others: null }
}

function dataFor(catalogStored: StoredCatalog, queue: QueueItem[] = []): AppData {
  return {
    deviceId: UUID(900), appVersion: "test", account: account("u-1"), accounts: [account("u-1")], stored: catalogStored,
    rows: buildRows(catalogStored, queue), queue, online: true, now: Date.now(),
  }
}

const viewOf = (catalogStored: StoredCatalog, queue: QueueItem[] = []): OtView => buildOtViews(catalogStored.catalog, queue, USER).mine[0]!

function renderOt(ot: CatalogWorkOrder, queue: QueueItem[] = []) {
  const catalogStored = stored([ot])
  const bag = actions()
  render(
    <AppDataProvider value={dataFor(catalogStored, queue)}>
      <AppActionsProvider value={bag}>
        <OtSheet view={viewOf(catalogStored, queue)} onClose={() => {}} onRegister={() => {}} />
      </AppActionsProvider>
    </AppDataProvider>,
  )
  return bag
}

const parts = async () => (await listQueue()).filter((item): item is QueuePartsNoteItem => item.type === "parts_note")
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }))
const line = (n: number) => within(screen.getByRole("group", { name: `Repuesto ${n}` }))

beforeEach(async () => {
  await freshDb()
  document.body.innerHTML = '<div id="mant-content"></div><div id="mant-modals"></div>'
})
afterEach(cleanup)

describe("sección «Repuestos» de la OT", () => {
  it("dice el estado de cada línea con palabras: Pedido, En compra, Llegó · n disponibles, Usado n de m, Rechazado: motivo", () => {
    renderOt(workOrder({ partsNotes: [NOTE([
      LINE({ id: "a", description: "Manguera", stage: "pedido" }),
      LINE({ id: "b", description: "Correa", stage: "en_compra" }),
      LINE({ id: "c", description: "Filtro de aceite", stage: "en_bodega", arrived: 2, used: 0 }),
      LINE({ id: "d", description: "Pastillas", stage: "en_bodega", arrived: 2, used: 1 }),
      LINE({ id: "e", description: "Bomba", stage: "rechazado", rejectionReason: "No se vende más" }),
    ])] }))
    const section = within(screen.getByRole("region", { name: "Repuestos" }))
    expect(section.getByText("Pedido")).toBeTruthy()
    expect(section.getByText("En compra")).toBeTruthy()
    expect(section.getByText("Llegó · 2 disponibles")).toBeTruthy()
    expect(section.getByText("Usado 1 de 2")).toBeTruthy()
    expect(section.getByText("Queda 1 disponible")).toBeTruthy()
    expect(section.getByText("Rechazado: No se vende más")).toBeTruthy()
    // Cada fila nombra su repuesto y su NP.
    const row = section.getByText("Filtro de aceite").closest("li")!
    expect(row.textContent).toContain("NP-2026-0001")
  })

  it("un pedido aún en el teléfono se ve «Pedido · por enviar»", () => {
    renderOt(workOrder(), [partsNoteItem(1, { lines: [{ description: "Pastillas de freno", quantity: 4, unitOfMeasure: "unidad", partNumber: null, productId: null }] })])
    const section = within(screen.getByRole("region", { name: "Repuestos" }))
    expect(section.getByText("Pedido · por enviar")).toBeTruthy()
    expect(section.getByText(/Pastillas de freno/)).toBeTruthy()
  })

  it("«Pedir repuestos» aparece con la OT asignada o en ejecución a este usuario, y no en otro caso", () => {
    renderOt(workOrder({ status: "asignada" }))
    expect(screen.getByRole("button", { name: "Pedir repuestos" })).toBeTruthy()
    cleanup()
    renderOt(workOrder({ status: "trabajo_terminado" }))
    expect(screen.queryByRole("button", { name: "Pedir repuestos" })).toBeNull()
    cleanup()
    renderOt(workOrder({ status: "asignada", assignedToUserId: "u-2", assignedToName: "Luis Campos" }))
    expect(screen.queryByRole("button", { name: "Pedir repuestos" })).toBeNull()
  })

  it("una OT cerrada sin pedidos no muestra la sección; con un catálogo sin partsNotes todo sigue andando", () => {
    renderOt(workOrder({ status: "cerrada" }))
    expect(screen.queryByRole("region", { name: "Repuestos" })).toBeNull()
    cleanup()
    renderOt(workOrder())
    const section = within(screen.getByRole("region", { name: "Repuestos" }))
    expect(section.getByText("Aún no pediste repuestos para esta OT.")).toBeTruthy()
  })

  it("si el servidor rechazó el pedido, avisa con su mensaje y «Entendido» lo descarta", async () => {
    const rejected: QueuePartsNoteItem = { ...partsNoteItem(1), status: "rejected", lastError: "La OT ya no admite pedidos de repuestos." }
    await enqueueSimple(rejected)
    renderOt(workOrder(), [rejected])
    expect(screen.getByText("No se pudo enviar el pedido de repuestos")).toBeTruthy()
    expect(screen.getByText("La OT ya no admite pedidos de repuestos.")).toBeTruthy()
    click("Entendido")
    await waitFor(async () => expect(await parts()).toHaveLength(0))
  })
})

describe("hoja «Pedir repuestos»", () => {
  const open = () => { renderOt(workOrder()); click("Pedir repuestos") }

  it("valida la descripción y la cantidad junto al campo, y no guarda nada mientras falte algo", async () => {
    const bag = actions()
    open()
    expect(screen.getByRole("heading", { name: "Pedir repuestos" })).toBeTruthy()
    fireEvent.change(line(1).getByLabelText("¿Qué repuesto necesitas?"), { target: { value: "ab" } })
    click("Enviar pedido")
    expect(await screen.findByText("Describe el repuesto (al menos 3 letras).")).toBeTruthy()

    fireEvent.change(line(1).getByLabelText("¿Qué repuesto necesitas?"), { target: { value: "Filtro de aceite" } })
    fireEvent.change(line(1).getByLabelText("Cantidad"), { target: { value: "0" } })
    click("Enviar pedido")
    expect(await screen.findByText("La cantidad debe ser mayor que cero.")).toBeTruthy()
    expect(await parts()).toHaveLength(0)
    expect(bag.syncNow).not.toHaveBeenCalled()
  })

  it("la cantidad se cambia con − y +, entera y nunca menos de 1", () => {
    open()
    const first = line(1)
    expect(first.getByLabelText("Cantidad")).toHaveProperty("value", "1")
    expect((first.getByRole("button", { name: "Restar uno al repuesto 1" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(first.getByRole("button", { name: "Sumar uno al repuesto 1" }))
    fireEvent.click(first.getByRole("button", { name: "Sumar uno al repuesto 1" }))
    expect(first.getByLabelText("Cantidad")).toHaveProperty("value", "3")
    fireEvent.click(first.getByRole("button", { name: "Restar uno al repuesto 1" }))
    expect(first.getByLabelText("Cantidad")).toHaveProperty("value", "2")
  })

  it("guarda el pedido en el teléfono con todas sus líneas, avisa y cierra la hoja", async () => {
    const bag = actions()
    const catalogStored = stored([workOrder()])
    render(
      <AppDataProvider value={dataFor(catalogStored)}>
        <AppActionsProvider value={bag}>
          <OtSheet view={viewOf(catalogStored)} onClose={() => {}} onRegister={() => {}} />
        </AppActionsProvider>
      </AppDataProvider>,
    )
    click("Pedir repuestos")
    fireEvent.change(line(1).getByLabelText("¿Qué repuesto necesitas?"), { target: { value: "Filtro de aceite" } })
    fireEvent.click(line(1).getByRole("button", { name: "Sumar uno al repuesto 1" }))
    fireEvent.click(line(1).getByRole("button", { name: "+ N° de parte (opcional)" }))
    fireEvent.change(line(1).getByLabelText("N° de parte (opcional)"), { target: { value: "FA-100" } })
    click("+ Otro repuesto")
    fireEvent.change(line(2).getByLabelText("¿Qué repuesto necesitas?"), { target: { value: "Pastillas de freno" } })
    fireEvent.click(screen.getByRole("switch", { name: "El equipo está detenido esperando esto" }))
    fireEvent.change(screen.getByLabelText("Comentario · opcional"), { target: { value: "Urgente, está parado" } })
    click("Enviar pedido")

    await waitFor(async () => expect(await parts()).toHaveLength(1))
    const [item] = await parts()
    expect(item).toMatchObject({ type: "parts_note", authorUserId: "u-1", status: "pending", id: item!.payload.id, summary: { workOrderId: "ot-1", folio: "OT-BIO-0001", equipmentCode: "KA-140" } })
    expect(item!.payload).toMatchObject({
      workOrderId: "ot-1", deviceId: UUID(900), equipmentStopped: true, notes: "Urgente, está parado",
      lines: [
        { description: "Filtro de aceite", quantity: 2, unitOfMeasure: "unidad", partNumber: "FA-100", productId: null },
        { description: "Pastillas de freno", quantity: 1, unitOfMeasure: "unidad", partNumber: null, productId: null },
      ],
    })
    expect(bag.syncNow).toHaveBeenCalled()
    expect(await screen.findByText("Pedido guardado en el teléfono. Se envía cuando haya señal.")).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Pedir repuestos" })).toBeNull()
  })

  it("se pueden quitar líneas y el máximo es de 20", () => {
    open()
    click("+ Otro repuesto")
    expect(screen.getAllByRole("group", { name: /^Repuesto \d+$/ })).toHaveLength(2)
    // La línea nueva recibe el foco: con guantes no hay que buscarla.
    expect(document.activeElement).toBe(line(2).getByLabelText("¿Qué repuesto necesitas?"))
    fireEvent.click(line(2).getByRole("button", { name: "Quitar el repuesto 2" }))
    expect(screen.getAllByRole("group", { name: /^Repuesto \d+$/ })).toHaveLength(1)
    // Con una sola línea no hay a qué quitar.
    expect(line(1).queryByRole("button", { name: "Quitar el repuesto 1" })).toBeNull()
    for (let i = 0; i < 19; i++) click("+ Otro repuesto")
    expect(screen.getAllByRole("group", { name: /^Repuesto \d+$/ })).toHaveLength(20)
    expect((screen.getByRole("button", { name: "+ Otro repuesto" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText("Máximo 20 repuestos por pedido.")).toBeTruthy()
  })

  it("lo escrito se protege: cerrar con cambios pregunta antes de descartar", async () => {
    const onClose = vi.fn()
    const view = viewOf(stored([workOrder()]))
    render(
      <AppDataProvider value={dataFor(stored([workOrder()]))}>
        <AppActionsProvider value={actions()}>
          <PartsNoteSheet view={view} onClose={onClose} onSaved={() => {}} />
        </AppActionsProvider>
      </AppDataProvider>,
    )
    fireEvent.change(line(1).getByLabelText("¿Qué repuesto necesitas?"), { target: { value: "Filtro" } })
    click("Cancelar")
    expect(screen.getByRole("alertdialog").textContent).toContain("¿Descartar lo que escribiste?")
    expect(onClose).not.toHaveBeenCalled()
    click("Seguir editando")
    expect(screen.queryByRole("alertdialog")).toBeNull()
    click("Cancelar")
    click("Descartar")
    expect(onClose).toHaveBeenCalled()
  })

  it("sin cambios, cancelar cierra directo", () => {
    const onClose = vi.fn()
    const view = viewOf(stored([workOrder()]))
    render(
      <AppDataProvider value={dataFor(stored([workOrder()]))}>
        <AppActionsProvider value={actions()}>
          <PartsNoteSheet view={view} onClose={onClose} onSaved={() => {}} />
        </AppActionsProvider>
      </AppDataProvider>,
    )
    click("Cancelar")
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(onClose).toHaveBeenCalled()
  })
})

describe("chips «Disponibles para esta OT» en el trabajo", () => {
  const OT = () => workOrder({ status: "en_ejecucion", partsAvailable: [AVAILABLE({ remaining: 2 })] })

  function Harness({ initial, catalogStored, queue = [] }: { initial: FlowDraft; catalogStored: StoredCatalog; queue?: QueueItem[] }) {
    const [draft, dispatch] = useReducer(flowReducer, initial)
    const [snapshot, setSnapshot] = useState("")
    const data = dataFor(catalogStored, queue)
    return (
      <AppDataProvider value={data}>
        <AppActionsProvider value={actions()}>
          <StepTrabajo draft={draft} dispatch={dispatch} row={data.rows[0]!} />
          <button type="button" onClick={() => setSnapshot(JSON.stringify(draft.jobs))}>snapshot</button>
          <output data-testid="jobs">{snapshot}</output>
        </AppActionsProvider>
      </AppDataProvider>
    )
  }

  const draftFor = (workOrderId: string | null = "ot-1"): FlowDraft => ({ ...newDraft({ userId: "u-1", kind: "C", vehicleId: "veh-1", workOrderId }), jobs: [newJob("t-1")] })
  const jobs = () => { fireEvent.click(screen.getByRole("button", { name: "snapshot" })); return JSON.parse(screen.getByTestId("jobs").textContent ?? "[]") as Array<{ parts: Array<Record<string, unknown>> }> }
  const chip = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement

  it("muestra el nombre y cuántos quedan; un toque agrega la línea de bodega con cantidad 1", () => {
    render(<Harness initial={draftFor()} catalogStored={stored([OT()])} />)
    expect(screen.getByText("Disponibles para esta OT")).toBeTruthy()
    fireEvent.click(chip(/Filtro de aceite · 2 disp\./))
    expect(jobs()[0]!.parts).toEqual([{ quantity: "1", description: "Filtro de aceite", source: "stock", productId: "pr-1", allocationId: "al-1" }])
    // La línea de bodega: nombre fijo (no es un campo de texto) y su rótulo.
    const stock = screen.getByRole("group", { name: "Repuesto de bodega: Filtro de aceite" })
    expect(within(stock).getByText("De la bodega · reservado para la OT")).toBeTruthy()
    expect(within(stock).queryByRole("textbox")).toBeNull()
  })

  it("el stepper de la línea topa en lo disponible y baja hasta 1", () => {
    render(<Harness initial={draftFor()} catalogStored={stored([OT()])} />)
    fireEvent.click(chip(/Filtro de aceite/))
    const stock = within(screen.getByRole("group", { name: "Repuesto de bodega: Filtro de aceite" }))
    const plus = stock.getByRole("button", { name: "Sumar uno a Filtro de aceite" }) as HTMLButtonElement
    const minus = stock.getByRole("button", { name: "Restar uno a Filtro de aceite" }) as HTMLButtonElement
    expect(minus.disabled).toBe(true)
    fireEvent.click(plus)
    expect(stock.getByText("2")).toBeTruthy()
    expect(plus.disabled).toBe(true)
    expect(jobs()[0]!.parts[0]).toMatchObject({ quantity: "2", source: "stock" })
    fireEvent.click(minus)
    expect(stock.getByText("1")).toBeTruthy()
  })

  it("una unidad que admite decimales (litros) se escribe con coma, avanza de a 1 y nunca pasa de lo disponible", () => {
    const litros = workOrder({ status: "en_ejecucion", partsAvailable: [AVAILABLE({ name: "Aceite 15W40", unit: "litro", wholeOnly: false, remaining: 2.5 })] })
    render(<Harness initial={draftFor()} catalogStored={stored([litros])} />)
    fireEvent.click(chip(/Aceite 15W40 · 2,5 disp\./))
    const stock = within(screen.getByRole("group", { name: "Repuesto de bodega: Aceite 15W40" }))
    const field = stock.getByLabelText("Cantidad de Aceite 15W40") as HTMLInputElement
    const plus = stock.getByRole("button", { name: "Sumar uno a Aceite 15W40" }) as HTMLButtonElement
    expect(field.value).toBe("1")
    fireEvent.click(plus)
    expect(field.value).toBe("2")
    fireEvent.click(plus)
    expect(field.value).toBe("2,5")
    expect(plus.disabled).toBe(true)
    fireEvent.change(field, { target: { value: "9" } })
    fireEvent.blur(field)
    expect(field.value).toBe("2,5")
    fireEvent.change(field, { target: { value: "1,5" } })
    fireEvent.blur(field)
    expect(field.value).toBe("1,5")
    expect(jobs()[0]!.parts[0]).toMatchObject({ quantity: "1,5", source: "stock", allocationId: "al-1" })
  })

  it("el tope descuenta lo ya puesto en otras líneas del mismo repuesto, y el chip se apaga al agotarse", () => {
    render(<Harness initial={draftFor()} catalogStored={stored([OT()])} />)
    fireEvent.click(chip(/Filtro de aceite · 2 disp\./))
    // Queda 1: el chip lo dice y todavía se puede tocar.
    fireEvent.click(chip(/Filtro de aceite · 1 disp\./))
    expect(jobs()[0]!.parts).toHaveLength(2)
    const exhausted = chip(/Filtro de aceite · 0 disp\./)
    expect(exhausted.disabled).toBe(true)
    // Cada línea ya no puede subir: la otra se come el resto.
    for (const plus of screen.getAllByRole("button", { name: "Sumar uno a Filtro de aceite" })) expect((plus as HTMLButtonElement).disabled).toBe(true)
  })

  it("descuenta lo que un registro guardado en el teléfono ya usó de la reserva", () => {
    const used = newRecordItem({
      authorUserId: "u-1",
      payload: correctivePayload(UUID(1), UUID(51), {
        workOrderId: "ot-1", inWorkshop: false, workshopEntryDate: null, workshopReason: null,
        jobs: [{ workTypeId: "t-1", hours: 1, noParts: false, parts: [{ quantity: 1, description: "Filtro de aceite", source: "stock", productId: "pr-1", allocationId: "al-1" }] }],
      }),
      photoIds: [UUID(51)],
      summary: { kind: "C", vehicleId: "veh-1", equipmentCode: "KA-140", equipmentPlate: "SGCP-84", unit: "km", intervalValue: null, workDate: "2026-10-28", reading: 40_400, inWorkshop: false, workshopEntryDate: null },
    }, "2026-10-28T15:01:00.000Z")
    render(<Harness initial={draftFor()} catalogStored={stored([OT()])} queue={[used]} />)
    expect(screen.getByRole("button", { name: /Filtro de aceite · 1 disp\./ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Filtro de aceite · 2 disp\./ })).toBeNull()
  })

  it("«+ Agregar repuesto» sigue agregando texto libre, sin source", () => {
    render(<Harness initial={draftFor()} catalogStored={stored([OT()])} />)
    fireEvent.click(chip(/Filtro de aceite/))
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar repuesto" }))
    const [first, second] = jobs()[0]!.parts
    expect(first).toMatchObject({ source: "stock" })
    expect(second).toEqual({ quantity: "1", description: "" })
    expect("source" in second!).toBe(false)
  })

  it("sin OT, sin repuestos reservados o con «No se usaron repuestos» no hay chips", () => {
    render(<Harness initial={draftFor(null)} catalogStored={stored([OT()])} />)
    expect(screen.queryByText("Disponibles para esta OT")).toBeNull()
    cleanup()
    render(<Harness initial={draftFor()} catalogStored={stored([workOrder({ status: "en_ejecucion" })])} />)
    expect(screen.queryByText("Disponibles para esta OT")).toBeNull()
    cleanup()
    render(<Harness initial={{ ...draftFor(), jobs: [{ ...newJob("t-1"), noParts: true }] }} catalogStored={stored([OT()])} />)
    expect(screen.queryByText("Disponibles para esta OT")).toBeNull()
  })

  it("el borrador conserva source, productId y allocationId al guardarse y al reabrirse, y la línea cumple el esquema del servidor", async () => {
    render(<Harness initial={draftFor()} catalogStored={stored([OT()])} />)
    fireEvent.click(chip(/Filtro de aceite/))
    const [job] = jobs()
    const draft: FlowDraft = { ...draftFor(), jobs: [{ ...newJob("t-1"), parts: job!.parts as unknown as FlowDraft["jobs"][number]["parts"] }] }
    await saveDraft(draft)
    const reopened = await loadDraft("u-1", "C")
    const part = reopened!.jobs[0]!.parts[0]!
    expect(isStockPart(part)).toBe(true)
    expect(part).toMatchObject({ source: "stock", productId: "pr-1", allocationId: "al-1", description: "Filtro de aceite" })
    const asPayload = { quantity: Number(part.quantity), description: part.description, source: "stock", productId: "pr-1", allocationId: "al-1" }
    expect(correctivePartSchema.safeParse(asPayload).success).toBe(true)
    expect(correctivePartSchema.safeParse({ ...asPayload, productId: null }).success).toBe(false)
  })
})
