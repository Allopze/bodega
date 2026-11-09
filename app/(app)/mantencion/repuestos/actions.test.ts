import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Cada acción del catálogo exige `repuestos:catalog` EN el servidor: el menú y los botones sólo lo reflejan.
 * Sin permiso, el servicio no se toca. Con permiso, los errores de validación y de negocio vuelven bajo su campo.
 */

const guard = vi.hoisted(() => vi.fn())
const createSparePartTx = vi.hoisted(() => vi.fn())
const updateSparePart = vi.hoisted(() => vi.fn())
const setSparePartActive = vi.hoisted(() => vi.fn())
const exportSpareParts = vi.hoisted(() => vi.fn())
const revalidatePath = vi.hoisted(() => vi.fn())
const transaction = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({ db: { transaction } }))
vi.mock("next/cache", () => ({ revalidatePath }))
vi.mock("@/lib/auth/can", () => ({ guardPermission: guard }))
vi.mock("@/lib/services/spare-parts-catalog", () => ({ createSparePartTx, updateSparePart, setSparePartActive }))
vi.mock("./export-spare-parts", () => ({ exportSpareParts }))

const { createSparePartAction, updateSparePartAction, setSparePartActiveAction, exportSparePartsAction } = await import("./actions")

const SESSION = { user: { id: "u-jefe", email: "jefe@chome.cl" } }
const DENIED = { session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } }
const TX = { tx: true }

function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const VALID = { name: "Filtro de aceite", partNumber: "1R-0750", partBrand: "Caterpillar", unitOfMeasure: "unidad", referencePrice: "18990", notes: "" }

