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
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const { OcCatalogSheet } = await import("./oc-catalog-sheet")

const LINE: PendingItemOption = {
  id: "item-1", requestId: "req-1", requestCode: "REP-0001", worksiteId: "ws-1", worksiteName: "Faena",
  productName: "Filtro de aire camión", productSku: null, productId: null, productNameFree: "Filtro de aire camión",
  quantity: 2, unitOfMeasure: "unidad", urgency: "normal", notes: null, supplierPrices: {},
  deliveryMode: "directo_faena", isService: false, requestType: "repuestos", vehicleId: "v-1", requestedPartNumber: "AF-100",
}

const FILTER = {
  id: "rpt-1", sku: "RPT-001", name: "Filtro de aire primario", partNumber: "AF-100", partBrand: "Donaldson",
  lastPrice: 21_000, lastPurchasedAt: "2026-10-15T12:00:00.000Z", vehicleMatch: "vehicle" as const,
}
const OTHER = {
  id: "rpt-2", sku: "RPT-002", name: "Filtro de combustible", partNumber: "FF-200", partBrand: null,
  lastPrice: null, lastPurchasedAt: null, vehicleMatch: null,
}
const LINKED: LinkedSparePart = {
  id: "rpt-1", sku: "RPT-001", name: "Filtro de aire primario", partNumber: "AF-100", partBrand: "Donaldson",
  unitOfMeasure: "unidad", prices: { "sup-1": 21_000 },
}

function open(props: { canCreate?: boolean; onLink?: (id: string, part: LinkedSparePart) => void; onOpenChange?: (open: boolean) => void } = {}) {
  return render(
    <OcCatalogSheet
      item={LINE}
      canCreate={props.canCreate ?? true}
      onOpenChange={props.onOpenChange ?? (() => {})}
      onLink={props.onLink ?? (() => {})}
    />,
  )
}

beforeEach(() => {
  search.mockReset()
  link.mockReset()
  create.mockReset()
  search.mockResolvedValue({ ok: true, parts: [FILTER, OTHER], total: 2, suggestion: FILTER })
})
afterEach(cleanup)

describe("OcCatalogSheet — vincular a un repuesto existente", () => {
  it("pide el catálogo ordenado para el equipo de la línea y sugiere por el N° de parte que escribió quien pidió", async () => {
    open()
    await screen.findByText("Coincide por N° de parte")
    expect(search).toHaveBeenCalledWith({ query: "", vehicleId: "v-1", partNumber: "AF-100" })
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
    expect(link).toHaveBeenCalledWith({ productId: "rpt-1" })
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
    expect(search).toHaveBeenLastCalledWith({ query: "aire", vehicleId: "v-1", partNumber: null })
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

  it("crea con los datos editados, la unidad de la línea, y vincula el repuesto nuevo", async () => {
    create.mockResolvedValue({ ok: true, part: LINKED })
    const onLink = vi.fn()
    open({ canCreate: true, onLink })
    await screen.findByText("Coincide por N° de parte")
    fireEvent.click(screen.getByRole("button", { name: "Crear uno nuevo" }))
    fireEvent.change(await screen.findByLabelText("Marca del repuesto"), { target: { value: "Donaldson" } })
    fireEvent.click(screen.getByRole("button", { name: "Crear y vincular" }))

    await waitFor(() => expect(onLink).toHaveBeenCalledWith("item-1", LINKED))
    expect(create).toHaveBeenCalledWith({
      name: "Filtro de aire camión", partNumber: "AF-100", partBrand: "Donaldson", unitOfMeasure: "unidad",
    })
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
  })

  it("sin nombre no se puede crear", async () => {
    const name = await goToCreate()
    fireEvent.change(name, { target: { value: "  " } })
    expect((screen.getByRole("button", { name: "Crear y vincular" }) as HTMLButtonElement).disabled).toBe(true)
  })
})
