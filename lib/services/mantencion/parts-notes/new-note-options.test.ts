import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * El alcance de las opciones de «Nueva nota de pedido» (faenas, equipos, centros de costo, OT, proveedores). La base se
 * simula con una cadena que responde, en orden, lo que cada consulta devolvería, y guarda los `where` para comprobar el
 * SQL: quién ve qué OT es una regla del servidor. Que el alta rechace lo que no corresponde lo prueba `createPartsNote`.
 */

const queue = vi.hoisted(() => ({ results: [] as unknown[][], wheres: [] as unknown[] }))

vi.mock("@/db", () => {
  const chain = (): Record<string, unknown> => {
    const rows = queue.results.shift() ?? []
    const link: Record<string, unknown> = {}
    for (const method of ["from", "innerJoin", "orderBy", "limit"]) link[method] = () => link
    link.where = (condition: unknown) => { queue.wheres.push(condition); return link }
    link.then = (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject)
    return link
  }
  return { db: { select: chain } }
})

const { loadNewNoteOptions } = await import("./new-note-options")

const dialect = new PgDialect()
const render = (condition: unknown) => dialect.sqlToQuery(condition as SQL)

const WORKSITES = [{ id: "ws-1", name: "Biodiversa" }, { id: "ws-2", name: "Cholguán" }, { id: "ws-3", name: "Hualpén" }]
const SNAPSHOT = { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Biodiversa", unit: "km" }

const viewer = (overrides: Partial<Parameters<typeof loadNewNoteOptions>[0]> = {}) => ({
  userId: "u-mec", email: null, permissions: ["mant:np:create"], worksiteIds: ["ws-1"], isGlobal: false, ...overrides,
})

/** Una lectura completa: faenas activas y, en el orden de la carga, equipos, centros de costo, OT y proveedores. */
function seed() {
  queue.results = [
    WORKSITES,
    [{ id: "v-1", worksiteId: "ws-1", code: "KA-135", plate: "RBYD-98", typeName: "Camión" }, { id: "v-2", worksiteId: "ws-1", code: null, plate: "ABCD-12", typeName: "Camioneta" }],
    [{ id: "cc-1", worksiteId: "ws-1", code: "CC-1", name: "Taller" }, { id: "cc-0", worksiteId: null, code: "CC-0", name: "Sin faena" }],
    [{ id: "ot-1", worksiteId: "ws-1", vehicleId: "v-1", folio: "OT-0001", snapshot: SNAPSHOT, assignedToUserId: "u-mec" }],
    [{ id: "sup-1", name: "Repuestos Sur", rut: "76.000.000-1" }],
  ]
}

beforeEach(() => { queue.results = []; queue.wheres = [] })

describe("loadNewNoteOptions", () => {
  it("ofrece sólo las faenas de su alcance y arma equipos, centros de costo, OT y proveedores", async () => {
    seed()
    const options = await loadNewNoteOptions(viewer())
    expect(options.worksites).toEqual([{ id: "ws-1", name: "Biodiversa" }])
    expect(options.vehicles).toEqual([
      { id: "v-1", worksiteId: "ws-1", code: "KA-135", plate: "RBYD-98", typeName: "Camión" },
      // Sin código interno, la patente.
      { id: "v-2", worksiteId: "ws-1", code: "ABCD-12", plate: "ABCD-12", typeName: "Camioneta" },
    ])
    // Un centro de costo sin faena no se puede usar de cargo: el alta lo rechazaría.
    expect(options.costCenters).toEqual([{ id: "cc-1", worksiteId: "ws-1", code: "CC-1", name: "Taller" }])
    expect(options.workOrders).toEqual([{ id: "ot-1", worksiteId: "ws-1", vehicleId: "v-1", folio: "OT-0001", equipment: "KA-135 · Camión" }])
    expect(options.suppliers).toEqual([{ id: "sup-1", name: "Repuestos Sur", rut: "76.000.000-1" }])
  })

  it("un rol global ve todas las faenas activas; los equipos y OT se piden por TODAS ellas", async () => {
    seed()
    const options = await loadNewNoteOptions(viewer({ isGlobal: true, worksiteIds: [] }))
    expect(options.worksites.map((item) => item.id)).toEqual(["ws-1", "ws-2", "ws-3"])
    // where #1 = equipos (#0 son las faenas activas): las faenas del alcance viajan como parámetros del IN.
    expect(render(queue.wheres[1]).params).toEqual(expect.arrayContaining(["ws-1", "ws-2", "ws-3"]))
  })

  it("una faena que no es de su alcance ni se consulta: con ninguna en el alcance no pregunta nada más", async () => {
    queue.results = [WORKSITES]
    const options = await loadNewNoteOptions(viewer({ worksiteIds: ["ws-9"] }))
    expect(options).toEqual({ worksites: [], vehicles: [], costCenters: [], workOrders: [], suppliers: [] })
    expect(queue.wheres).toHaveLength(1)
  })

  it("sin mant:ot:manage sólo ve las OT asignadas a él; con ese permiso, las de todo su alcance", async () => {
    seed()
    await loadNewNoteOptions(viewer())
    // where #0 = faenas activas, #1 equipos, #2 centros de costo, #3 OT, #4 proveedores.
    const mine = render(queue.wheres[3])
    expect(mine.sql).toContain('"assigned_to_user_id" = $')
    expect(mine.params).toEqual(expect.arrayContaining(["u-mec", "asignada", "en_ejecucion", "ws-1"]))

    queue.wheres = []
    seed()
    await loadNewNoteOptions(viewer({ permissions: ["mant:np:create", "mant:ot:manage"] }))
    const managed = render(queue.wheres[3])
    expect(managed.sql).not.toContain("assigned_to_user_id")
    expect(managed.params).not.toContain("u-mec")
  })
})
