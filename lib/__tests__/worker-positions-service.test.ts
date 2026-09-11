import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite es compatible en runtime; sólo difiere el HKT del driver.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import {
  addWorkerPositionAlias,
  createWorkerCapability,
  createWorkerPosition,
  getWorkerEffectiveCapabilities,
  listWorkerCapabilities,
  listWorkerPositions,
  mergeWorkerPositions,
  removeWorkerCapabilityOverride,
  replaceWorkerPositionCapabilities,
  resolveWorkerPosition,
  updateWorkerPosition,
  WorkerPositionDomainError,
  upsertWorkerCapabilityOverride,
} from "@/lib/services/worker-positions"

beforeAll(async () => {
  await inMemoryDb.insert(schema.worksites).values({
    id: "ws-worker-position-service",
    name: "Faena cargos servicio",
    code: "WPS-01",
  }).onConflictDoNothing()
})

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

describe("catálogo de cargos — resolución transaccional", () => {
  it("crea una sola entrada pendiente para variantes normalizadas y no le asigna capacidades", async () => {
    const first = await resolveWorkerPosition({ name: "  Operador ÁREA Norte  " })
    const second = await resolveWorkerPosition({ name: "operador area norte" })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.position.id).toBe(first.position.id)
    expect(first.position).toMatchObject({
      name: "Operador ÁREA Norte",
      normalizedKey: "operador area norte",
      needsReview: true,
      isActive: true,
    })

    const assignments = await inMemoryDb.query.workerPositionCapabilities.findMany({
      where: (link, { eq }) => eq(link.positionId, first.position.id),
    })
    expect(assignments).toEqual([])
  })

  it("resuelve por código y por alias, sin crear cargos paralelos", async () => {
    const canonical = await createWorkerPosition({
      code: "OPERADOR-MOVIL",
      name: "Operador de equipo móvil",
    })
    await addWorkerPositionAlias({
      positionId: canonical.id,
      alias: "Maquinista móvil",
      source: "manual",
    })

    const byCode = await resolveWorkerPosition({ code: " operador-movil " })
    const byAlias = await resolveWorkerPosition({ name: "MAQUINISTA MÓVIL" })

    expect(byCode).toMatchObject({ created: false, position: { id: canonical.id } })
    expect(byAlias).toMatchObject({ created: false, position: { id: canonical.id } })
  })

  it("calcula capacidades heredadas y aplica overrides individuales", async () => {
    const position = await createWorkerPosition({ code: "CHOFER-TEST", name: "Chofer de prueba" })
    const capabilities = await inMemoryDb.query.workerCapabilities.findMany()
    const drives = capabilities.find((item) => item.code === "drives_vehicle")!
    const operates = capabilities.find((item) => item.code === "operates_equipment")!
    await replaceWorkerPositionCapabilities({
      positionId: position.id,
      capabilityIds: [drives.id],
    })

    await inMemoryDb.insert(schema.workers).values({
      id: "worker-position-service-1",
      firstName: "Ana",
      lastName: "Chofer",
      positionId: position.id,
      position: position.name,
      worksiteId: "ws-worker-position-service",
    })

    await upsertWorkerCapabilityOverride({
      workerId: "worker-position-service-1",
      capabilityId: drives.id,
      mode: "exclude",
      reason: "Temporalmente no conduce",
    })
    await upsertWorkerCapabilityOverride({
      workerId: "worker-position-service-1",
      capabilityId: operates.id,
      mode: "include",
      reason: "Opera equipo por habilitación individual",
    })

    const effective = await getWorkerEffectiveCapabilities("worker-position-service-1")
    expect(effective.map((item) => item.code)).toEqual(["operates_equipment"])
  })

  it("actualiza el catálogo y cuenta cuántos trabajadores usa cada cargo", async () => {
    const position = await createWorkerPosition({
      code: "AYUDANTE-TEST",
      name: "Ayudante temporal",
      needsReview: true,
    })
    const updated = await updateWorkerPosition(position.id, {
      code: "AYUDANTE-TEST",
      name: "Ayudante de terreno",
      isActive: true,
      needsReview: false,
    })
    expect(updated).toMatchObject({ name: "Ayudante de terreno", needsReview: false })

    await inMemoryDb.insert(schema.workers).values({
      id: "worker-position-service-used",
      firstName: "Luis",
      lastName: "Ayudante",
      positionId: position.id,
      position: "Ayudante de terreno",
      worksiteId: "ws-worker-position-service",
    })

    const listed = await listWorkerPositions()
    expect(listed.find((item) => item.id === position.id)).toMatchObject({ workerCount: 1 })
  })

  it("administra capacidades y cuenta los cargos que las heredan", async () => {
    const capability = await createWorkerCapability({
      code: "supervises_work",
      name: "Supervisa trabajos",
      description: "Responsable de supervisión operativa.",
    })
    const position = await createWorkerPosition({ code: "SUPERVISOR-QA", name: "Supervisor QA" })
    await replaceWorkerPositionCapabilities({
      positionId: position.id,
      capabilityIds: [capability.id],
    })

    const listed = await listWorkerCapabilities()
    expect(listed.find((item) => item.id === capability.id)).toMatchObject({ positionCount: 1 })

    const drives = await inMemoryDb.query.workerCapabilities.findFirst({
      where: (item, { eq }) => eq(item.code, "drives_vehicle"),
    })
    await removeWorkerCapabilityOverride("worker-position-service-1", drives!.id)
    expect((await getWorkerEffectiveCapabilities("worker-position-service-1")).map((item) => item.code))
      .toEqual(["drives_vehicle", "operates_equipment"])
  })
})

