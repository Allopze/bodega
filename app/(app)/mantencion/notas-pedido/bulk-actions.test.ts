import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * La acción de las decisiones por línea en lote (ADR 0001, D33) revalida `mant:np:manage`, valida la entrada (máx. 200
 * líneas, motivo del rechazo) y delega en el servicio; aquí se prueba el cableado, el resumen que ve quien actúa y el refresco.
 */

const guard = vi.hoisted(() => vi.fn())
const revalidatePath = vi.hoisted(() => vi.fn())
const revalidateTag = vi.hoisted(() => vi.fn())
const decide = vi.hoisted(() => vi.fn())

vi.mock("next/cache", () => ({ revalidatePath, revalidateTag }))
vi.mock("@/lib/auth/can", () => ({ guardAnyPermission: guard }))
vi.mock("@/lib/services/mantencion/parts-notes/bulk-lines", () => ({ decidePartsNoteLinesInBulk: decide }))

const { decideLinesInBulkAction } = await import("./bulk-actions")

const SESSION = { user: { id: "u-jefe" } }
const EMPTY = { ok: 0, failed: [], requests: [] }

beforeEach(() => {
  vi.clearAllMocks()
  guard.mockResolvedValue({ session: SESSION, error: null })
  decide.mockResolvedValue({ ...EMPTY, ok: 2 })
})

describe("permiso y entrada", () => {
  it("exige mant:np:manage en el servidor: sin él no llama al servicio ni refresca nada", async () => {
    guard.mockResolvedValue({ session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } })
    expect(await decideLinesInBulkAction({ lineIds: ["l1"], decision: "comprar" })).toEqual({ ok: false, message: "No tienes permisos para realizar esta acción" })
    expect(guard).toHaveBeenCalledWith(["mant:np:manage"], "/mantencion/notas-pedido")
    expect(decide).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it.each([
    ["sin líneas", { lineIds: [], decision: "comprar" }, "Elige al menos una línea."],
    ["más de 200 líneas", { lineIds: Array.from({ length: 201 }, (_, i) => `l${i}`), decision: "comprar" }, "Elige como máximo 200 líneas por vez."],
    ["rechazar sin motivo", { lineIds: ["l1"], decision: "rechazar" }, "Escribe un motivo de al menos 5 caracteres."],
    ["rechazar con motivo corto", { lineIds: ["l1"], decision: "rechazar", reason: "  no " }, "Escribe un motivo de al menos 5 caracteres."],
  ])("%s no llega al servicio", async (_name, input, expected) => {
    const result = await decideLinesInBulkAction(input as Parameters<typeof decideLinesInBulkAction>[0])
    expect(result).toMatchObject({ ok: false, message: expected })
    expect(decide).not.toHaveBeenCalled()
  })

  it("una decisión inventada o un identificador con caracteres raros no llegan al servicio", async () => {
    expect(await decideLinesInBulkAction({ lineIds: ["l1"], decision: "borrar" as never })).toMatchObject({ ok: false })
    expect(await decideLinesInBulkAction({ lineIds: ["../../admin"], decision: "comprar" })).toMatchObject({ ok: false })
    expect(decide).not.toHaveBeenCalled()
  })

  it("admite exactamente 200 líneas", async () => {
    const lineIds = Array.from({ length: 200 }, (_, i) => `l${i}`)
    await decideLinesInBulkAction({ lineIds, decision: "bodega" })
    expect(decide).toHaveBeenCalledWith(SESSION, { lineIds, decision: "bodega" })
  })
})

describe("resultado", () => {
  it("pasa la sesión, las líneas y el motivo recortado, y refresca la bandeja, los detalles, las OT, el Panel y Compras", async () => {
    const result = await decideLinesInBulkAction({ lineIds: ["l1", "l2"], decision: "rechazar", reason: "  Ya hay en la faena  " })
    expect(decide).toHaveBeenCalledWith(SESSION, { lineIds: ["l1", "l2"], decision: "rechazar", reason: "Ya hay en la faena" })
    expect(result).toMatchObject({ ok: true, message: "2 líneas rechazadas.", result: { ok: 2, failed: [], requests: [] } })
    for (const path of ["/mantencion/notas-pedido", "/mantencion/panel", "/compras", "/compras/nueva", "/solicitudes", "/pendientes"]) {
      expect(revalidatePath).toHaveBeenCalledWith(path)
    }
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/notas-pedido/[id]", "page")
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/ot/[id]", "page")
    expect(revalidateTag).toHaveBeenCalledWith("badge-counts", { expire: 0 })
  })

  it("enviar a compra dice las solicitudes y cuáles esperan su aprobación (la aprobación automática falló)", async () => {
    decide.mockResolvedValue({
      ok: 3, failed: [],
      requests: [{ code: "REP-1", id: "r1", approved: true }, { code: "REP-2", id: "r2", approved: false }],
    })
    expect(await decideLinesInBulkAction({ lineIds: ["l1"], decision: "comprar" })).toMatchObject({
      ok: true, message: "3 líneas enviadas a compra (REP-1, REP-2). REP-2 espera su aprobación en Aprobaciones.",
    })
    decide.mockResolvedValue({ ok: 1, failed: [], requests: [{ code: "REP-3", id: "r3", approved: true }] })
    expect((await decideLinesInBulkAction({ lineIds: ["l1"], decision: "comprar" })).message).toBe("1 línea enviada a compra (REP-3).")
  })

  it("una falla parcial es ok (la pantalla se refresca) y el mensaje dice qué notas no pudieron; con ninguna decidida es ok:false", async () => {
    decide.mockResolvedValue({ ok: 1, failed: [{ noteCode: "NP-2", message: "La nota está en espera: acéptala primero." }], requests: [] })
    expect(await decideLinesInBulkAction({ lineIds: ["l1"], decision: "bodega" })).toMatchObject({
      ok: true, message: "1 línea sacada de bodega. 1 nota no se pudo: NP-2: La nota está en espera: acéptala primero.",
    })
    const failed = Array.from({ length: 5 }, (_, i) => ({ noteCode: `NP-${i}`, message: "Sin stock." }))
    decide.mockResolvedValue({ ok: 0, failed, requests: [] })
    const none = await decideLinesInBulkAction({ lineIds: ["l1"], decision: "bodega" })
    expect(none.ok).toBe(false)
    expect(none.message).toBe("5 notas no se pudieron: NP-0: Sin stock. · NP-1: Sin stock. · NP-2: Sin stock. · y 2 más")
  })

  it("un rechazo del servicio vuelve como mensaje y uno inesperado no se filtra", async () => {
    decide.mockRejectedValue(new Error("Escribe el motivo del rechazo (al menos 5 letras)."))
    expect(await decideLinesInBulkAction({ lineIds: ["l1"], decision: "comprar" })).toEqual({ ok: false, message: "Escribe el motivo del rechazo (al menos 5 letras)." })
    decide.mockRejectedValue(Object.assign(new Error("Failed query: select ..."), { query: "select ...", params: [] }))
    expect(await decideLinesInBulkAction({ lineIds: ["l1"], decision: "comprar" })).toEqual({ ok: false, message: "No se pudieron decidir las líneas." })
  })
})
