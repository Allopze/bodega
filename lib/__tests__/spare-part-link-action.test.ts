/**
 * Catalogar al comprar (T7): las acciones de servidor de la hoja «Catalogar».
 * La autorización se decide en el servidor, no en la UI:
 *
 *  - buscar y vincular exigen `purchasing:create_order`;
 *  - crear un repuesto nuevo exige `repuestos:catalog` (quien sólo compra puede
 *    vincular uno existente, no ensuciar el catálogo para todos).
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
const mockCreate = vi.hoisted(() => vi.fn())
const mockLinkInfo = vi.hoisted(() => vi.fn())
const fakeTx = vi.hoisted(() => ({ tag: "tx" }))

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/db", () => ({
  db: { transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(fakeTx)) },
}))
vi.mock("@/lib/services/spare-parts-catalog", () => ({
  searchSpareParts: mockSearch,
  findSparePartByPartNumber: mockFindByPartNumber,
  createSparePartTx: mockCreate,
}))
vi.mock("@/lib/services/purchasing-module/spare-part-link", () => ({ getSparePartLinkInfo: mockLinkInfo }))

import {
  createSparePartForOcAction,
  linkSparePartForOcAction,
  searchSparePartsForOcAction,
} from "@/app/(app)/compras/actions"

function session(permissions: string[]): Session {
  return {
    expires: "2099-01-01",
    user: { id: "user-1", email: "compras@test.cl", name: "Compras", permissions, roleSlugs: [], worksiteIds: [], isGlobal: true },
  } as unknown as Session
}

const LISTED = (id: string) => ({
  id, sku: `RPT-${id}`, name: `Repuesto ${id}`, partNumber: `PN-${id}`, partBrand: null, unitOfMeasure: "unidad", isActive: true,
  preferredSupplierId: null, preferredSupplierName: null, lastSupplierName: null, lastPrice: 1000, referencePrice: null, lastPurchasedAt: null, vehicleCount: 0,
  purchasedForVehicleIds: [], vehicleMatch: null,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockSearch.mockResolvedValue({ parts: [LISTED("1"), LISTED("2")], total: 2 })
  mockFindByPartNumber.mockResolvedValue(null)
  mockCreate.mockResolvedValue({ id: "new-1", sku: "RPT-001" })
  mockLinkInfo.mockResolvedValue({
    id: "new-1", sku: "RPT-001", name: "Filtro", partNumber: "AF-1", partBrand: null, unitOfMeasure: "unidad", prices: {},
  })
})

describe("buscar y vincular: purchasing:create_order", () => {
  it("sin el permiso no consulta nada", async () => {
    mockAuth.mockResolvedValue(session(["repuestos:catalog"]))
    expect(await searchSparePartsForOcAction({ query: "filtro" })).toMatchObject({ ok: false })
    expect(await linkSparePartForOcAction({ productId: "p-1" })).toMatchObject({ ok: false })
    expect(mockSearch).not.toHaveBeenCalled()
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
      ["id", "lastPrice", "lastPurchasedAt", "name", "partBrand", "partNumber", "sku", "unitOfMeasure", "vehicleMatch"],
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

  it("vincular confirma que el repuesto sigue activo; si ya no existe lo dice", async () => {
    mockAuth.mockResolvedValue(session(["purchasing:create_order"]))
    expect(await linkSparePartForOcAction({ productId: "new-1" })).toMatchObject({ ok: true, part: { id: "new-1", sku: "RPT-001" } })
    mockLinkInfo.mockResolvedValue(null)
    expect(await linkSparePartForOcAction({ productId: "gone" })).toEqual({
      ok: false, message: "El repuesto ya no está disponible en el catálogo",
    })
  })

  it("vincular avisa antes de enviar la OC si el repuesto se compra en otra unidad que la línea", async () => {
    mockAuth.mockResolvedValue(session(["purchasing:create_order"]))
    expect(await linkSparePartForOcAction({ productId: "new-1", unitOfMeasure: "juego" })).toEqual({
      ok: false, message: "El repuesto RPT-001 se compra por «unidad» y la línea pide «juego»; elige otro o crea uno nuevo",
    })
    // La misma unidad, con otra caja, vale.
    expect(await linkSparePartForOcAction({ productId: "new-1", unitOfMeasure: "Unidad" })).toMatchObject({ ok: true })
  })
})

describe("crear: repuestos:catalog", () => {
  it("quien sólo puede comprar no crea repuestos", async () => {
    mockAuth.mockResolvedValue(session(["purchasing:create_order"]))
    expect(await createSparePartForOcAction({ name: "Filtro", unitOfMeasure: "unidad" })).toEqual({
      ok: false, message: "Sin permisos para crear repuestos en el catálogo",
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("con el permiso crea en una transacción, a nombre del usuario, y devuelve el repuesto para vincular", async () => {
    mockAuth.mockResolvedValue(session(["purchasing:create_order", "repuestos:catalog"]))
    const result = await createSparePartForOcAction({
      name: "  Filtro de aire ", partNumber: " AF-1 ", partBrand: "", unitOfMeasure: "Unidad",
    })
    expect(mockCreate).toHaveBeenCalledWith(fakeTx, {
      name: "Filtro de aire", partNumber: "AF-1", partBrand: null, unitOfMeasure: "unidad", createdByUserId: "user-1",
    })
    expect(mockLinkInfo).toHaveBeenCalledWith("new-1")
    expect(result).toMatchObject({ ok: true, part: { id: "new-1", sku: "RPT-001" } })
  })

  it("valida el nombre antes de tocar el catálogo", async () => {
    mockAuth.mockResolvedValue(session(["repuestos:catalog"]))
    const result = await createSparePartForOcAction({ name: "   ", unitOfMeasure: "unidad" })
    expect(result).toEqual({ ok: false, message: "Escribe el nombre del repuesto" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("un N° de parte repetido llega al usuario con el SKU del existente", async () => {
    mockAuth.mockResolvedValue(session(["repuestos:catalog"]))
    mockCreate.mockRejectedValue(new Error("Ya existe el repuesto RPT-001 con ese N° de parte"))
    expect(await createSparePartForOcAction({ name: "Filtro", partNumber: "AF-1", unitOfMeasure: "unidad" })).toEqual({
      ok: false, message: "Ya existe el repuesto RPT-001 con ese N° de parte",
    })
  })
})
