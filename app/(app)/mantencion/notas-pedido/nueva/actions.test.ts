import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Las acciones de «Nueva nota de pedido» revalidan `mant:np:create` en el servidor, validan la entrada con Zod y delegan en
 * `createPartsNote` (aquí simulado; su alcance de faena, cargo e idempotencia contra Postgres están en
 * `lib/__tests__/np-sin-ot-pglite.test.ts`). Lo que se prueba es el cableado: permiso, validación por campo, el id de
 * operación que viaja intacto en cada reintento, la traducción de los rechazos y el refresco.
 */

const guard = vi.hoisted(() => vi.fn())
const revalidatePath = vi.hoisted(() => vi.fn())
const revalidateQueueOfNote = vi.hoisted(() => vi.fn(async () => undefined))
const createPartsNote = vi.hoisted(() => vi.fn())
const searchSpareParts = vi.hoisted(() => vi.fn())
const viewer = vi.hoisted(() => ({ current: { userId: "u-mec", email: "mec@chome.cl", permissions: ["mant:np:create"], worksiteIds: ["ws-1"], isGlobal: false } }))

vi.mock("next/cache", () => ({ revalidatePath, revalidateTag: vi.fn() }))
vi.mock("@/lib/auth/can", () => ({ guardAnyPermission: guard }))
vi.mock("@/lib/services/mantencion/access", () => ({ viewerFromSession: () => viewer.current }))
vi.mock("@/lib/services/mantencion/parts-notes/create-manual", () => ({ createPartsNote }))
vi.mock("@/lib/services/mantencion/queue-revalidation", () => ({ revalidateQueueOfNote }))
vi.mock("@/lib/services/spare-parts-catalog", () => ({ SPARE_PART_SEARCH_LIMIT: 30, searchSpareParts }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

const actions = await import("./actions")

const DENIED = { ok: false, message: "No tienes permisos para realizar esta acción" }
const LINE = { description: "Filtro de aceite", quantity: 2, unitOfMeasure: "unidad", partNumber: null, productId: null, chargeVehicleId: null, chargeCostCenterId: null, suggestedSupplierId: null }
const input = (overrides: Record<string, unknown> = {}) => ({
  clientOpId: "op-12345678", worksiteId: "ws-1", workOrderId: null, urgent: false, notes: null, lines: [LINE], ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  guard.mockResolvedValue({ session: { user: { id: "u-mec" } }, error: null })
  // El servicio real es idempotente por `clientOpId`: la misma operación devuelve el mismo folio.
  const applied = new Map<string, string>()
  createPartsNote.mockImplementation(async (_viewer: unknown, data: { clientOpId: string }) => {
    const known = applied.get(data.clientOpId)
    if (known) return { ok: true, noteId: "n-1", code: known, duplicate: true }
    applied.set(data.clientOpId, "NP-2026-0007")
    return { ok: true, noteId: "n-1", code: "NP-2026-0007", duplicate: false }
  })
})

describe("permiso", () => {
  it.each([
    ["createPartsNoteAction", () => actions.createPartsNoteAction(input())],
    ["searchNoteSparePartsAction", () => actions.searchNoteSparePartsAction({ query: "filtro" })],
  ])("%s exige mant:np:create y no toca ningún servicio sin él", async (_name, call) => {
    guard.mockResolvedValue({ session: null, error: DENIED })
    const result = await call()
    expect(result).toMatchObject({ ok: false })
    expect(guard).toHaveBeenCalledWith(["mant:np:create"], "/mantencion/notas-pedido")
    expect(createPartsNote).not.toHaveBeenCalled()
    expect(searchSpareParts).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("sin permiso, el mensaje de createPartsNoteAction es el del guardia", async () => {
    guard.mockResolvedValue({ session: null, error: DENIED })
    expect(await actions.createPartsNoteAction(input())).toEqual(DENIED)
  })
})

describe("createPartsNoteAction", () => {
  it("crea la nota con quien actúa, sin observación vacía, y refresca la bandeja, el Panel y los avisos", async () => {
    const result = await actions.createPartsNoteAction(input({ notes: "", urgent: true, workOrderId: "ot-1" }))
    expect(result).toEqual({ ok: true, message: "Nota NP-2026-0007 creada.", data: { noteId: "n-1", code: "NP-2026-0007", duplicate: false } })
    expect(createPartsNote).toHaveBeenCalledWith(viewer.current, expect.objectContaining({ clientOpId: "op-12345678", worksiteId: "ws-1", workOrderId: "ot-1", urgent: true, notes: undefined }))
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/notas-pedido")
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/panel")
    expect(revalidateQueueOfNote).toHaveBeenCalledWith("n-1")
  })

  it("reintentar con el mismo clientOpId devuelve el mismo folio y lo dice (no crea otra nota)", async () => {
    const first = await actions.createPartsNoteAction(input())
    const second = await actions.createPartsNoteAction(input({ notes: "texto corregido" }))
    expect(first).toMatchObject({ ok: true, data: { code: "NP-2026-0007", duplicate: false } })
    expect(second).toEqual({ ok: true, message: "La nota NP-2026-0007 ya estaba creada.", data: { noteId: "n-1", code: "NP-2026-0007", duplicate: true } })
    expect(createPartsNote.mock.calls.map((call) => (call[1] as { clientOpId: string }).clientOpId)).toEqual(["op-12345678", "op-12345678"])
    // Otro borrador (otro id) es otra nota.
    expect(await actions.createPartsNoteAction(input({ clientOpId: "op-87654321" }))).toMatchObject({ ok: true, data: { duplicate: false } })
  })

  it("una faena fuera del alcance es el rechazo del servicio, con su campo, y no refresca nada", async () => {
    createPartsNote.mockResolvedValue({ ok: false, message: "Esa faena no es de tu alcance.", field: "worksiteId" })
    expect(await actions.createPartsNoteAction(input({ worksiteId: "ws-9" }))).toEqual({
      ok: false, message: "Esa faena no es de tu alcance.", fieldErrors: { worksiteId: ["Esa faena no es de tu alcance."] },
    })
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(revalidateQueueOfNote).not.toHaveBeenCalled()
  })

  it("valida antes de llamar al servicio y señala la línea y el campo (ruta completa)", async () => {
    const result = await actions.createPartsNoteAction(input({
      worksiteId: " ",
      lines: [LINE, { ...LINE, description: "ab", quantity: 0 }],
    }))
    expect(result).toMatchObject({ ok: false, fieldErrors: {
      worksiteId: ["Elige la faena."],
      "lines.1.description": ["Describe el repuesto (al menos 3 letras)."],
      "lines.1.quantity": ["La cantidad debe ser mayor que cero."],
    } })
    expect(await actions.createPartsNoteAction(input({ lines: [] }))).toMatchObject({ ok: false, message: "Agrega al menos un repuesto.", fieldErrors: { lines: ["Agrega al menos un repuesto."] } })
    expect(await actions.createPartsNoteAction(input({ clientOpId: "corto" }))).toMatchObject({ ok: false, message: "Identificador de operación inválido." })
    expect(await actions.createPartsNoteAction("no es un objeto")).toMatchObject({ ok: false })
    expect(createPartsNote).not.toHaveBeenCalled()
  })

  it("un fallo inesperado del servicio no se pierde: sale como mensaje y no refresca", async () => {
    createPartsNote.mockRejectedValue(new Error("connection terminated"))
    expect(await actions.createPartsNoteAction(input())).toMatchObject({ ok: false })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe("searchNoteSparePartsAction", () => {
  const part = {
    id: "p-1", sku: "RPT-0001", name: "Filtro de aceite", partNumber: "1R-0750", partBrand: "CAT", unitOfMeasure: "unidad", isActive: true,
    preferredSupplierId: "sup-1", preferredSupplierName: "Repuestos Sur", lastSupplierName: "Repuestos Sur", lastPrice: 35000, referencePrice: 30000,
    lastPurchasedAt: null, vehicleCount: 1, purchasedForVehicleIds: ["v-1"], vehicleMatch: null,
  }

  it("busca en el catálogo y devuelve el repuesto SIN precios, proveedor ni equipos", async () => {
    searchSpareParts.mockResolvedValue({ parts: [part], total: 1 })
    const result = await actions.searchNoteSparePartsAction({ query: "  filtro " })
    expect(searchSpareParts).toHaveBeenCalledWith({ query: "filtro", limit: 30 })
    expect(result).toEqual({
      ok: true,
      parts: [{
        id: "p-1", sku: "RPT-0001", name: "Filtro de aceite", partNumber: "1R-0750", partBrand: "CAT", unitOfMeasure: "unidad",
        lastPrice: null, referencePrice: null, preferredSupplierId: null, purchasedForVehicleIds: [],
      }],
    })
  })

  it("sin texto no consulta el catálogo; una entrada inválida o un fallo salen como mensaje", async () => {
    expect(await actions.searchNoteSparePartsAction({ query: "" })).toEqual({ ok: true, parts: [] })
    expect(await actions.searchNoteSparePartsAction({ query: "x".repeat(101) })).toMatchObject({ ok: false })
    expect(searchSpareParts).not.toHaveBeenCalled()
    searchSpareParts.mockRejectedValue(new Error("db caída"))
    expect(await actions.searchNoteSparePartsAction({ query: "filtro" })).toEqual({ ok: false, message: "No se pudo buscar en el catálogo de repuestos." })
  })
})