describe("catálogo de repuestos — permisos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guard.mockResolvedValue({ session: SESSION, error: null })
    transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(TX))
  })

  it("todas las acciones piden repuestos:catalog", async () => {
    createSparePartTx.mockResolvedValue({ id: "rep-1", sku: "RPT-001" })
    updateSparePart.mockResolvedValue({ id: "rep-1", sku: "RPT-001" })
    exportSpareParts.mockResolvedValue({ base64: "x", filename: "a.xlsx", rowCount: 1 })
    await createSparePartAction({ ok: false }, form(VALID))
    await updateSparePartAction({ ok: false }, form({ ...VALID, id: "rep-1" }))
    await setSparePartActiveAction({ id: "rep-1", active: false })
    await exportSparePartsAction({ scope: "activos" })
    expect(guard.mock.calls.map((call) => call[0])).toEqual(Array(4).fill("repuestos:catalog"))
  })

  it("sin el permiso no se crea, edita, desactiva ni exporta nada", async () => {
    guard.mockResolvedValue(DENIED)
    expect(await createSparePartAction({ ok: false }, form(VALID))).toEqual(DENIED.error)
    expect(await updateSparePartAction({ ok: false }, form({ ...VALID, id: "rep-1" }))).toEqual(DENIED.error)
    expect(await setSparePartActiveAction({ id: "rep-1", active: false })).toEqual(DENIED.error)
    expect(await exportSparePartsAction({ scope: "activos" })).toEqual(DENIED.error)
    expect(transaction).not.toHaveBeenCalled()
    expect(createSparePartTx).not.toHaveBeenCalled()
    expect(updateSparePart).not.toHaveBeenCalled()
    expect(setSparePartActive).not.toHaveBeenCalled()
    expect(exportSpareParts).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe("createSparePartAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guard.mockResolvedValue({ session: SESSION, error: null })
    transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(TX))
  })

  it("crea dentro de una transacción, a nombre de quien la pide, y revalida la lista", async () => {
    createSparePartTx.mockResolvedValue({ id: "rep-7", sku: "RPT-007" })
    const result = await createSparePartAction({ ok: false }, form(VALID))
    expect(result).toEqual({ ok: true, message: "Repuesto RPT-007 creado" })
    expect(createSparePartTx).toHaveBeenCalledWith(TX, {
      name: "Filtro de aceite", partNumber: "1R-0750", partBrand: "Caterpillar", unitOfMeasure: "unidad", notes: null, referencePrice: 18990, createdByUserId: "u-jefe",
    })
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/repuestos")
  })

  it("lo opcional vacío viaja como null y el precio vacío no es 0", async () => {
    createSparePartTx.mockResolvedValue({ id: "rep-8", sku: "RPT-008" })
    await createSparePartAction({ ok: false }, form({ name: "  Sello de eje ", partNumber: "  ", partBrand: "", unitOfMeasure: "unidad", referencePrice: "", notes: "" }))
    expect(createSparePartTx).toHaveBeenCalledWith(TX, expect.objectContaining({ name: "Sello de eje", partNumber: null, partBrand: null, referencePrice: null, notes: null }))
  })

  it("un formulario vacío dice qué corregir en cada campo y no toca el servicio", async () => {
    const result = await createSparePartAction({ ok: false }, form({ name: " ", unitOfMeasure: "", referencePrice: "-5" }))
    expect(result.ok).toBe(false)
    expect(result.fieldErrors).toEqual({
      name: ["Escribe el nombre del repuesto"],
      unitOfMeasure: ["Elige la unidad de medida"],
      referencePrice: ["El precio de referencia debe ser un número, 0 o más"],
    })
    expect(transaction).not.toHaveBeenCalled()
  })

  it("los topes de largo tienen su mensaje", async () => {
    const result = await createSparePartAction({ ok: false }, form({ ...VALID, name: "x".repeat(201), partNumber: "y".repeat(101), partBrand: "z".repeat(101), notes: "n".repeat(2001) }))
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["name", "notes", "partBrand", "partNumber"])
    expect(result.fieldErrors?.name?.[0]).toBe("El nombre no puede superar 200 caracteres")
  })

  it("un N° de parte repetido (error del servicio) vuelve bajo «N° de parte»", async () => {
    createSparePartTx.mockRejectedValue(new Error("Ya existe el repuesto RPT-012 con ese N° de parte"))
    const result = await createSparePartAction({ ok: false }, form(VALID))
    expect(result).toEqual({
      ok: false,
      message: "Ya existe el repuesto RPT-012 con ese N° de parte",
      fieldErrors: { partNumber: ["Ya existe el repuesto RPT-012 con ese N° de parte"] },
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("una unidad desactivada vuelve bajo «Unidad de medida»", async () => {
    createSparePartTx.mockRejectedValue(new Error('La unidad "caja" no existe en el catálogo de unidades o está desactivada. Agrégala en Administración → Catálogos de productos antes de usarla.'))
    const result = await createSparePartAction({ ok: false }, form({ ...VALID, unitOfMeasure: "caja" }))
    expect(Object.keys(result.fieldErrors ?? {})).toEqual(["unitOfMeasure"])
  })

  it("un error del driver no llega al usuario con su SQL", async () => {
    createSparePartTx.mockRejectedValue(Object.assign(new Error("Failed query: insert into products ..."), { query: "insert into products", params: [] }))
    const result = await createSparePartAction({ ok: false }, form(VALID))
    expect(result).toEqual({ ok: false, message: "No se pudo crear el repuesto. Inténtalo de nuevo." })
  })
})

describe("updateSparePartAction / setSparePartActiveAction / exportSparePartsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guard.mockResolvedValue({ session: SESSION, error: null })
  })

  it("edita por id, a nombre de quien edita, y revalida la lista y la ficha", async () => {
    updateSparePart.mockResolvedValue({ id: "rep-1", sku: "RPT-001" })
    const result = await updateSparePartAction({ ok: false }, form({ ...VALID, id: "rep-1" }))
    expect(result).toEqual({ ok: true, message: "Repuesto RPT-001 actualizado" })
    expect(updateSparePart).toHaveBeenCalledWith("rep-1", expect.objectContaining({ name: "Filtro de aceite", referencePrice: 18990 }), "u-jefe")
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/repuestos")
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/repuestos/rep-1")
  })

  it("editar sin id no llega al servicio", async () => {
    const result = await updateSparePartAction({ ok: false }, form(VALID))
    expect(result).toEqual({ ok: false, message: "No se reconoce el repuesto." })
    expect(updateSparePart).not.toHaveBeenCalled()
  })

  it("desactivar y activar dejan constancia de quién lo hizo", async () => {
    setSparePartActive.mockResolvedValue(undefined)
    expect(await setSparePartActiveAction({ id: "rep-1", active: false })).toEqual({ ok: true, message: "Repuesto desactivado" })
    expect(await setSparePartActiveAction({ id: "rep-1", active: true })).toEqual({ ok: true, message: "Repuesto activado" })
    expect(setSparePartActive).toHaveBeenNthCalledWith(1, "rep-1", false, "u-jefe")
    expect(setSparePartActive).toHaveBeenNthCalledWith(2, "rep-1", true, "u-jefe")
  })

  it("cambiar el estado de un repuesto que no existe devuelve el mensaje del servicio", async () => {
    setSparePartActive.mockRejectedValue(new Error("El repuesto no existe"))
    expect(await setSparePartActiveAction({ id: "nada", active: false })).toEqual({ ok: false, message: "El repuesto no existe" })
  })

  it("rechaza un cuerpo que no es {id, active}", async () => {
    const result = await setSparePartActiveAction({ id: "", active: "si" as unknown as boolean })
    expect(result).toEqual({ ok: false, message: "No se reconoce el repuesto." })
    expect(setSparePartActive).not.toHaveBeenCalled()
  })

  it("exporta la pestaña pedida y rechaza otra cosa", async () => {
    exportSpareParts.mockResolvedValue({ base64: "QUJD", filename: "catalogo-repuestos-inactivos_2026-11-09.xlsx", rowCount: 2 })
    expect(await exportSparePartsAction({ scope: "inactivos" })).toEqual({ ok: true, data: { base64: "QUJD", filename: "catalogo-repuestos-inactivos_2026-11-09.xlsx" } })
    expect(exportSpareParts).toHaveBeenCalledWith(SESSION, "inactivos")
    const bad = await exportSparePartsAction({ scope: "todos" as unknown as "activos" })
    expect(bad).toEqual({ ok: false, message: "Los filtros de la exportación no son válidos." })
  })
})