describe("catálogo de cargos — entradas fuera de rango", () => {
  /** La importación XLSX no acota el largo de la celda «Cargo». Sin estos
   *  guardas el INSERT reventaba contra el CHECK de la tabla, y como el error
   *  crudo de Postgres no es un `WorkerPositionDomainError`, se perdía toda la
   *  importación con el texto del constraint en pantalla. */
  it("rechaza un nombre de cargo más largo de lo que admite el catálogo", async () => {
    await expect(resolveWorkerPosition({ name: "C".repeat(121) }))
      .rejects.toBeInstanceOf(WorkerPositionDomainError)
    await expect(resolveWorkerPosition({ name: "C".repeat(121) }))
      .rejects.toThrow(/supera los 120 caracteres/)
  })

  it("rechaza un código de cargo más largo de lo que admite el catálogo", async () => {
    await expect(resolveWorkerPosition({ code: "K".repeat(81), name: "Cargo válido" }))
      .rejects.toThrow(/supera los 80 caracteres/)
  })

  it("acepta el largo máximo exacto", async () => {
    const { position } = await resolveWorkerPosition({ name: "D".repeat(120) })
    expect(position.name).toHaveLength(120)
  })

  it("manda a Sin clasificar un nombre demasiado corto en vez de fallar", async () => {
    const { position, created } = await resolveWorkerPosition({ name: "A" })
    expect(position.code).toBe("SIN-CLASIFICAR")
    expect(created).toBe(false)
  })
})

describe("fusión de cargos duplicados", () => {
  /** El duplicado clásico: la importación crea dos entradas para el mismo
   *  puesto. Borrar el sobrante es imposible —`worker_position_history` lo
   *  referencia con ON DELETE restrict y es inmutable— así que la fusión mueve
   *  la gente y deja la grafía vieja como alias del cargo bueno. */
  async function sembrarDuplicado(sufijo: string) {
    const bueno = await createWorkerPosition({ code: `CONDUCTOR-${sufijo}`, name: `Conductor ${sufijo}` })
    const duplicado = await createWorkerPosition({ code: `CHOFER-${sufijo}`, name: `Chofer ${sufijo}` })
    await inMemoryDb.insert(schema.workers).values({
      id: `worker-merge-${sufijo}`,
      firstName: "Pedro",
      lastName: "Duplicado",
      positionId: duplicado.id,
      position: duplicado.name,
      worksiteId: "ws-worker-position-service",
    })
    return { bueno, duplicado }
  }

  it("mueve los trabajadores y deja el cargo origen como lápida inactiva", async () => {
    const { bueno, duplicado } = await sembrarDuplicado("a")

    const resultado = await mergeWorkerPositions({
      sourceId: duplicado.id, targetId: bueno.id, actorUserId: "user-merge",
    })

    expect(resultado).toMatchObject({ movedWorkers: 1 })
    const trabajador = await inMemoryDb.query.workers.findFirst({
      where: (w, { eq }) => eq(w.id, "worker-merge-a"),
    })
    expect(trabajador?.positionId).toBe(bueno.id)
    // La columna legada también se mueve: es la que leen los informes viejos.
    expect(trabajador?.position).toBe(bueno.name)

    const origen = await inMemoryDb.query.workerPositions.findFirst({
      where: (p, { eq }) => eq(p.id, duplicado.id),
    })
    expect(origen?.isActive).toBe(false)
  })

  it("hace que la grafía fusionada resuelva al cargo bueno en la próxima importación", async () => {
    const { bueno, duplicado } = await sembrarDuplicado("b")
    await mergeWorkerPositions({ sourceId: duplicado.id, targetId: bueno.id })

    // Esto es el punto de toda la operación: sin el alias, la importación
    // siguiente volvería a crear el duplicado que acabamos de fusionar.
    const { position, created } = await resolveWorkerPosition({ name: "Chofer b" })
    expect(created).toBe(false)
    expect(position.id).toBe(bueno.id)
  })

  it("deja traza individual en el historial de cada trabajador movido", async () => {
    const { bueno, duplicado } = await sembrarDuplicado("c")
    await mergeWorkerPositions({ sourceId: duplicado.id, targetId: bueno.id, actorUserId: "user-merge" })

    const historia = await inMemoryDb.query.workerPositionHistory.findMany({
      where: (h, { eq }) => eq(h.workerId, "worker-merge-c"),
    })
    const fusion = historia.find((fila) => fila.nextPositionId === bueno.id)
    expect(fusion).toMatchObject({
      previousPositionId: duplicado.id,
      source: "admin",
      changedByUserId: "user-merge",
    })
    expect(fusion?.reason).toContain("Fusión")
  })

  it("rechaza fusionar un cargo consigo mismo o contra uno de sistema", async () => {
    const { bueno, duplicado } = await sembrarDuplicado("d")
    await expect(mergeWorkerPositions({ sourceId: bueno.id, targetId: bueno.id }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" })

    const sistema = await inMemoryDb.query.workerPositions.findFirst({
      where: (p, { eq }) => eq(p.code, "SIN-CLASIFICAR"),
    })
    await expect(mergeWorkerPositions({ sourceId: sistema!.id, targetId: duplicado.id }))
      .rejects.toMatchObject({ code: "SYSTEM_RECORD" })
  })

  it("rechaza fusionar hacia un cargo inactivo", async () => {
    const { bueno, duplicado } = await sembrarDuplicado("e")
    await updateWorkerPosition(bueno.id, { code: bueno.code, name: bueno.name, isActive: false })

    await expect(mergeWorkerPositions({ sourceId: duplicado.id, targetId: bueno.id }))
      .rejects.toMatchObject({ code: "INACTIVE" })
  })
})
