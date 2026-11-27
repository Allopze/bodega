import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import {
  IDS,
  contextOf,
  createPartsNoteFromDevice,
  expectInvariant,
  ingress,
  itemRow,
  itemsOf,
  makeProduct,
  manualNote,
  phoneNote,
  resetState,
  setupDatabase,
  stockIn,
  testDb,
} from "./np-transiciones-fixtures"

vi.mock("@/db", () => ({
  get db() { return (globalThis as { __db?: unknown }).__db },
  get Tx() { return undefined },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/email/smtp", () => ({
  sendEmail: vi.fn(async () => undefined),
  sendBatchEmails: vi.fn(async () => undefined),
  getAppBaseUrl: () => "http://localhost",
}))

const { decidePartsNoteLinesInBulk } = await import("@/lib/services/mantencion/parts-notes/bulk-lines")
const { holdPartsNote, voidPartsNote } = await import("@/lib/services/mantencion/parts-notes/transitions")

/**
 * Decisiones por línea en lote desde la bandeja (ADR 0001, D33) contra Postgres de verdad: «Enviar a compra», «Sacar de
 * bodega» y «Rechazar» agrupadas por nota, cada nota por su cuenta (una que falla no tumba a las demás) y un resultado que
 * dice cuántas líneas salieron y por qué fallaron las otras.
 */

const sessionOf = async (permissions?: (current: string[]) => string[], scope?: { worksiteIds: string[]; isGlobal: boolean }): Promise<Session> => {
  const context = await contextOf(IDS.jefe, permissions)
  return {
    user: {
      id: context.viewer.userId, email: context.viewer.email, name: context.userName, roles: [],
      permissions: [...context.viewer.permissions, "repuestos:create"],
      worksiteIds: scope?.worksiteIds ?? [...context.viewer.worksiteIds], isGlobal: scope?.isGlobal ?? context.viewer.isGlobal,
    },
  } as unknown as Session
}
const jefe = () => sessionOf()
const jefeViewer = async () => (await contextOf(IDS.jefe)).viewer

async function pricedProduct(name: string, price: number): Promise<string> {
  const id = await makeProduct(name)
  await testDb.update(schema.products).set({ referencePrice: price }).where(eq(schema.products.id, id))
  return id
}

/** Una nota CON OT (como la manda el mecánico desde el teléfono). */
async function otNote(lines: Array<{ description: string; quantity?: number; productId?: string | null }>) {
  const result = await createPartsNoteFromDevice(phoneNote({
    lines: lines.map((line) => ({ description: line.description, quantity: line.quantity ?? 2, unitOfMeasure: "unidad", partNumber: null, productId: line.productId ?? null })),
  }), await contextOf(IDS.mecBio))
  if (result.status !== 200 || !result.body.ok) throw new Error("no se pudo crear la nota con OT")
  return { noteId: result.body.noteId, code: result.body.code, itemIds: await itemsOf(result.body.noteId) }
}

const requestsOf = () => testDb.select().from(schema.purchaseRequests)
const resolutionOf = async (itemId: string) => (await itemRow(itemId)).resolution

async function message(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("Se esperaba que la operación fuera rechazada")
}

beforeAll(async () => {
  await setupDatabase()
})

beforeEach(async () => {
  await testDb.delete(schema.approvalDecisions)
  await resetState()
})

