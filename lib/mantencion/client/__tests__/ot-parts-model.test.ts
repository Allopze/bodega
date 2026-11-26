import { describe, expect, it } from "vitest"
import type { CatalogPartsAvailable, CatalogPartsNote, MantCatalog } from "../../contracts"
import { newJob, type FlowJob } from "../flow-types"
import { addStockLine, availablePartsFor, buildOtViews, freeStock, isStockPart, partStatusText, qtyText, stockCap, type OtPartLine } from "../ot-model"
import type { QueueItem, QueuePartsNoteItem } from "../types"
import { UUID, catalog, correctivePayload, partsNoteItem, workOrder } from "./fixtures"
import { newRecordItem } from "../queue"

const USER = { id: "u-1", name: "Javier Roa" }

const AVAILABLE = (overrides: Partial<CatalogPartsAvailable> = {}): CatalogPartsAvailable => ({
  allocationId: "al-1", productId: "pr-1", name: "Filtro de aceite", partNumber: "FA-100", unit: "unidad", wholeOnly: true,
  worksiteId: "ws-bio", worksiteName: "Biodiversa", remaining: 2, ...overrides,
})

const NOTE = (overrides: Partial<CatalogPartsNote> = {}): CatalogPartsNote => ({
  id: "np-1", code: "NP-2026-0001", status: "en_gestion", equipmentStopped: false, createdAt: "2026-10-28T10:00:00.000Z",
  lines: [{ id: "l-1", description: "Filtro de aceite", quantity: 2, unit: "unidad", partNumber: null, stage: "pedido", arrived: 0, used: 0, rejectionReason: null }],
  ...overrides,
})

function catalogWith(orders: ReturnType<typeof workOrder>[]): MantCatalog {
  return { ...catalog("u-1"), workOrders: orders }
}

const viewOf = (ot: ReturnType<typeof workOrder>, queue: QueueItem[] = [], generatedAt?: string) =>
  buildOtViews(catalogWith([ot]), queue, USER, generatedAt).mine[0]!

function stockRecord(n: number, quantity: number, createdAt: string): QueueItem {
  return newRecordItem({
    authorUserId: "u-1",
    payload: correctivePayload(UUID(n), UUID(n + 50), {
      workOrderId: "ot-1", inWorkshop: false, workshopEntryDate: null, workshopReason: null,
      jobs: [{ workTypeId: "t-1", hours: 1, noParts: false, parts: [{ quantity, description: "Filtro de aceite", source: "stock", productId: "pr-1", allocationId: "al-1" }] }],
    }),
    photoIds: [UUID(n + 50)],
    summary: { kind: "C", vehicleId: "veh-1", equipmentCode: "KA-140", equipmentPlate: "SGCP-84", unit: "km", intervalValue: null, workDate: "2026-10-28", reading: 40_400, inWorkshop: false, workshopEntryDate: null },
  }, createdAt)
}

