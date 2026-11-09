/**
 * Buscador de repuestos de la solicitud: pregunta al servidor mientras se
 * escribe. El permiso es el mismo que ofrece el buscador en la página
 * (`repuestos:create`), y el equipo y lo que se devuelve de él se recortan al
 * alcance de faenas de la sesión.
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
/** Cada `db.select()…where()` devuelve la siguiente fila de esta cola. */
const selectResults = vi.hoisted(() => [] as unknown[][])

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => selectResults.shift() ?? [] }) }),
  },
}))
vi.mock("@/lib/services/spare-parts-catalog", () => ({ searchSpareParts: mockSearch, SPARE_PART_SEARCH_LIMIT: 30 }))

const { searchSparePartsForRequestAction } = await import("./spare-parts-search")

function session(permissions: string[]): Session {
  return {
    expires: "2099-01-01",
    user: { id: "user-1", email: "jefe@test.cl", name: "Jefe", permissions, roleSlugs: [], worksiteIds: ["ws-1"], isGlobal: false },
  } as unknown as Session
}

const PART = {
  id: "rpt-1", sku: "RPT-001", name: "Filtro", partNumber: "AF-1", partBrand: null, unitOfMeasure: "unidad", isActive: true,
  preferredSupplierId: "sup-baja", preferredSupplierName: "Dado de baja", lastPrice: 1000, lastPurchasedAt: null,
  vehicleCount: 2, purchasedForVehicleIds: ["v-mio", "v-ajeno"], vehicleMatch: "vehicle" as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  selectResults.length = 0
  mockSearch.mockResolvedValue({ parts: [PART], total: 1 })
})

describe("searchSparePartsForRequestAction", () => {
  it("sin repuestos:create no consulta nada", async () => {
    mockAuth.mockResolvedValue(session(["purchasing:create_order"]))
    expect(await searchSparePartsForRequestAction({ query: "filtro" })).toMatchObject({ ok: false })
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it("sin texto pide sólo lo comprado para el equipo del ítem, con tope", async () => {
    mockAuth.mockResolvedValue(session(["repuestos:create"]))
    selectResults.push([{ id: "v-mio" }], [])
    await searchSparePartsForRequestAction({ query: " ", vehicleId: "v-mio" })
    expect(mockSearch).toHaveBeenCalledWith({ vehicleId: "v-mio", onlyVehicleMatches: true, limit: 30 })
  })

  it("con texto busca con el equipo; un equipo fuera del alcance no ordena", async () => {
    mockAuth.mockResolvedValue(session(["repuestos:create"]))
    selectResults.push([{ id: "v-mio" }], [])
    await searchSparePartsForRequestAction({ query: "filtro", vehicleId: "v-ajeno" })
    expect(mockSearch).toHaveBeenCalledWith({ query: "filtro", vehicleId: undefined, limit: 30 })
  })

  it("no delata equipos de otra faena ni ofrece un proveedor dado de baja", async () => {
    mockAuth.mockResolvedValue(session(["repuestos:create"]))
    selectResults.push([{ id: "v-mio" }], [])
    const result = await searchSparePartsForRequestAction({ query: "filtro", vehicleId: "v-mio" })
    expect(result).toEqual({
      ok: true,
      total: 1,
      parts: [expect.objectContaining({ id: "rpt-1", purchasedForVehicleIds: ["v-mio"], preferredSupplierId: null, unitOfMeasure: "unidad" })],
    })
  })
})
