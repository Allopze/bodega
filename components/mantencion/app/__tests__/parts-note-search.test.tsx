// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UUID, account, catalog, equipment, freshDb, sparePart, workOrder } from "@/lib/mantencion/client/__tests__/fixtures"
import { buildRows } from "@/lib/mantencion/client/fleet-view"
import { buildOtViews } from "@/lib/mantencion/client/ot-model"
import { listQueue } from "@/lib/mantencion/client/queue"
import type { QueuePartsNoteItem, StoredCatalog } from "@/lib/mantencion/client/types"
import type { CatalogSparePart, MantCatalog } from "@/lib/mantencion/contracts"
import { AppActionsProvider, AppDataProvider, type AppActions, type AppData } from "../app-context"
import { PartsHomeSection } from "../parts-home"
import { PartsNoteSheet } from "../parts-note-sheet"

/**
 * Buscador de repuestos del catálogo al pedir (R15): filtra local, se maneja con teclado, rellena la línea y fija el
 * `productId`; escribir libre sin elegir deja `productId: null`.
 */

const PARTS: CatalogSparePart[] = [
  sparePart({ id: "p-aceite", name: "Filtro de aceite motor", sku: "REP-0001", partNumber: "1R-0750" }),
  sparePart({ id: "p-aire", name: "Filtro de aire primario", sku: "REP-0002", partNumber: "AF 25957" }),
  sparePart({ id: "p-valvula", name: "Válvula solenoide 24V", sku: "REP-0003", partNumber: null }),
  sparePart({ id: "p-hid", name: "Aceite hidráulico ISO 68", sku: "REP-0004", partNumber: "HYD-68", unit: "litro" }),
]

const actions = (): AppActions => ({ syncNow: vi.fn(), refreshCatalog: vi.fn(async () => "unchanged" as const), toast: vi.fn() })

function mantCatalog(extra: Partial<MantCatalog> = {}): MantCatalog {
  return {
    ...catalog("u-1", [equipment()]),
    user: { id: "u-1", name: "Javier Roa", worksiteIds: ["ws-bio"], canRequestParts: true },
    costCenters: [{ id: "cc-bio", name: "Taller", worksiteId: "ws-bio" }],
    spareParts: PARTS,
    ...extra,
  }
}

const stored = (extra: Partial<MantCatalog> = {}): StoredCatalog => ({ userId: "u-1", etag: '"v1"', fetchedAt: "2026-10-28T12:00:00.000Z", catalog: mantCatalog(extra), others: null })

function dataFor(catalogStored: StoredCatalog): AppData {
  return {
    deviceId: UUID(900), appVersion: "test", account: account("u-1"), accounts: [account("u-1")], stored: catalogStored,
    rows: buildRows(catalogStored, []), queue: [], online: true, now: Date.parse("2026-10-28T18:00:00.000Z"),
  }
}

function renderHome(catalogStored: StoredCatalog = stored()) {
  render(
    <AppDataProvider value={dataFor(catalogStored)}>
      <AppActionsProvider value={actions()}>
        <div id="mant-content"><PartsHomeSection /></div>
      </AppActionsProvider>
    </AppDataProvider>,
  )
}

const parts = async () => (await listQueue()).filter((item): item is QueuePartsNoteItem => item.type === "parts_note")
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }))
const line = (n: number) => within(screen.getByRole("group", { name: `Repuesto ${n}` }))
const search = (n = 1) => line(n).getByRole("combobox", { name: "¿Qué repuesto necesitas?" }) as HTMLInputElement
const type = (text: string, n = 1) => fireEvent.change(search(n), { target: { value: text } })
// Los `<option>` del selector de cargo también son «option»: sólo cuentan los de la lista del catálogo.
const listed = () => { const list = screen.queryByRole("listbox", { name: "Repuestos del catálogo" }); return list ? within(list).queryAllByRole("option") : [] }
const options = () => listed().map((option) => option.textContent)
const open = () => { renderHome(); click("Pedir repuestos") }