describe("OtView: repuestos pedidos", () => {
  it("un catálogo sin partsNotes ni partsAvailable (formato viejo) no rompe nada: todo queda vacío", () => {
    const view = viewOf(workOrder())
    expect(view.partsLines).toEqual([])
    expect(view.partsRejected).toEqual([])
    expect(view.partsAvailable).toEqual([])
  })

  it("arma una fila por línea de cada nota del catálogo, con su código de NP", () => {
    const view = viewOf(workOrder({ partsNotes: [NOTE({ lines: [
      { id: "l-1", description: "Filtro de aceite", quantity: 2, unit: "unidad", partNumber: null, stage: "en_bodega", arrived: 2, used: 0, rejectionReason: null },
      { id: "l-2", description: "Manguera", quantity: 1, unit: "unidad", partNumber: null, stage: "rechazado", arrived: 0, used: 0, rejectionReason: "No se vende más" },
    ] })] }))
    expect(view.partsLines.map((line) => [line.description, line.stage, line.noteCode])).toEqual([
      ["Filtro de aceite", "en_bodega", "NP-2026-0001"],
      ["Manguera", "rechazado", "NP-2026-0001"],
    ])
  })

  it("una nota que aún está en la cola se ve como «por enviar», antes que las del servidor", () => {
    const queued = partsNoteItem(1, { lines: [{ description: "Pastillas de freno", quantity: 4, unitOfMeasure: "unidad", partNumber: null, productId: null }] })
    const view = viewOf(workOrder({ partsNotes: [NOTE()] }), [queued])
    expect(view.partsLines.map((line) => [line.description, line.stage, line.noteCode])).toEqual([
      ["Pastillas de freno", "por_enviar", null],
      ["Filtro de aceite", "pedido", "NP-2026-0001"],
    ])
    // Hay algo guardado sólo en el teléfono: la OT lo marca «sin enviar».
    expect(view.pending).toBe(true)
    expect(viewOf(workOrder({ partsNotes: [NOTE()] })).pending).toBe(false)
  })

  it("la nota de otro mecánico o de otra OT no aparece; una ya enviada sólo cuenta mientras el catálogo sea más viejo", () => {
    const other = partsNoteItem(1, { authorUserId: "u-9" })
    const otherOt = partsNoteItem(2, { workOrderId: "ot-9" })
    expect(viewOf(workOrder(), [other, otherOt]).partsLines).toEqual([])

    const sent: QueuePartsNoteItem = { ...partsNoteItem(3), status: "sent", sentAt: "2026-10-28T15:30:00.000Z" }
    expect(viewOf(workOrder(), [sent], "2026-10-28T15:00:00.000Z").partsLines).toHaveLength(1)
    // El catálogo ya es posterior al envío: la trae él, no se duplica.
    expect(viewOf(workOrder(), [sent], "2026-10-28T16:00:00.000Z").partsLines).toHaveLength(0)
  })

  it("una nota rechazada al enviarse no es una fila: es un aviso con su mensaje", () => {
    const rejected: QueuePartsNoteItem = { ...partsNoteItem(1), status: "rejected", lastError: "La OT ya no admite pedidos." }
    const view = viewOf(workOrder(), [rejected])
    expect(view.partsLines).toEqual([])
    expect(view.partsRejected).toEqual([{ id: rejected.id, message: "La OT ya no admite pedidos." }])
  })

  it("«Pedir repuestos» sólo con la OT asignada o en ejecución y asignada a este usuario", () => {
    expect(viewOf(workOrder({ status: "asignada" })).flags.canRequestParts).toBe(true)
    expect(viewOf(workOrder({ status: "en_ejecucion" })).flags.canRequestParts).toBe(true)
    expect(viewOf(workOrder({ status: "trabajo_terminado" })).flags.canRequestParts).toBe(false)
    expect(viewOf(workOrder({ status: "cerrada" })).flags.canRequestParts).toBe(false)
    expect(viewOf(workOrder({ assignedToUserId: "u-2" })).flags.canRequestParts).toBe(false)
  })
})

describe("frases de estado de cada línea", () => {
  const line = (overrides: Partial<OtPartLine>): OtPartLine => ({ key: "k", description: "Filtro", quantity: 2, unit: "unidad", stage: "pedido", arrived: 0, used: 0, rejectionReason: null, noteCode: null, ...overrides })

  it("dice el estado con palabras, nunca sólo con el color", () => {
    expect(partStatusText(line({ stage: "por_enviar" })).label).toBe("Pedido · por enviar")
    expect(partStatusText(line({ stage: "pedido" })).label).toBe("Pedido")
    expect(partStatusText(line({ stage: "en_compra" })).label).toBe("En compra")
    expect(partStatusText(line({ stage: "en_bodega", arrived: 2 })).label).toBe("Llegó · 2 disponibles")
    expect(partStatusText(line({ stage: "en_bodega", arrived: 1 })).label).toBe("Llegó · 1 disponible")
    expect(partStatusText(line({ stage: "rechazado", rejectionReason: "No se vende más" })).label).toBe("Rechazado: No se vende más")
    expect(partStatusText(line({ stage: "rechazado" })).label).toBe("Rechazado")
  })

  it("con uso parcial dice «Usado 1 de 2» y cuánto queda; con todo usado, sin saldo", () => {
    expect(partStatusText(line({ stage: "en_bodega", arrived: 2, used: 1 }))).toMatchObject({ label: "Usado 1 de 2", detail: "Queda 1 disponible" })
    expect(partStatusText(line({ stage: "en_bodega", arrived: 2, used: 2 }))).toMatchObject({ label: "Usado 2 de 2", detail: null })
    expect(partStatusText(line({ stage: "en_bodega", arrived: 3, used: 1 })).detail).toBe("Quedan 2 disponibles")
  })

  it("las cantidades con decimales usan coma", () => {
    expect(qtyText(1.5)).toBe("1,5")
    expect(qtyText(2)).toBe("2")
    expect(partStatusText(line({ stage: "en_bodega", arrived: 2.5 })).label).toBe("Llegó · 2,5 disponibles")
  })
})

