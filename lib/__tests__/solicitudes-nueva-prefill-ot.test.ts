/**
 * Prellenado de «Nueva solicitud» para pedir repuestos desde una OT (`?ot=`) o
 * desde un equipo de flota (`?vehiculo=`), y la copia de una solicitud con equipo
 * (`?desde=`). Es el contrato que consumen el botón «Pedir repuestos» de la OT y la
 * ficha del equipo, así que se prueba con la base mockeada: lo que importa es qué
 * decide el servidor con lo que encuentra, no el SQL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

/** Cada `db.select()` consume el siguiente resultado de la cola, en orden de llamada. */
const selectResults: unknown[][] = []
const findFirstResults: unknown[] = []

function selectChain() {
  const rows = selectResults.shift() ?? []
  const chain: Record<string, unknown> = {}
  for (const method of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit"]) chain[method] = () => chain
  chain.then = (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject)
  return chain
}

vi.mock("@/db", () => ({
  db: {
    select: () => selectChain(),
    query: { purchaseRequests: { findFirst: async () => findFirstResults.shift() } },
  },
}))
vi.mock("@/lib/auth/can", () => ({
  canAccessWorksite: (session: Session, worksiteId: string) =>
    session.user.isGlobal === true || session.user.worksiteIds.includes(worksiteId),
}))
vi.mock("@/lib/services/epp-replenishment", () => ({ listReplenishmentSuggestions: vi.fn(async () => []) }))
vi.mock("@/lib/services/fleet", () => ({
  vehicleLabel: (vehicle: { plate: string; code: string | null }) =>
    vehicle.code ? `${vehicle.code} · ${vehicle.plate}` : vehicle.plate,
}))

import { buildPrefill } from "@/app/(app)/solicitudes/nueva/prefill"

function sessionOf(worksiteIds: string[], permissions: string[] = ["repuestos:create"]): Session {
  return {
    expires: "2099-01-01T00:00:00.000Z",
    user: { id: "u-jefe", name: "Alexis", email: "a@chome.test", permissions, worksiteIds, isGlobal: false, roles: [] },
  } as unknown as Session
}

const base = { reposicion: false, desdeId: "", productoIds: [], cantidades: [], emergencyResourceId: "" }

const OT_ROW = {
  id: "ot-1", folio: "OT-BIO-0007", status: "en_ejecucion", orderWorksiteId: "ws-bio",
  vehicleId: "v-1", code: "KA-135", plate: "RBYD-98", isActive: true, vehicleWorksiteId: "ws-bio",
}
const VEHICLE_ROW = { id: "v-1", code: "KA-135", plate: "RBYD-98", isActive: true, worksiteId: "ws-bio" }

beforeEach(() => {
  selectResults.length = 0
  findFirstResults.length = 0
})

describe("buildPrefill — repuestos desde una OT (?ot=)", () => {
  it("precarga faena, vehículo y OT desde ?ot=", async () => {
    selectResults.push([OT_ROW])
    const result = await buildPrefill({ ...base, session: sessionOf(["ws-bio"]), workOrderId: "ot-1" })

    expect(result.initialWorksiteId).toBe("ws-bio")
    // Con una OT de por medio el pedido nace con urgencia alta.
    expect(result.initialUrgency).toBe("high")
    expect(result.prefillItems).toEqual([{
      productId: null, productNameFree: "", quantity: 1, unitOfMeasure: "unidad", urgency: "high", notes: "",
      vehicleId: "v-1", vehicleLabel: "KA-135 · RBYD-98", workOrderId: "ot-1", workOrderFolio: "OT-BIO-0007",
    }])
    expect(result.prefillNotice).toBe("Repuestos para la OT OT-BIO-0007 · KA-135 · RBYD-98. Completa la descripción y la cantidad.")
  })

  it("abre en la faena del equipo aunque la OT se creó en otra", async () => {
    selectResults.push([{ ...OT_ROW, orderWorksiteId: "ws-cho", vehicleWorksiteId: "ws-bio" }])
    const result = await buildPrefill({ ...base, session: sessionOf(["ws-bio", "ws-cho"]), workOrderId: "ot-1" })
    expect(result.initialWorksiteId).toBe("ws-bio")
  })

  it("ignora una OT cerrada con aviso", async () => {
    for (const status of ["cerrada", "anulada"]) {
      selectResults.push([{ ...OT_ROW, status }])
      const result = await buildPrefill({ ...base, session: sessionOf(["ws-bio"]), workOrderId: "ot-1" })
      expect(result).toEqual({ prefillNotice: "La OT no existe, está cerrada o está fuera de tus faenas." })
    }
  })

  it("ignora una OT fuera del alcance", async () => {
    selectResults.push([OT_ROW])
    const result = await buildPrefill({ ...base, session: sessionOf(["ws-cho"]), workOrderId: "ot-1" })
    expect(result).toEqual({ prefillNotice: "La OT no existe, está cerrada o está fuera de tus faenas." })
  })

  it("una OT que no existe avisa lo mismo y no precarga nada", async () => {
    selectResults.push([])
    const result = await buildPrefill({ ...base, session: sessionOf(["ws-bio"]), workOrderId: "ot-fantasma" })
    expect(result).toEqual({ prefillNotice: "La OT no existe, está cerrada o está fuera de tus faenas." })
  })

  it("una OT de un equipo dado de baja no abre el creador con él", async () => {
    selectResults.push([{ ...OT_ROW, isActive: false }])
    const result = await buildPrefill({ ...base, session: sessionOf(["ws-bio"]), workOrderId: "ot-1" })
    expect(result.prefillItems).toBeUndefined()
    expect(result.initialWorksiteId).toBeUndefined()
    expect(result.prefillNotice).toMatch(/dado de baja/)
  })

  it("la OT manda sobre otros orígenes del enlace", async () => {
    selectResults.push([OT_ROW])
    const result = await buildPrefill({
      ...base, session: sessionOf(["ws-bio"]), workOrderId: "ot-1", productoIds: ["p-1"], cantidades: ["3"],
    })
    expect(result.prefillItems).toHaveLength(1)
    expect(result.prefillItems![0]).toMatchObject({ workOrderId: "ot-1" })
  })
})

describe("buildPrefill — repuestos desde un equipo (?vehiculo=)", () => {
  it("precarga sólo el vehículo desde ?vehiculo=", async () => {
    selectResults.push([VEHICLE_ROW])
    const result = await buildPrefill({ ...base, session: sessionOf(["ws-bio"]), vehicleId: "v-1" })

    expect(result.initialWorksiteId).toBe("ws-bio")
    // Sin OT no hay urgencia que sugerir.
    expect(result.initialUrgency).toBeUndefined()
    expect(result.prefillItems).toEqual([{
      productId: null, productNameFree: "", quantity: 1, unitOfMeasure: "unidad", urgency: "normal", notes: "",
      vehicleId: "v-1", vehicleLabel: "KA-135 · RBYD-98", workOrderId: null, workOrderFolio: null,
    }])
    expect(result.prefillNotice).toBe("Repuestos para el equipo KA-135 · RBYD-98. Completa la descripción y la cantidad.")
  })

  it("un equipo fuera del alcance o inexistente no precarga nada", async () => {
    selectResults.push([VEHICLE_ROW])
    expect(await buildPrefill({ ...base, session: sessionOf(["ws-cho"]), vehicleId: "v-1" }))
      .toEqual({ prefillNotice: "El equipo no existe o está fuera de tus faenas." })

    selectResults.push([])
    expect(await buildPrefill({ ...base, session: sessionOf(["ws-bio"]), vehicleId: "v-fantasma" }))
      .toEqual({ prefillNotice: "El equipo no existe o está fuera de tus faenas." })
  })

  it("un equipo dado de baja no admite pedidos", async () => {
    selectResults.push([{ ...VEHICLE_ROW, isActive: false }])
    const result = await buildPrefill({ ...base, session: sessionOf(["ws-bio"]), vehicleId: "v-1" })
    expect(result.prefillItems).toBeUndefined()
    expect(result.prefillNotice).toMatch(/dado de baja/)
  })
})

describe("buildPrefill — copia de una solicitud con equipo de flota (?desde=)", () => {
  const source = (overrides: Record<string, unknown> = {}) => ({
    id: "req-1", code: "REP-0042", worksiteId: "ws-bio", requesterId: "u-jefe", urgency: "high",
    items: [{
      productId: null, productNameFree: "Filtro hidráulico", quantity: 4, unitOfMeasure: "unidad", urgency: "high",
      notes: null, suggestedSupplierId: null, supplierHint: null, workerId: null, equipmentId: null,
      vehicleId: "v-1", workOrderId: "ot-1", estimatedUnitPrice: 35_000, attributes: [],
    }],
    ...overrides,
  })

  it("copia equipo y precio estimado, pero no la OT", async () => {
    findFirstResults.push(source())
    selectResults.push([VEHICLE_ROW])
    const result = await buildPrefill({ ...base, session: sessionOf(["ws-bio"]), desdeId: "req-1" })

    expect(result.prefillItems).toHaveLength(1)
    const item = result.prefillItems![0]!
    expect(item).toMatchObject({
      productNameFree: "Filtro hidráulico", quantity: 4, vehicleId: "v-1", vehicleLabel: "KA-135 · RBYD-98", estimatedUnitPrice: 35_000,
    })
    // La OT puede estar cerrada y una copia es un pedido nuevo.
    expect(item.workOrderId ?? null).toBeNull()
    expect(item.workOrderFolio ?? null).toBeNull()
    // El equipo es de la faena de origen: el creador se abre en ella.
    expect(result.initialWorksiteId).toBe("ws-bio")
    expect(result.prefillNotice).toBe("Ítems copiados de REP-0042. Revísalos antes de enviar: la copia se crea recién al enviarla.")
  })

  it("suelta el equipo que ya no está activo o cambió de faena, y lo avisa", async () => {
    for (const vehicle of [{ ...VEHICLE_ROW, isActive: false }, { ...VEHICLE_ROW, worksiteId: "ws-cho" }]) {
      findFirstResults.push(source())
      selectResults.push([vehicle])
      const result = await buildPrefill({ ...base, session: sessionOf(["ws-bio"]), desdeId: "req-1" })

      expect(result.prefillItems![0]!.vehicleId ?? null).toBeNull()
      expect(result.prefillItems![0]!.estimatedUnitPrice).toBe(35_000)
      expect(result.initialWorksiteId).toBeUndefined()
      expect(result.prefillNotice).toContain("vuelve a elegirlo")
    }
  })

  it("una copia sin equipo no mueve la faena inicial", async () => {
    findFirstResults.push(source({
      items: [{
        productId: "prod-1", productNameFree: null, quantity: 2, unitOfMeasure: "unidad", urgency: "normal", notes: null,
        suggestedSupplierId: null, supplierHint: null, workerId: null, equipmentId: null,
        vehicleId: null, workOrderId: null, estimatedUnitPrice: null, attributes: [],
      }],
    }))
    const result = await buildPrefill({ ...base, session: sessionOf(["ws-bio"]), desdeId: "req-1" })
    expect(result.initialWorksiteId).toBeUndefined()
    expect(result.prefillItems![0]).toMatchObject({ vehicleId: null, estimatedUnitPrice: null })
  })

  it("sin acceso a la faena de origen no copia nada", async () => {
    findFirstResults.push(source())
    expect(await buildPrefill({ ...base, session: sessionOf(["ws-cho"]), desdeId: "req-1" })).toEqual({})
  })
})

describe("buildPrefill — «Pedir repuestos» desde la ficha de un repuesto (?repuesto=)", () => {
  const PART = { id: "rpt-1", name: "Filtro de aceite", unitOfMeasure: "unidad", isActive: true, isSparePart: true }

  it("abre el pedido con el repuesto elegido y pide el equipo y la cantidad", async () => {
    selectResults.push([PART])
    const result = await buildPrefill({ ...base, session: sessionOf(["ws-bio"]), sparePartId: "rpt-1" })
    expect(result.sparePartDefaults).toBe(true)
    expect(result.prefillItems).toEqual([{
      productId: "rpt-1", productNameFree: "", quantity: 1, unitOfMeasure: "unidad", urgency: "normal", notes: "",
    }])
    expect(result.prefillNotice).toBe("Filtro de aceite preseleccionado. Indica el equipo y la cantidad.")
  })

  it("un repuesto desactivado o un producto que no es repuesto no se precarga", async () => {
    selectResults.push([{ ...PART, isActive: false }])
    const inactive = await buildPrefill({ ...base, session: sessionOf(["ws-bio"]), sparePartId: "rpt-1" })
    expect(inactive.prefillItems).toBeUndefined()
    expect(inactive.prefillNotice).toMatch(/desactivado/)

    selectResults.push([{ ...PART, isSparePart: false }])
    const common = await buildPrefill({ ...base, session: sessionOf(["ws-bio"]), sparePartId: "rpt-1" })
    expect(common.prefillItems).toBeUndefined()

    selectResults.push([])
    const missing = await buildPrefill({ ...base, session: sessionOf(["ws-bio"]), sparePartId: "no-existe" })
    expect(missing.prefillItems).toBeUndefined()
  })
})