beforeEach(async () => {
  await freshDb()
  document.body.innerHTML = '<div id="mant-modals"></div>'
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe("buscar en el catálogo mientras se escribe", () => {
  it("filtra la lista local por nombre, código y N° de parte, sin tildes ni mayúsculas y sin pedir nada a la red", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    open()
    expect(screen.queryByRole("listbox")).toBeNull()

    type("FILTRO")
    expect(options()).toEqual(["Filtro de aceite motorREP-0001 · N° 1R-0750 · Unidad", "Filtro de aire primarioREP-0002 · N° AF 25957 · Unidad"])
    type("valvula")
    expect(options()).toEqual(["Válvula solenoide 24VREP-0003 · Unidad"])
    type("rep-0004")
    expect(options()).toEqual(["Aceite hidráulico ISO 68REP-0004 · N° HYD-68 · Litro"])
    type("1r0750")
    expect(options()).toEqual(["Filtro de aceite motorREP-0001 · N° 1R-0750 · Unidad"])
    expect(screen.getByRole("status").textContent).toContain("1 repuesto del catálogo")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("es un combobox con etiqueta, y con una sola letra todavía no ofrece nada", () => {
    open()
    const input = search()
    expect(input.getAttribute("aria-autocomplete")).toBe("list")
    expect(input.getAttribute("aria-expanded")).toBe("false")
    type("f")
    expect(screen.queryByRole("listbox")).toBeNull()
    type("fil")
    expect(input.getAttribute("aria-expanded")).toBe("true")
    expect(input.getAttribute("aria-controls")).toBe(screen.getByRole("listbox", { name: "Repuestos del catálogo" }).id)
  })

  it("lo que no está en el catálogo se dice, y se puede pedir igual con las palabras de quien pide", () => {
    open()
    type("zumbador de retroceso")
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(screen.getByRole("status").textContent).toBe("No está en el catálogo: se pedirá como lo escribiste.")
  })
})

describe("elegir un repuesto rellena la línea y la vincula al catálogo", () => {
  it("con un toque: nombre, N° de parte y unidad; el pedido viaja con productId y la unidad del repuesto", async () => {
    open()
    type("aceite hid")
    fireEvent.click(screen.getByRole("option", { name: /Aceite hidráulico ISO 68/ }))

    expect(search().value).toBe("Aceite hidráulico ISO 68")
    expect(screen.queryByRole("listbox")).toBeNull()
    expect((line(1).getByLabelText("N° de parte (opcional)") as HTMLInputElement).value).toBe("HYD-68")
    expect(screen.getByRole("status").textContent).toBe("Del catálogo · REP-0004 · N° HYD-68 · Unidad: Litro")
  })

  it("se envía con productId y unidad del catálogo; la línea libre del mismo pedido, con productId nulo", async () => {
    open()
    type("filtro de aire")
    fireEvent.click(screen.getByRole("option", { name: /Filtro de aire primario/ }))
    click("+ Otro repuesto")
    type("Silicona gris", 2)
    click("Enviar pedido")

    await waitFor(async () => expect(await parts()).toHaveLength(1))
    const [item] = await parts()
    expect(item!.payload.lines).toMatchObject([
      { description: "Filtro de aire primario", quantity: 1, unitOfMeasure: "unidad", partNumber: "AF 25957", productId: "p-aire" },
      { description: "Silicona gris", quantity: 1, unitOfMeasure: "unidad", partNumber: null, productId: null },
    ])
  })

  it("un repuesto en litros viaja con su unidad", async () => {
    open()
    type("hidraulico")
    fireEvent.click(screen.getByRole("option", { name: /Aceite hidráulico/ }))
    click("Enviar pedido")
    await waitFor(async () => expect(await parts()).toHaveLength(1))
    expect((await parts())[0]!.payload.lines[0]).toMatchObject({ productId: "p-hid", unitOfMeasure: "litro", partNumber: "HYD-68" })
  })

  it("escribir libre, aunque coincida con el catálogo, no vincula nada hasta que se elige", async () => {
    open()
    type("Filtro de aceite motor")
    expect(listed()).toHaveLength(1)
    click("Enviar pedido")
    await waitFor(async () => expect(await parts()).toHaveLength(1))
    expect((await parts())[0]!.payload.lines[0]).toMatchObject({ description: "Filtro de aceite motor", productId: null, unitOfMeasure: "unidad" })
  })

  it("editar el nombre después de elegir suelta el vínculo, la unidad y el N° de parte que venían del repuesto", async () => {
    open()
    type("hidraulico")
    fireEvent.click(screen.getByRole("option", { name: /Aceite hidráulico/ }))
    expect(screen.getByRole("status").textContent).toContain("Del catálogo")
    type("Aceite hidráulico ISO 68 especial")
    expect(screen.getByRole("status").textContent).not.toContain("Del catálogo")
    expect((line(1).getByLabelText("N° de parte (opcional)") as HTMLInputElement).value).toBe("")
    click("Enviar pedido")
    await waitFor(async () => expect(await parts()).toHaveLength(1))
    expect((await parts())[0]!.payload.lines[0]).toMatchObject({ description: "Aceite hidráulico ISO 68 especial", productId: null, unitOfMeasure: "unidad", partNumber: null })
  })

  it("un N° de parte escrito a mano se respeta si el repuesto elegido no trae uno", () => {
    open()
    click("+ N° de parte (opcional)")
    fireEvent.change(line(1).getByLabelText("N° de parte (opcional)"), { target: { value: "PN-77" } })
    type("valvula")
    fireEvent.click(screen.getByRole("option", { name: /Válvula solenoide/ }))
    expect((line(1).getByLabelText("N° de parte (opcional)") as HTMLInputElement).value).toBe("PN-77")
  })
})

describe("con el teclado", () => {
  it("las flechas mueven la opción activa (aria-activedescendant), Enter la elige y el foco no sale del campo", async () => {
    open()
    const input = search()
    input.focus()
    type("filtro")
    fireEvent.keyDown(input, { key: "ArrowDown" })
    fireEvent.keyDown(input, { key: "ArrowDown" })
    const [first, second] = listed()
    expect(first!.getAttribute("aria-selected")).toBe("false")
    expect(second!.getAttribute("aria-selected")).toBe("true")
    expect(input.getAttribute("aria-activedescendant")).toBe(second!.id)
    fireEvent.keyDown(input, { key: "ArrowUp" })
    expect(input.getAttribute("aria-activedescendant")).toBe(first!.id)
    fireEvent.keyDown(input, { key: "ArrowDown" })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(input.value).toBe("Filtro de aire primario")
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(document.activeElement).toBe(input)
    click("Enviar pedido")
    await waitFor(async () => expect(await parts()).toHaveLength(1))
    expect((await parts())[0]!.payload.lines[0]).toMatchObject({ productId: "p-aire" })
  })

  it("Enter sin opción activa no elige nada; ArrowDown vuelve a abrir la lista cerrada", () => {
    open()
    const input = search()
    type("filtro")
    fireEvent.keyDown(input, { key: "Enter" })
    expect(input.value).toBe("filtro")
    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.queryByRole("listbox")).toBeNull()
    fireEvent.keyDown(input, { key: "ArrowDown" })
    expect(listed()).toHaveLength(2)
  })

  it("Escape cierra la lista y deja la hoja abierta (con la lista cerrada, Escape sí cierra la hoja)", () => {
    open()
    const input = search()
    input.focus()
    type("filtro")
    fireEvent.keyDown(input, { key: "Escape" })
    // La hoja dejó pasar el primer Escape (el combobox estaba expandido): sólo se cerró la lista.
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(screen.getByRole("dialog", { name: "Pedir repuestos" })).toBeTruthy()
    expect(screen.queryByRole("alertdialog")).toBeNull()
    // Con la lista cerrada, el siguiente Escape es de la hoja: como hay algo escrito, pregunta antes de descartar.
    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.getByRole("alertdialog").textContent).toContain("¿Descartar lo que escribiste?")
  })

  it("al salir del campo la lista se cierra", () => {
    open()
    type("filtro")
    expect(screen.getByRole("listbox")).toBeTruthy()
    fireEvent.blur(search())
    expect(screen.queryByRole("listbox")).toBeNull()
  })
})

describe("sin catálogo de repuestos y con OT", () => {
  it("un catálogo antiguo (sin repuestos) deja el campo de texto de siempre, sin combobox ni avisos", async () => {
    renderHome(stored({ spareParts: undefined }))
    click("Pedir repuestos")
    expect(line(1).queryByRole("combobox", { name: "¿Qué repuesto necesitas?" })).toBeNull()
    fireEvent.change(line(1).getByLabelText("¿Qué repuesto necesitas?"), { target: { value: "Filtro de aceite" } })
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(screen.queryByText(/catálogo/i)).toBeNull()
    click("Enviar pedido")
    await waitFor(async () => expect(await parts()).toHaveLength(1))
    expect((await parts())[0]!.payload.lines[0]).toMatchObject({ productId: null, unitOfMeasure: "unidad" })
  })

  it("el pedido de una OT también busca en el catálogo y viaja con su OT", async () => {
    const catalogStored: StoredCatalog = { ...stored({ workOrders: [workOrder()] }) }
    const data = dataFor(catalogStored)
    const view = buildOtViews(catalogStored.catalog, [], { id: "u-1", name: "Javier Roa" }).mine[0]!
    render(
      <AppDataProvider value={data}>
        <AppActionsProvider value={actions()}>
          <PartsNoteSheet view={view} onClose={() => {}} onSaved={() => {}} />
        </AppActionsProvider>
      </AppDataProvider>,
    )
    type("1r-0750")
    fireEvent.click(screen.getByRole("option", { name: /Filtro de aceite motor/ }))
    click("Enviar pedido")
    await waitFor(async () => expect(await parts()).toHaveLength(1))
    const [item] = await parts()
    expect(item!.payload).toMatchObject({ workOrderId: "ot-1", lines: [{ description: "Filtro de aceite motor", productId: "p-aceite", partNumber: "1R-0750", unitOfMeasure: "unidad" }] })
    expect(item!.payload).not.toHaveProperty("worksiteId")
  })
})
