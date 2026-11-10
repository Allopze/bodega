/**
 * Catalogar al comprar (T7): las acciones de servidor de la hoja «Catalogar».
 * La autorización se decide en el servidor, no en la UI:
 *
 *  - buscar, vincular y quitar el vínculo exigen `purchasing:create_order`;
 *  - crear un repuesto nuevo exige `repuestos:catalog` además de poder armar la OC
 *    (quien sólo compra puede vincular uno existente, no ensuciar el catálogo para
 *    todos).
 *
 * Vincular y crear escriben el vínculo en el ítem de solicitud al elegir (FF-6): el
 * servicio de vínculo se simula aquí; su comportamiento contra Postgres real está en
 * `spare-part-item-link-pglite.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

vi.mock("@/lib/services/module-toggles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/module-toggles")>()),
  assertPermissionModuleEnabled: vi.fn(async () => {}),
  assertRouteModuleEnabled: vi.fn(async () => {}),
}))

const mockAuth = vi.hoisted(() => vi.fn())
const mockSearch = vi.hoisted(() => vi.fn())
const mockFindByPartNumber = vi.hoisted(() => vi.fn())
const mockCreateAndLink = vi.hoisted(() => vi.fn())
const mockLink = vi.hoisted(() => vi.fn())
const mockUnlink = vi.hoisted(() => vi.fn())
const mockLinkInfo = vi.hoisted(() => vi.fn())

const mockLogger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }))
vi.mock("@/lib/logger", () => ({ logger: mockLogger }))
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/services/spare-parts-catalog", () => ({
  searchSpareParts: mockSearch,
  findSparePartByPartNumber: mockFindByPartNumber,
}))
vi.mock("@/lib/services/purchasing-module/spare-part-link", () => ({ getSparePartLinkInfo: mockLinkInfo }))
vi.mock("@/lib/services/purchasing-module/spare-part-item-link", () => ({
  createSparePartAndLinkToRequestItem: mockCreateAndLink,
  linkSparePartToRequestItem: mockLink,
  unlinkSparePartFromRequestItem: mockUnlink,
}))

import {
  createSparePartForOcAction,
  linkSparePartForOcAction,
  searchSparePartsForOcAction,
  unlinkSparePartForOcAction,
} from "@/app/(app)/compras/actions"

function session(permissions: string[]): Session {
  return {
    expires: "2099-01-01",
    user: { id: "user-1", email: "compras@test.cl", name: "Compras", permissions, roleSlugs: [], worksiteIds: [], isGlobal: true },
  } as unknown as Session
}

const LISTED = (id: string) => ({
  id, sku: `RPT-${id}`, name: `Repuesto ${id}`, partNumber: `PN-${id}`, partBrand: null, unitOfMeasure: "unidad", isActive: true,
  preferredSupplierId: null, preferredSupplierName: null, lastSupplierName: null, lastPrice: 1000, referencePrice: 800, lastPurchasedAt: null, vehicleCount: 0,
  purchasedForVehicleIds: [], vehicleMatch: null,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockSearch.mockResolvedValue({ parts: [LISTED("1"), LISTED("2")], total: 2 })
  mockFindByPartNumber.mockResolvedValue(null)
  mockCreateAndLink.mockResolvedValue({ id: "new-1", sku: "RPT-001" })
  mockLink.mockResolvedValue(undefined)
  mockUnlink.mockResolvedValue(undefined)
  mockLinkInfo.mockResolvedValue({
    id: "new-1", sku: "RPT-001", name: "Filtro", partNumber: "AF-1", partBrand: null, unitOfMeasure: "unidad", prices: {},
  })
})

describe("buscar y vincular: purchasing:create_order", () => {
  it("sin el permiso no consulta nada", async () => {
    mockAuth.mockResolvedValue(session(["repuestos:catalog"]))
    expect(await searchSparePartsForOcAction({ query: "filtro" })).toMatchObject({ ok: false })
    expect(await linkSparePartForOcAction({ requestItemId: "item-1", productId: "p-1" })).toMatchObject({ ok: false })
    expect(await unlinkSparePartForOcAction({ requestItemId: "item-1" })).toMatchObject({ ok: false })
    expect(mockSearch).not.toHaveBeenCalled()
    expect(mockLink).not.toHaveBeenCalled()
    expect(mockUnlink).not.toHaveBeenCalled()
    expect(mockLinkInfo).not.toHaveBeenCalled()
  })

  it("sin sesión tampoco", async () => {
    mockAuth.mockResolvedValue(null)
    expect(await searchSparePartsForOcAction({ query: "" })).toMatchObject({ ok: false })
  })

  it("busca con el vehículo de la línea y devuelve la sugerencia por N° de parte", async () => {
    mockAuth.mockResolvedValue(session(["purchasing:create_order"]))
    mockFindByPartNumber.mockResolvedValue({ id: "2" })
    const result = await searchSparePartsForOcAction({ query: "  ", vehicleId: "v-1", partNumber: "PN-2", requestId: "req-1" })
    // La solicitud de la línea no cuenta como «ya se compró para este equipo».
    expect(mockSearch).toHaveBeenCalledWith({ query: undefined, vehicleId: "v-1", vehicleScope: "all", excludeRequestId: "req-1", limit: 40 })
    expect(mockFindByPartNumber).toHaveBeenCalledWith("PN-2")
    expect(result).toMatchObject({ ok: true, total: 2, suggestion: { id: "2", sku: "RPT-2" } })
    // Sólo viajan los campos que la hoja necesita.
    expect(result.ok && Object.keys(result.parts[0]!).sort()).toEqual(
      ["id", "lastPrice", "lastPurchasedAt", "name", "partBrand", "partNumber", "referencePrice", "sku", "unitOfMeasure", "vehicleMatch"],
    )
  })

  it("con una sesión de faena, el orden por equipo y «mismo modelo» se acotan a sus faenas", async () => {
    mockAuth.mockResolvedValue({
      ...session(["purchasing:create_order"]),
      user: { ...session([]).user, permissions: ["purchasing:create_order"], worksiteIds: ["ws-1"], isGlobal: false },
    })
    await searchSparePartsForOcAction({ query: "filtro", vehicleId: "v-1" })
    expect(mockSearch).toHaveBeenCalledWith({ query: "filtro", vehicleId: "v-1", vehicleScope: ["ws-1"], limit: 40 })
  })

  it("no busca sugerencia sin N° de parte, y pide el tope de 40 al servicio con el total real", async () => {
    mockAuth.mockResolvedValue(session(["purchasing:create_order"]))
    mockSearch.mockResolvedValue({ parts: Array.from({ length: 40 }, (_, i) => LISTED(String(i))), total: 55 })
    const result = await searchSparePartsForOcAction({ query: "filtro" })
    expect(mockSearch).toHaveBeenCalledWith({ query: "filtro", vehicleId: undefined, vehicleScope: "all", limit: 40 })
    expect(mockFindByPartNumber).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, total: 55, suggestion: null })
    expect(result.ok && result.parts).toHaveLength(40)
  })

  it("la sugerencia fuera del tope se lee aparte, con el vehículo de la línea", async () => {
    mockAuth.mockResolvedValue(session(["purchasing:create_order"]))
    mockFindByPartNumber.mockResolvedValue({ id: "99" })
    mockSearch
      .mockResolvedValueOnce({ parts: [LISTED("1")], total: 120 })
      .mockResolvedValueOnce({ parts: [LISTED("99")], total: 1 })
    const result = await searchSparePartsForOcAction({ query: "", vehicleId: "v-1", partNumber: "PN-99" })
    expect(mockSearch).toHaveBeenLastCalledWith({ ids: ["99"], vehicleId: "v-1", vehicleScope: "all" })
    expect(result).toMatchObject({ ok: true, suggestion: { id: "99", unitOfMeasure: "unidad" } })
  })

  it("vincular guarda el vínculo en el ítem, a nombre del usuario, y devuelve el repuesto con sus precios", async () => {
    mockAuth.mockResolvedValue(session(["purchasing:create_order"]))
    expect(await linkSparePartForOcAction({ requestItemId: "item-1", productId: "new-1" })).toMatchObject({ ok: true, part: { id: "new-1", sku: "RPT-001" } })
    expect(mockLink).toHaveBeenCalledWith({
      requestItemId: "item-1", productId: "new-1",
      actor: { userId: "user-1", userEmail: "compras@test.cl", worksiteScope: "all" },
    })
  })

  it("con una sesión de faena, el vínculo se acota a sus faenas", async () => {
    mockAuth.mockResolvedValue({
      ...session(["purchasing:create_order"]),
      user: { ...session([]).user, permissions: ["purchasing:create_order"], worksiteIds: ["ws-1"], isGlobal: false },
    })
    await linkSparePartForOcAction({ requestItemId: "item-1", productId: "new-1" })
    expect(mockLink).toHaveBeenCalledWith(expect.objectContaining({ actor: expect.objectContaining({ worksiteScope: ["ws-1"] }) }))
  })

  it("si el repuesto ya no está en el catálogo tras vincular, lo dice", async () => {
    mockAuth.mockResolvedValue(session(["purchasing:create_order"]))
    mockLinkInfo.mockResolvedValue(null)
    expect(await linkSparePartForOcAction({ requestItemId: "item-1", productId: "gone" })).toEqual({
      ok: false, message: "El repuesto ya no está disponible en el catálogo",
    })
  })

  it("un rechazo del servicio (otra unidad, otro producto, ítem ya en una OC) llega tal cual y no se registra como fallo", async () => {
    mockAuth.mockResolvedValue(session(["purchasing:create_order"]))
    mockLink.mockRejectedValue(new Error("El repuesto RPT-001 se compra por «unidad» y la línea pide «juego»; elige otro o crea uno nuevo"))
    expect(await linkSparePartForOcAction({ requestItemId: "item-1", productId: "new-1" })).toEqual({
      ok: false, message: "El repuesto RPT-001 se compra por «unidad» y la línea pide «juego»; elige otro o crea uno nuevo",
    })
    expect(mockLinkInfo).not.toHaveBeenCalled()
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it("exige la línea y el repuesto antes de tocar nada", async () => {
    mockAuth.mockResolvedValue(session(["purchasing:create_order"]))
    expect(await linkSparePartForOcAction({ requestItemId: "", productId: "new-1" })).toMatchObject({ ok: false })
    expect(await linkSparePartForOcAction({ requestItemId: "item-1", productId: " " })).toMatchObject({ ok: false })
    expect(mockLink).not.toHaveBeenCalled()
  })
})

describe("quitar el vínculo: purchasing:create_order", () => {
  it("lo pide al servicio con la línea y el actor, y avisa si se rechaza", async () => {
    mockAuth.mockResolvedValue(session(["purchasing:create_order"]))
    expect(await unlinkSparePartForOcAction({ requestItemId: "item-1" })).toEqual({ ok: true })
    expect(mockUnlink).toHaveBeenCalledWith({
      requestItemId: "item-1",
      actor: { userId: "user-1", userEmail: "compras@test.cl", worksiteScope: "all" },
    })

    mockUnlink.mockRejectedValue(new Error("El ítem ya está en una orden de compra: elimínala o anúlala antes de cambiar el repuesto"))
    expect(await unlinkSparePartForOcAction({ requestItemId: "item-1" })).toEqual({
      ok: false, message: "El ítem ya está en una orden de compra: elimínala o anúlala antes de cambiar el repuesto",
    })
  })

  it("un fallo del driver no filtra el SQL", async () => {
    mockAuth.mockResolvedValue(session(["purchasing:create_order"]))
    mockUnlink.mockRejectedValue(Object.assign(new Error("Failed query: update purchase_request_items ..."), { query: "update" }))
    expect(await unlinkSparePartForOcAction({ requestItemId: "item-1" })).toEqual({ ok: false, message: "No se pudo quitar el vínculo" })
  })
})

describe("crear: repuestos:catalog", () => {
  const CREATE = { requestItemId: "item-1", name: "Filtro", unitOfMeasure: "unidad" }

  it("quien sólo puede comprar no crea repuestos", async () => {
    mockAuth.mockResolvedValue(session(["purchasing:create_order"]))
    expect(await createSparePartForOcAction(CREATE)).toEqual({
      ok: false, message: "Sin permisos para crear repuestos en el catálogo",
    })
    expect(mockCreateAndLink).not.toHaveBeenCalled()
  })

  it("quien sólo administra el catálogo no escribe vínculos en las líneas de una OC", async () => {
    mockAuth.mockResolvedValue(session(["repuestos:catalog"]))
    expect(await createSparePartForOcAction(CREATE)).toEqual({
      ok: false, message: "Sin permisos para vincular repuestos a una orden de compra",
    })
    expect(mockCreateAndLink).not.toHaveBeenCalled()
  })

  it("con los dos permisos crea y vincula en una sola operación, a nombre del usuario, y devuelve el repuesto", async () => {
    mockAuth.mockResolvedValue(session(["purchasing:create_order", "repuestos:catalog"]))
    const result = await createSparePartForOcAction({
      requestItemId: "item-1", name: "  Filtro de aire ", partNumber: " AF-1 ", partBrand: "", unitOfMeasure: "Unidad",
    })
    expect(mockCreateAndLink).toHaveBeenCalledWith({
      requestItemId: "item-1",
      sparePart: { name: "Filtro de aire", partNumber: "AF-1", partBrand: null, unitOfMeasure: "unidad" },
      actor: { userId: "user-1", userEmail: "compras@test.cl", worksiteScope: "all" },
    })
    expect(mockLinkInfo).toHaveBeenCalledWith("new-1")
    expect(result).toMatchObject({ ok: true, part: { id: "new-1", sku: "RPT-001" } })
  })

  it("valida el nombre antes de tocar el catálogo", async () => {
    mockAuth.mockResolvedValue(session(["purchasing:create_order", "repuestos:catalog"]))
    const result = await createSparePartForOcAction({ ...CREATE, name: "   " })
    expect(result).toEqual({ ok: false, message: "Escribe el nombre del repuesto" })
    expect(mockCreateAndLink).not.toHaveBeenCalled()
  })

  it("sin la línea no crea nada", async () => {
    mockAuth.mockResolvedValue(session(["purchasing:create_order", "repuestos:catalog"]))
    expect(await createSparePartForOcAction({ ...CREATE, requestItemId: "" })).toMatchObject({ ok: false })
    expect(mockCreateAndLink).not.toHaveBeenCalled()
  })

  it("un N° de parte repetido llega al usuario con el SKU del existente", async () => {
    mockAuth.mockResolvedValue(session(["purchasing:create_order", "repuestos:catalog"]))
    mockCreateAndLink.mockRejectedValue(new Error("Ya existe el repuesto RPT-001 con ese N° de parte"))
    expect(await createSparePartForOcAction({ ...CREATE, partNumber: "AF-1" })).toEqual({
      ok: false, message: "Ya existe el repuesto RPT-001 con ese N° de parte",
    })
    // Es una validación de negocio esperada, no un fallo: no va al log de errores.
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it("un fallo del driver sí se registra como error y no filtra el SQL", async () => {
    mockAuth.mockResolvedValue(session(["purchasing:create_order", "repuestos:catalog"]))
    mockLogger.error.mockClear()
    mockCreateAndLink.mockRejectedValue(Object.assign(new Error("Failed query: insert into products ..."), { query: "insert into products" }))
    expect(await createSparePartForOcAction({ ...CREATE, partNumber: "AF-2" })).toEqual({
      ok: false, message: "No se pudo crear el repuesto",
    })
    expect(mockLogger.error).toHaveBeenCalled()
  })
})