describe("disponibles para la OT", () => {
  it("lo reservado y todavía sin usar sale del catálogo", () => {
    const view = viewOf(workOrder({ partsAvailable: [AVAILABLE()] }))
    expect(view.partsAvailable.map((item) => [item.name, item.remaining])).toEqual([["Filtro de aceite", 2]])
  })

  it("descuenta lo que un registro guardado en el teléfono ya usó y el catálogo aún no sabe; lo agotado no se ofrece", () => {
    const base = workOrder({ partsAvailable: [AVAILABLE({ remaining: 2 })] })
    expect(viewOf(base, [stockRecord(1, 1, "2026-10-28T15:01:00.000Z")]).partsAvailable[0]?.remaining).toBe(1)
    expect(viewOf(base, [stockRecord(1, 2, "2026-10-28T15:01:00.000Z")]).partsAvailable).toEqual([])
  })

  it("availablePartsFor lo calcula para el trabajo en curso; un registro rechazado no descuenta", () => {
    const stored = catalogWith([workOrder({ partsAvailable: [AVAILABLE({ remaining: 2 })] })])
    const record = stockRecord(1, 1, "2026-10-28T15:01:00.000Z")
    expect(availablePartsFor(stored, [record], "u-1", "ot-1")[0]?.remaining).toBe(1)
    expect(availablePartsFor(stored, [{ ...record, status: "rejected" } as QueueItem], "u-1", "ot-1")[0]?.remaining).toBe(2)
    expect(availablePartsFor(stored, [], "u-1", "ot-inexistente")).toEqual([])
    expect(availablePartsFor({ ...catalog("u-1") }, [], "u-1", "ot-1")).toEqual([])
  })
})

describe("repuestos de bodega en el trabajo", () => {
  const jobsWith = (...parts: Array<Record<string, unknown>>): FlowJob[] => [{ ...newJob("t-1"), parts: parts as unknown as FlowJob["parts"] }]

  it("un toque agrega la línea con source stock, el producto y la reserva, cantidad 1 y el nombre como descripción", () => {
    const jobs = addStockLine([newJob("t-1")], "t-1", AVAILABLE())
    expect(jobs[0]!.parts).toEqual([{ quantity: "1", description: "Filtro de aceite", source: "stock", productId: "pr-1", allocationId: "al-1" }])
    expect(isStockPart(jobs[0]!.parts[0]!)).toBe(true)
  })

  it("conserva el texto libre ya escrito y sólo quita la línea en blanco de partida", () => {
    const typed = jobsWith({ quantity: "1", description: "Grasa" }, { quantity: "1", description: "" })
    expect(addStockLine(typed, "t-1", AVAILABLE())[0]!.parts.map((part) => part.description)).toEqual(["Grasa", "Filtro de aceite"])
  })

  it("lo libre es libre: una línea de texto no es de stock", () => {
    expect(isStockPart({ quantity: "1", description: "Grasa" })).toBe(false)
  })

  it("el tope es lo disponible menos lo ya puesto en las otras líneas del mismo repuesto (de cualquier trabajo)", () => {
    const item = AVAILABLE({ remaining: 3 })
    const jobs: FlowJob[] = [
      { ...newJob("t-1"), parts: [
        { quantity: "1", description: "Filtro de aceite", source: "stock", productId: "pr-1", allocationId: "al-1" },
        { quantity: "1", description: "Filtro de aceite", source: "stock", productId: "pr-1", allocationId: "al-1" },
      ] as FlowJob["parts"] },
      { ...newJob("t-2"), parts: [{ quantity: "0", description: "Grasa" }] },
    ]
    // Sobran 3 − 1 (la otra línea) = 2 para cada una; sin poner nada más quedaría 1.
    expect(stockCap([item], jobs, { workTypeId: "t-1", index: 0 })).toBe(2)
    expect(freeStock(item, jobs)).toBe(1)
    expect(freeStock(item, addStockLine(jobs, "t-1", item))).toBe(0)
  })

  it("una reserva que ya no figura sólo deja bajar la línea, no subirla", () => {
    const jobs = jobsWith({ quantity: "2", description: "Filtro de aceite", source: "stock", productId: "pr-1", allocationId: "al-gone" })
    expect(stockCap([], jobs, { workTypeId: "t-1", index: 0 })).toBe(2)
  })

  it("con unidades enteras el tope baja al entero; con decimales conserva los centésimos", () => {
    const whole = AVAILABLE({ remaining: 2.5, wholeOnly: true })
    const decimal = AVAILABLE({ remaining: 2.5, wholeOnly: false })
    const jobs = jobsWith({ quantity: "1", description: "Filtro de aceite", source: "stock", productId: "pr-1", allocationId: "al-1" })
    expect(stockCap([whole], jobs, { workTypeId: "t-1", index: 0 })).toBe(2)
    expect(stockCap([decimal], jobs, { workTypeId: "t-1", index: 0 })).toBe(2.5)
  })
})
