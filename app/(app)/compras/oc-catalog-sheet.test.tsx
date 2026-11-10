// @vitest-environment jsdom
/**
 * Catalogar al comprar (fase 2 del catálogo de repuestos, 2026-11-09): la hoja
 * que abre «Catalogar» en la línea de la OC. Dos caminos —vincular a un repuesto
 * existente o crear uno nuevo prellenado—, y crear sólo con `repuestos:catalog`.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LinkedSparePart, PendingItemOption } from "./oc-form.types"

const search = vi.fn()
const link = vi.fn()
const create = vi.fn()
vi.mock("./actions", () => ({
  searchSparePartsForOcAction: (...args: unknown[]) => search(...args),
  linkSparePartForOcAction: (...args: unknown[]) => link(...args),
  createSparePartForOcAction: (...args: unknown[]) => create(...args),
}))
const toastSuccess = vi.fn()
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: (...args: unknown[]) => toastSuccess(...args) } }))

const { OcCatalogSheet } = await import("./oc-catalog-sheet")

const LINE: PendingItemOption = {
  id: "item-1", requestId: "req-1", requestCode: "REP-0001", worksiteId: "ws-1", worksiteName: "Faena",
  productName: "Filtro de aire camión", productSku: null, productId: null, productNameFree: "Filtro de aire camión",
  quantity: 2, unitOfMeasure: "unidad", urgency: "normal", notes: null, supplierPrices: {},
  deliveryMode: "directo_faena", isService: false, requestType: "repuestos", vehicleId: "v-1", requestedPartNumber: "AF-100",
}

const FILTER = {
  id: "rpt-1", sku: "RPT-001", name: "Filtro de aire primario", partNumber: "AF-100", partBrand: "Donaldson",
  unitOfMeasure: "unidad", lastPrice: 21_000, lastPurchasedAt: "2026-10-15T12:00:00.000Z", vehicleMatch: "vehicle" as const,
}
const OTHER = {
  id: "rpt-2", sku: "RPT-002", name: "Filtro de combustible", partNumber: "FF-200", partBrand: null,
  unitOfMeasure: "Unidad", lastPrice: null, lastPurchasedAt: null, vehicleMatch: null,
}
const LINKED: LinkedSparePart = {
  id: "rpt-1", sku: "RPT-001", name: "Filtro de aire primario", partNumber: "AF-100", partBrand: "Donaldson",
  unitOfMeasure: "unidad", prices: { "sup-1": 21_000 },
}

function open(props: {
  canCreate?: boolean
  onLink?: (id: string, part: LinkedSparePart) => void
  onOpenChange?: (open: boolean) => void
  item?: PendingItemOption
  unitLabels?: Record<string, string>
} = {}) {
  return render(
    <OcCatalogSheet
      item={props.item ?? LINE}
      canCreate={props.canCreate ?? true}
      unitLabels={props.unitLabels}
      onOpenChange={props.onOpenChange ?? (() => {})}
      onLink={props.onLink ?? (() => {})}
    />,
  )
}

beforeEach(() => {
  search.mockReset()
  link.mockReset()
  create.mockReset()
  toastSuccess.mockReset()
  search.mockResolvedValue({ ok: true, parts: [FILTER, OTHER], total: 2, suggestion: FILTER })
})
afterEach(cleanup)

describe("OcCatalogSheet — vincular a un repuesto existente", () => {
  it("pide el catálogo ordenado para el equipo de la línea y sugiere por el N° de parte que escribió quien pidió", async () => {
    open()
    await screen.findByText("Coincide por N° de parte")
    // La propia solicitud no cuenta como «ya se compró para este equipo».
    expect(search).toHaveBeenCalledWith({ query: "", vehicleId: "v-1", requestId: "req-1", partNumber: "AF-100" })
    // La sugerencia no se repite en la lista de abajo.
    expect(screen.getAllByText("Filtro de aire primario")).toHaveLength(1)
    expect(screen.getByText("Filtro de combustible")).toBeTruthy()
  })

  it("vincular la sugerencia confirma el repuesto en el servidor y entrega el vínculo a la línea", async () => {
    link.mockResolvedValue({ ok: true, part: LINKED })
    const onLink = vi.fn()
    const onOpenChange = vi.fn()
    open({ onLink, onOpenChange })
    fireEvent.click(await screen.findByRole("button", { name: "Vincular este" }))

    await waitFor(() => expect(onLink).toHaveBeenCalledWith("item-1", LINKED))
    // El vínculo se guarda en la línea al elegir, no al crear la OC (FF-6).
    expect(link).toHaveBeenCalledWith({ requestItemId: "item-1", productId: "rpt-1" })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("elegir un repuesto de la lista lo vincula; un fallo del servidor se dice y no cierra la hoja", async () => {
    link.mockResolvedValue({ ok: false, message: "El repuesto ya no está disponible en el catálogo" })
    const onLink = vi.fn()
    const onOpenChange = vi.fn()
    open({ onLink, onOpenChange })
    fireEvent.click(await screen.findByRole("button", { name: /Filtro de combustible/ }))

    expect((await screen.findByRole("alert")).textContent).toContain("ya no está disponible")
    expect(onLink).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it("muestra por qué un repuesto sube: ya se compró para este equipo, con su último precio", async () => {
    open()
    await screen.findByText("Coincide por N° de parte")
    search.mockResolvedValue({ ok: true, parts: [FILTER], total: 1, suggestion: null })
    fireEvent.change(screen.getByLabelText("Buscar en el catálogo"), { target: { value: "aire" } })
    expect(await screen.findByText("Ya se compró para este equipo")).toBeTruthy()
    expect(screen.getByText(/21\.000/)).toBeTruthy()
    expect(search).toHaveBeenLastCalledWith({ query: "aire", vehicleId: "v-1", requestId: "req-1", partNumber: null })
  })

  it("muestra la unidad de cada repuesto y deja a la vista, sin poder elegirlo, el que se compra en otra", async () => {
    const KIT = { ...OTHER, id: "rpt-3", sku: "RPT-003", name: "Kit de juntas", unitOfMeasure: "juego" }
    search.mockResolvedValue({ ok: true, parts: [KIT, OTHER], total: 2, suggestion: null })
    open()
    const kit = await screen.findByRole("button", { name: /Kit de juntas/ })
    expect(kit.textContent).toContain("por juego")
    expect(kit.textContent).toContain("Se compra por «juego» y esta línea pide «unidad»")
    // Sigue enfocable: aria-disabled y la razón como descripción, no `disabled` nativo.
    expect((kit as HTMLButtonElement).disabled).toBe(false)
    expect(kit.getAttribute("aria-disabled")).toBe("true")
    expect(document.getElementById(kit.getAttribute("aria-describedby") ?? "")?.textContent)
      .toBe("Se compra por «juego» y esta línea pide «unidad»")
    fireEvent.click(kit)
    expect(link).not.toHaveBeenCalled()

    // «Unidad» y «unidad» son la misma: se elige. Y el compatible va primero.
    const same = screen.getByRole("button", { name: /Filtro de combustible/ })
    expect((same as HTMLButtonElement).disabled).toBe(false)
    expect(same.getAttribute("aria-disabled")).toBeNull()
    expect(same.textContent).toContain("por unidad")
    const order = screen.getAllByRole("listitem").map((li) => li.textContent ?? "")
    expect(order[0]).toContain("Filtro de combustible")
  })

  it("nombra las unidades con su rótulo del catálogo de unidades, no con el código", async () => {
    const DRUM = { ...OTHER, id: "rpt-4", sku: "RPT-004", name: "Aceite hidráulico", unitOfMeasure: "bidon" }
    search.mockResolvedValue({ ok: true, parts: [DRUM], total: 1, suggestion: null })
    open({ unitLabels: { unidad: "Unidad", bidon: "Bidón" } })
    const drum = await screen.findByRole("button", { name: /Aceite hidráulico/ })
    expect(drum.textContent).toContain("por bidón")
    expect(drum.textContent).toContain("Se compra por «bidón» y esta línea pide «unidad»")
  })

  it("la sugerencia en otra unidad dice por qué y no se puede vincular", async () => {
    search.mockResolvedValue({ ok: true, parts: [OTHER], total: 1, suggestion: { ...FILTER, unitOfMeasure: "caja" } })
    open()
    await screen.findByText("Coincide por N° de parte")
    expect(screen.getByText("Se compra por «caja» y esta línea pide «unidad»")).toBeTruthy()
    const linkButton = screen.getByRole("button", { name: "Vincular este" })
    expect(linkButton.getAttribute("aria-disabled")).toBe("true")
    expect(document.getElementById(linkButton.getAttribute("aria-describedby") ?? "")?.textContent)
      .toBe("Se compra por «caja» y esta línea pide «unidad»")
    fireEvent.click(linkButton)
    expect(link).not.toHaveBeenCalled()
  })

  it("con el catálogo vacío ofrece crear el repuesto (si puede) en vez de un callejón sin salida", async () => {
    search.mockResolvedValue({ ok: true, parts: [], total: 0, suggestion: null })
    open({ canCreate: true })
    expect(await screen.findByText("El catálogo de repuestos está vacío")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Crear repuesto nuevo" }))
    expect(await screen.findByLabelText(/Nombre del repuesto/)).toBeTruthy()
  })

  it("sin permiso para crear, el vacío lo dice y no hay segundo camino", async () => {
    search.mockResolvedValue({ ok: true, parts: [], total: 0, suggestion: null })
    open({ canCreate: false })
    expect(await screen.findByText("El catálogo de repuestos está vacío")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Crear repuesto nuevo" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Crear uno nuevo" })).toBeNull()
  })
})

describe("OcCatalogSheet — crear un repuesto nuevo", () => {
  async function goToCreate() {
    open({ canCreate: true })
    await screen.findByText("Coincide por N° de parte")
    fireEvent.click(screen.getByRole("button", { name: "Crear uno nuevo" }))
    return screen.findByLabelText(/Nombre del repuesto/) as Promise<HTMLInputElement>
  }

  it("se prellena con la descripción y el N° de parte de la línea, y deja la marca vacía", async () => {
    const name = await goToCreate()
    expect(name.value).toBe("Filtro de aire camión")
    expect((screen.getByLabelText("N° de parte") as HTMLInputElement).value).toBe("AF-100")
    expect((screen.getByLabelText("Marca del repuesto") as HTMLInputElement).value).toBe("")
    expect(screen.getByText("Unidad de medida: unidad")).toBeTruthy()
  })

  it("la unidad de la línea se muestra con su rótulo", async () => {
    open({ canCreate: true, item: { ...LINE, unitOfMeasure: "bidon" }, unitLabels: { bidon: "Bidón" } })
    await screen.findByText("Coincide por N° de parte")
    fireEvent.click(screen.getByRole("button", { name: "Crear uno nuevo" }))
    expect(await screen.findByText("Unidad de medida: Bidón")).toBeTruthy()
  })

  it("crea con los datos editados, la unidad de la línea, y vincula el repuesto nuevo", async () => {
    create.mockResolvedValue({ ok: true, part: LINKED })
    const onLink = vi.fn()
    open({ canCreate: true, onLink })
    await screen.findByText("Coincide por N° de parte")
    fireEvent.click(screen.getByRole("button", { name: "Crear uno nuevo" }))
    fireEvent.change(await screen.findByLabelText("Marca del repuesto"), { target: { value: "Donaldson" } })
    fireEvent.click(screen.getByRole("button", { name: "Crear y vincular" }))

    await waitFor(() => expect(onLink).toHaveBeenCalledWith("item-1", LINKED))
    // Crea y vincula a la línea en el servidor, en la misma llamada (FF-6).
    expect(create).toHaveBeenCalledWith({
      requestItemId: "item-1", name: "Filtro de aire camión", partNumber: "AF-100", partBrand: "Donaldson", unitOfMeasure: "unidad",
    })
    // La hoja se cierra: el aviso dice que el catálogo ganó un repuesto.
    expect(toastSuccess).toHaveBeenCalledWith("Repuesto RPT-001 creado en el catálogo y vinculado a la línea")
  })

  it("un N° de parte repetido se informa en la hoja y no vincula nada", async () => {
    create.mockResolvedValue({ ok: false, message: "Ya existe el repuesto RPT-001 con ese N° de parte" })
    const onLink = vi.fn()
    open({ canCreate: true, onLink })
    await screen.findByText("Coincide por N° de parte")
    fireEvent.click(screen.getByRole("button", { name: "Crear uno nuevo" }))
    fireEvent.click(await screen.findByRole("button", { name: "Crear y vincular" }))

    expect((await screen.findByRole("alert")).textContent).toContain("Ya existe el repuesto RPT-001")
    expect(onLink).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it("sin nombre no se puede crear", async () => {
    const name = await goToCreate()
    fireEvent.change(name, { target: { value: "  " } })
    expect((screen.getByRole("button", { name: "Crear y vincular" }) as HTMLButtonElement).disabled).toBe(true)
  })
})
