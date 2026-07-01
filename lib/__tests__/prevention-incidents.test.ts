import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.preventionIncidentActions)
  await inMemoryDb.delete(schema.preventionIncidents)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "user-1",
    name: "Prevencionista",
    email: "prev@example.test",
    hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: "ws-1",
    name: "Faena A",
    code: "FA",
    isActive: true,
  })
  await inMemoryDb.insert(schema.workers).values({
    id: "worker-1",
    firstName: "Ada",
    lastName: "Lovelace",
    rut: "11.111.111-1",
    position: "Operadora",
    worksiteId: "ws-1",
    isActive: true,
  })
})

describe("prevention incidents", () => {
  it("creates an incident and blocks closing while actions are pending", async () => {
    const { createIncident, addIncidentAction, closeIncident } = await import("@/lib/services/prevention-incidents")

    const incident = await createIncident({
      worksiteId: "ws-1",
      workerId: "worker-1",
      type: "cuasi_accidente",
      severity: "moderado",
      occurredAt: "2026-07-01T10:00:00.000Z",
      title: "Casi golpe por retroceso",
      description: "Equipo retrocede en zona peatonal",
      immediateCause: "Falta de segregacion",
      rootCause: "Control operacional insuficiente",
    }, "user-1", ["ws-1"])

    expect(incident.status).toBe("open")

    await addIncidentAction({
      incidentId: incident.id,
      description: "Instalar barrera fisica",
      responsible: "Jefe de faena",
      dueDate: "2026-07-10",
    }, ["ws-1"])

    await expect(closeIncident(incident.id, "user-1", ["ws-1"]))
      .rejects.toThrow(/acciones pendientes/i)
  })

  it("closes the incident once all actions are terminal", async () => {
    const { createIncident, addIncidentAction, closeIncidentAction, closeIncident } =
      await import("@/lib/services/prevention-incidents")

    const incident = await createIncident({
      worksiteId: "ws-1",
      type: "incidente",
      severity: "leve",
      occurredAt: "2026-07-02T08:00:00.000Z",
      title: "Caida de herramienta",
      description: "Martillo cae desde andamio",
    }, "user-1", ["ws-1"])

    const action = await addIncidentAction({
      incidentId: incident.id,
      description: "Colocar rodapie y arnes",
      responsible: "Capataz",
      dueDate: "2026-07-05",
    }, ["ws-1"])

    await closeIncidentAction(action.id, "cerrada", ["ws-1"])
    const closed = await closeIncident(incident.id, "user-1", ["ws-1"])
    expect(closed.status).toBe("closed")
    expect(closed.closedAt).toBeTruthy()
  })

  it("closes the incident when the only non-closed action is cancelled", async () => {
    const { createIncident, addIncidentAction, closeIncidentAction, closeIncident } =
      await import("@/lib/services/prevention-incidents")

    const incident = await createIncident({
      worksiteId: "ws-1",
      type: "incidente",
      severity: "leve",
      occurredAt: "2026-07-03T08:00:00.000Z",
      title: "Accion cancelada",
      description: "La accion correctiva ya no aplica",
    }, "user-1", ["ws-1"])

    const action = await addIncidentAction({
      incidentId: incident.id,
      description: "Reemplazar señaletica (ya no aplica)",
      responsible: "Capataz",
      dueDate: "2026-07-05",
    }, ["ws-1"])

    await closeIncidentAction(action.id, "cancelada", ["ws-1"])
    const closed = await closeIncident(incident.id, "user-1", ["ws-1"])
    expect(closed.status).toBe("closed")
  })

  it("denies creating an incident outside worksite scope", async () => {
    const { createIncident } = await import("@/lib/services/prevention-incidents")

    await expect(createIncident({
      worksiteId: "ws-1",
      type: "incidente",
      occurredAt: "2026-07-01T10:00:00.000Z",
      title: "X",
      description: "Y",
    }, "user-1", [])).rejects.toThrow(/sin acceso/i)
  })
})