import { describe, expect, it } from "vitest"
import type { FlowJob } from "@/lib/mantencion/client/flow-types"
import type { SyncRecord } from "@/lib/mantencion/contracts"
import { availablePart } from "./notas-pedido-fixtures"
import { addStockPart, capStockQuantity, leftByAllocation, stockLineMax, withStockFields, type StockFlowPart } from "./record-stock-parts"
import { reservedUnusedNotice, reservedUnusedText } from "./reserved-unused"

describe("aviso de reservados sin usar", () => {
  it("suma lo que queda por reservar, ignora lo agotado y junta las faenas sin repetirlas", () => {
    expect(reservedUnusedNotice([])).toBeNull()
    expect(reservedUnusedNotice([{ remaining: 0, worksiteName: "Santa Fe" }])).toBeNull()
    expect(reservedUnusedNotice([
      { remaining: 1.5, worksiteName: "Santa Fe" }, { remaining: 0.5, worksiteName: "Santa Fe" }, { remaining: 1, worksiteName: "Biodiversa" }, { remaining: 0, worksiteName: "Cholguán" },
    ])).toEqual({ count: 3, worksiteNames: ["Santa Fe", "Biodiversa"] })
  })

  it("la frase concuerda en singular y plural y nombra la faena", () => {
    expect(reservedUnusedText({ count: 2, worksiteNames: ["Santa Fe"] })).toBe("Quedan 2 repuestos reservados sin usar; pasan a stock libre de Santa Fe.")
    expect(reservedUnusedText({ count: 1, worksiteNames: ["Santa Fe", "Biodiversa", "Cholguán"] })).toBe("Queda 1 repuesto reservado sin usar; pasa a stock libre de Santa Fe, Biodiversa y Cholguán.")
    expect(reservedUnusedText({ count: 1.5, worksiteNames: ["Santa Fe"] })).toBe("Quedan 1,5 repuestos reservados sin usar; pasan a stock libre de Santa Fe.")
  })
})

describe("repuestos reservados en el registro", () => {
  const job = (parts: FlowJob["parts"], noParts = false): FlowJob => ({ workTypeId: "wt-mec", hours: 1, noParts, parts })
  const blank = { quantity: "1", description: "" }
  const filter = availablePart({ remaining: 2 })

  it("agregar reemplaza la línea en blanco, quita «No se usaron repuestos» y topa en lo que queda", () => {
    const added = addStockPart(job([blank], true), filter, 2)
    expect(added.noParts).toBe(false)
    expect(added.parts).toEqual([{ quantity: "1", description: "Filtro de aceite", source: "stock", productId: "p1", allocationId: "al-1" }])
    // Con menos de una unidad por tomar, la línea parte en lo que queda.
    expect(addStockPart(job([blank]), filter, 0.5).parts[0]!.quantity).toBe("0,5")
    // Sin nada por tomar no cambia el trabajo.
    const same = job([blank])
    expect(addStockPart(same, filter, 0)).toBe(same)
    // Con una línea de texto ya escrita, la de bodega se suma al final.
    expect(addStockPart(job([{ quantity: "3", description: "Grasa" }]), filter, 2).parts.map((part) => part.description)).toEqual(["Grasa", "Filtro de aceite"])
  })

  it("un segundo clic suma 1 a la misma línea sin pasar de lo disponible", () => {
    const once = addStockPart(job([blank]), filter, 2)
    const twice = addStockPart(once, filter, 1)
    expect(twice.parts).toHaveLength(1)
    expect(twice.parts[0]!.quantity).toBe("2")
    // Con media unidad por tomar, suma media.
    expect(addStockPart(once, availablePart({ remaining: 1.5, wholeOnly: false }), 0.5).parts[0]!.quantity).toBe("1,5")
  })

  it("lo que queda por reserva descuenta todas las líneas de todos los trabajos; el tope de una línea descuenta las demás", () => {
    const first = addStockPart(job([blank]), filter, 2)
    const jobs: FlowJob[] = [first, { ...job([{ quantity: "1", description: "Filtro de aceite", source: "stock", productId: "p1", allocationId: "al-1" } as StockFlowPart]), workTypeId: "wt-sold" }]
    expect(leftByAllocation([filter], jobs)).toEqual({ "al-1": 0 })
    // Cada línea puede crecer hasta lo reservado menos lo que tiene la otra.
    expect(stockLineMax(jobs, filter, jobs[0]!.parts[0]!)).toBe(1)
    // Un trabajo sin repuestos no cuenta.
    expect(leftByAllocation([filter], [{ ...first, noParts: true }])).toEqual({ "al-1": 2 })
  })

  it("lo escrito se acota a lo disponible; una unidad entera no admite decimales", () => {
    expect(capStockQuantity("5", { max: 2, wholeOnly: true })).toBe("2")
    expect(capStockQuantity("1,5", { max: 2, wholeOnly: true })).toBe("1")
    expect(capStockQuantity("1,5", { max: 2, wholeOnly: false })).toBe("1,5")
    expect(capStockQuantity("2,5", { max: 1.5, wholeOnly: false })).toBe("1,5")
    // Lo que aún no es un número se respeta: el campo sigue editable.
    expect(capStockQuantity("", { max: 2, wholeOnly: true })).toBe("")
    expect(capStockQuantity("0", { max: 2, wholeOnly: true })).toBe("0")
  })

  const payload = (parts: Array<Record<string, unknown>>) => ({ kind: "C", jobs: [{ workTypeId: "wt-mec", hours: 1, noParts: false, parts }] }) as unknown as SyncRecord

  it("al enviar completa source, productId y allocationId de las líneas de bodega y deja el texto libre igual", () => {
    const draftJob = job([
      { quantity: "2", description: "Filtro de aceite", source: "stock", productId: "p1", allocationId: "al-1" } as StockFlowPart,
      { quantity: "1", description: "" },
      { quantity: "1", description: "Grasa" },
    ])
    const sent = withStockFields(payload([{ quantity: 2, description: "Filtro de aceite" }, { quantity: 1, description: "Grasa" }]), { jobs: [draftJob] })
    expect(sent.kind === "C" && sent.jobs[0]!.parts).toEqual([
      { quantity: 2, description: "Filtro de aceite", source: "stock", productId: "p1", allocationId: "al-1" },
      { quantity: 1, description: "Grasa" },
    ])
  })

  it("si el registro ya trae los campos (los conserva el armado del flujo) no los cambia, y un registro preventivo pasa tal cual", () => {
    const draftJob = job([{ quantity: "1", description: "Filtro", source: "stock", productId: "p1", allocationId: "al-1" } as StockFlowPart])
    const already = payload([{ quantity: 1, description: "Filtro", source: "stock", productId: "p1", allocationId: "al-1" }])
    expect(withStockFields(already, { jobs: [draftJob] })).toEqual(already)
    const preventive = { kind: "P" } as unknown as SyncRecord
    expect(withStockFields(preventive, { jobs: [draftJob] })).toBe(preventive)
    // Con «No se usaron repuestos» el registro no lleva líneas y no se toca.
    const none = payload([])
    expect(withStockFields(none, { jobs: [{ ...draftJob, noParts: true }] })).toEqual(none)
  })
})