describe("«Enviar a compra» en lote", () => {
  it("agrupa por nota y una solicitud por nota; la que falla no tumba a las demás y el resultado dice por qué", async () => {
    const filter = await pricedProduct("Filtro de aceite", 10_000)
    const seal = await pricedProduct("Sello de bomba", 8_000)
    const motor = await pricedProduct("Motor de arranque", 150_000)
    const withOrder = await otNote([{ description: "Filtro de aceite", productId: filter }, { description: "Sello de bomba", productId: seal }])
    const noOrder = await manualNote([{ description: "Filtro de aceite", productId: filter, chargeVehicleId: IDS.truckBio }])
    // Sobre el umbral de cotización: igual sale aprobada.
    const overThreshold = await manualNote([{ description: "Motor de arranque", productId: motor }])
    const onHold = await manualNote([{ description: "Abrazadera" }])
    expect((await holdPartsNote(await jefeViewer(), { noteId: onHold.noteId, reason: "Falta confirmar el equipo" })).ok).toBe(true)

    const result = await decidePartsNoteLinesInBulk(await jefe(), {
      decision: "comprar",
      lineIds: [...withOrder.itemIds, noOrder.itemIds[0]!, overThreshold.itemIds[0]!, onHold.itemIds[0]!],
    })

    expect(result.ok).toBe(4)
    expect(result.failed).toEqual([{ noteCode: onHold.code, message: "La nota está en espera: acéptala primero." }])
    // Una solicitud por nota, todas aprobadas: ni el umbral ni la falta de precio frenan una nota aceptada (D31).
    expect(result.requests).toHaveLength(3)
    expect(result.requests.every((request) => request.approved)).toBe(true)
    expect((await requestsOf()).filter((request) => request.status === "approved")).toHaveLength(3)

    expect((await Promise.all(withOrder.itemIds.map(resolutionOf)))).toEqual(["en_compra", "en_compra"])
    expect(await resolutionOf(onHold.itemIds[0]!)).toBe("pendiente")
    expect(await expectInvariant(withOrder.noteId)).toBe("en_compra")
    expect(await expectInvariant(onHold.noteId)).toBe("en_espera")
  })

  it("una nota de otra faena se trata como una línea que no existe y no crea solicitud", async () => {
    const note = await manualNote([{ description: "Filtro de aceite" }])
    const session = await sessionOf(undefined, { worksiteIds: [IDS.wsCho], isGlobal: false })
    const result = await decidePartsNoteLinesInBulk(session, { decision: "comprar", lineIds: [note.itemIds[0]!] })
    // Una nota fuera del alcance no se delata: ni su código ni un mensaje distinto del de una línea que no existe.
    expect(result).toEqual({ ok: 0, failed: [{ noteCode: "—", message: "Alguna de las líneas elegidas ya no existe." }], requests: [] })
    expect(await requestsOf()).toEqual([])
  })
})

describe("«Sacar de bodega» en lote", () => {
  it("sólo notas con OT y con repuesto de catálogo: las que no, fallan con un motivo claro y las demás salen", async () => {
    const filter = await makeProduct("Filtro de aceite")
    await ingress(filter, 5)
    const good = await otNote([{ description: "Filtro de aceite", quantity: 2, productId: filter }])
    const withoutOrder = await manualNote([{ description: "Filtro de aceite", productId: filter }])
    const withoutProduct = await otNote([{ description: "Abrazadera de 2 pulgadas" }])

    const result = await decidePartsNoteLinesInBulk(await jefe(), {
      decision: "bodega", lineIds: [good.itemIds[0]!, withoutOrder.itemIds[0]!, withoutProduct.itemIds[0]!],
    })

    expect(result.ok).toBe(1)
    expect(result.requests).toEqual([])
    const failures = new Map(result.failed.map((failure) => [failure.noteCode, failure.message]))
    expect(failures.get(withoutOrder.code)).toMatch(/^Una nota sin OT no aparta stock/)
    expect(failures.get(withoutProduct.code)).toBe("«Abrazadera de 2 pulgadas» no tiene un repuesto de catálogo: elígelo en el detalle de la nota para sacarlo de bodega.")
    expect(await resolutionOf(good.itemIds[0]!)).toBe("desde_stock")
    expect(await resolutionOf(withoutOrder.itemIds[0]!)).toBe("pendiente")
    expect(await resolutionOf(withoutProduct.itemIds[0]!)).toBe("pendiente")
    expect(await expectInvariant(good.noteId)).toBe("cerrada")
    // Lo apartado no sale del stock de la faena: queda reservado para la OT.
    expect(await stockIn(filter)).toBe(5)
  })

  it("si falta stock a media nota, lo ya apartado queda, el resultado lo cuenta y dice qué línea no pudo", async () => {
    const plenty = await makeProduct("Filtro de aceite")
    const none = await makeProduct("Sello de bomba")
    await ingress(plenty, 5)
    const note = await otNote([{ description: "Filtro de aceite", productId: plenty }, { description: "Sello de bomba", productId: none }])

    const result = await decidePartsNoteLinesInBulk(await jefe(), { decision: "bodega", lineIds: note.itemIds })
    expect(result.ok).toBe(1)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({ noteCode: note.code })
    expect(result.failed[0]!.message).toMatch(/^«Sello de bomba» \(2\): En Biodiversa hay 0 libres/)
    expect(await resolutionOf(note.itemIds[0]!)).toBe("desde_stock")
    expect(await resolutionOf(note.itemIds[1]!)).toBe("pendiente")
  })
})

