/**
 * Aviso a mantención cuando el repuesto de una OT llega a faena (2026-11-07).
 *
 * Unitario, con `@/db` simulado: lo que se prueba son las reglas del aviso
 * —quién lo recibe, cuándo NO se manda, qué clave de deduplicación lleva—, no
 * el SQL. El SQL de resolución de destinatarios ya lo ejercita la suite PGlite
 * de OT (`mantencion-work-orders-pglite.test.ts`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  order: null as Record<string, unknown> | null,
  /** Usuarios con el permiso por un rol que no es `administrador`. */
  viaRole: [] as Array<{ userId: string }>,
  /** Usuarios con el permiso concedido directamente. */
  direct: [] as Array<{ userId: string }>,
  /** Lo que devuelve la resolución de quién tiene `mant:ot:manage` en la faena. */
  holders: [] as string[],
  sent: [] as Array<{ userIds: string[]; input: Record<string, unknown> }>,
}))

// El constructor de consultas devuelve filas según la tabla de `.from(...)`:
// así la prueba no depende del orden en que se hacen las consultas.
vi.mock("@/db", async () => {
  const schema = await import("@/db/schema")
  const rowsFor = (table: unknown): unknown[] => {
    if (table === schema.mantWorkOrders) return state.order ? [state.order] : []
    if (table === schema.userRoles) return state.viaRole
    if (table === schema.userPermissions) return state.direct
    throw new Error("Tabla no prevista en la prueba")
  }
  const builder = (table?: unknown): unknown => new Proxy({}, {
    get(_target, property) {
      if (property === "then") return (resolve: (rows: unknown[]) => unknown) => resolve(rowsFor(table))
      if (property === "from") return (from: unknown) => builder(from)
      return () => builder(table)
    },
  })
  return { db: { select: () => builder() } }
})

vi.mock("@/lib/services/notification-targeting", () => ({
  getUserIdsWithPermissionForWorksite: vi.fn(async () => [...state.holders]),
}))

vi.mock("@/lib/services/notification-create", () => ({
  notifyManyUser: vi.fn(async (userIds: string[], input: Record<string, unknown>) => {
    state.sent.push({ userIds: [...userIds].sort(), input })
  }),
  notifyAfterCommit: vi.fn((thunk: () => unknown) => { void thunk() }),
}))

const { notifyWorkOrderPartsReceived } = await import("@/lib/services/mantencion/work-orders/notifications")
const { getUserIdsWithPermissionForWorksite } = await import("@/lib/services/notification-targeting")

const OT = {
  id: "ot-1", folio: "OT-BIO-0007", worksiteId: "ws-bio", status: "en_ejecucion",
  assignedToUserId: "u-mec", equipmentSnapshot: { code: "KA-135", type: "Camión" },
}
const arrival = { workOrderId: "ot-1", receiptId: "rcp-9", actorUserId: "u-bodega", itemCount: 2 }

beforeEach(() => {
  state.order = { ...OT }
  state.viaRole = []
  state.direct = []
  state.holders = []
  state.sent = []
  vi.mocked(getUserIdsWithPermissionForWorksite).mockClear()
})

describe("notifyWorkOrderPartsReceived", () => {
  it("avisa al mecánico asignado y a quien administra, nunca al actor, con dedupe por recepción", async () => {
    // El actor (quien recibe en bodega) y un administrador de plataforma también tienen mant:ot:manage.
    state.holders = ["u-jefe", "u-bodega", "u-admin"]
    state.viaRole = [{ userId: "u-jefe" }, { userId: "u-bodega" }]

    await notifyWorkOrderPartsReceived(arrival)

    expect(getUserIdsWithPermissionForWorksite).toHaveBeenCalledWith("mant:ot:manage", "ws-bio")
    expect(state.sent).toHaveLength(1)
    // El administrador queda fuera porque la faena tiene un responsable de verdad.
    expect(state.sent[0]!.userIds).toEqual(["u-jefe", "u-mec"])
    expect(state.sent[0]!.input).toMatchObject({
      type: "mant_ot_parts_received",
      title: "Repuestos recibidos para OT OT-BIO-0007",
      body: "KA-135 · Camión · 2 líneas recibidas en faena. Revisa «Repuestos pedidos» en la OT.",
      entityType: "mant_work_order",
      entityId: "ot-1",
      entityHref: "/mantencion/ot/ot-1",
      dedupeKey: "mant-ot-parts:ot-1:rcp-9",
    })
  })

  it("en singular dice «1 línea recibida»", async () => {
    await notifyWorkOrderPartsReceived({ ...arrival, itemCount: 1 })
    expect(state.sent[0]!.input.body).toBe("KA-135 · Camión · 1 línea recibida en faena. Revisa «Repuestos pedidos» en la OT.")
  })

  it("si nadie más administra la faena, el aviso llega al administrador para no perderse", async () => {
    state.holders = ["u-admin"]
    await notifyWorkOrderPartsReceived(arrival)
    expect(state.sent[0]!.userIds).toEqual(["u-admin", "u-mec"])
  })

  it("el actor no se avisa a sí mismo aunque sea el mecánico asignado", async () => {
    state.holders = ["u-jefe"]
    state.viaRole = [{ userId: "u-jefe" }]
    await notifyWorkOrderPartsReceived({ ...arrival, actorUserId: "u-mec" })
    expect(state.sent[0]!.userIds).toEqual(["u-jefe"])
  })

  it("una OT sin mecánico asignado avisa sólo a quien administra", async () => {
    state.order = { ...OT, status: "solicitada", assignedToUserId: null }
    state.holders = ["u-jefe"]
    state.viaRole = [{ userId: "u-jefe" }]
    await notifyWorkOrderPartsReceived(arrival)
    expect(state.sent[0]!.userIds).toEqual(["u-jefe"])
  })

  it.each(["cerrada", "anulada"])("no avisa si la OT está %s", async (status) => {
    state.order = { ...OT, status }
    state.holders = ["u-jefe"]
    state.viaRole = [{ userId: "u-jefe" }]
    await notifyWorkOrderPartsReceived(arrival)
    expect(state.sent).toEqual([])
  })

  it("no avisa si la OT ya no existe", async () => {
    state.order = null
    await notifyWorkOrderPartsReceived(arrival)
    expect(state.sent).toEqual([])
  })

  it("no avisa si no queda ningún destinatario", async () => {
    state.order = { ...OT, assignedToUserId: null }
    state.holders = ["u-bodega"]
    await notifyWorkOrderPartsReceived(arrival)
    expect(state.sent).toEqual([])
  })
})