describe("«Rechazar» en lote", () => {
  it("exige el motivo (5 letras) antes de tocar nada", async () => {
    const note = await manualNote([{ description: "Filtro de aceite" }])
    for (const reason of [undefined, "", "  no ", "abc"]) {
      expect(await message(async () => decidePartsNoteLinesInBulk(await jefe(), { decision: "rechazar", lineIds: note.itemIds, ...(reason === undefined ? {} : { reason }) })))
        .toBe("Escribe el motivo del rechazo (al menos 5 letras).")
    }
    expect(await resolutionOf(note.itemIds[0]!)).toBe("pendiente")
  })

  it("rechaza las líneas de varias notas con el mismo motivo; una nota anulada falla sola con su mensaje", async () => {
    const a = await manualNote([{ description: "Filtro de aceite" }, { description: "Aceite hidráulico" }])
    const b = await otNote([{ description: "Sello de bomba" }])
    const voided = await manualNote([{ description: "Abrazadera" }])
    expect((await voidPartsNote(await jefeViewer(), { noteId: voided.noteId, reason: "Se pidió dos veces" })).ok).toBe(true)

    const result = await decidePartsNoteLinesInBulk(await jefe(), {
      decision: "rechazar", reason: "  Ya hay en la faena  ", lineIds: [...a.itemIds, ...b.itemIds, voided.itemIds[0]!],
    })

    expect(result.ok).toBe(3)
    expect(result.failed).toEqual([{ noteCode: voided.code, message: `«Abrazadera»: La nota ${voided.code} está anulada.` }])
    for (const itemId of [...a.itemIds, ...b.itemIds]) {
      expect(await itemRow(itemId)).toMatchObject({ resolution: "rechazada", resolutionReason: "Ya hay en la faena" })
    }
    expect(await expectInvariant(a.noteId)).toBe("rechazada")
    expect(await expectInvariant(b.noteId)).toBe("rechazada")
  })
})

describe("la entrada del lote", () => {
  it("sin mant:np:manage no se decide nada, y las líneas repetidas o inexistentes no rompen el lote", async () => {
    const note = await manualNote([{ description: "Filtro de aceite" }])
    const withoutManage = await sessionOf((current) => current.filter((permission) => permission !== "mant:np:manage"))
    expect(await message(() => decidePartsNoteLinesInBulk(withoutManage, { decision: "rechazar", reason: "No corresponde", lineIds: note.itemIds })))
      .toBe("No tienes permiso para resolver notas de pedido.")
    expect(await resolutionOf(note.itemIds[0]!)).toBe("pendiente")

    expect(await message(async () => decidePartsNoteLinesInBulk(await jefe(), { decision: "rechazar", reason: "No corresponde", lineIds: [] }))).toBe("Elige al menos una línea.")

    const result = await decidePartsNoteLinesInBulk(await jefe(), {
      decision: "rechazar", reason: "No corresponde", lineIds: [note.itemIds[0]!, note.itemIds[0]!, "no-existe"],
    })
    expect(result.ok).toBe(1)
    expect(result.failed).toEqual([{ noteCode: "—", message: "Alguna de las líneas elegidas ya no existe." }])
  })
})
