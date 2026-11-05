import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { and, eq, inArray } from "drizzle-orm"
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
  BULK_ASSIGN_WORKER_POSITION_LIMIT,
  bulkAssignWorkerPosition,
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

describe("clases de licencia que exige el cargo", () => {
  it("un cargo nuevo no exige ninguna clase en particular", async () => {
    const position = await createWorkerPosition({ code: "LIC-SIN", name: "Cargo sin licencia" })

    expect(position.requiredLicenseClasses).toEqual([])
  })

  it("guarda las clases sin duplicados y en el orden canónico, no en el del clic", async () => {
    const position = await createWorkerPosition({
      code: "LIC-CAMION",
      name: "Conductor de camión (licencias)",
      requiredLicenseClasses: ["B", "A5", "A4", "A5"],
    })

    expect(position.requiredLicenseClasses).toEqual(["A4", "A5", "B"])
  })

  it("rechaza una clase desconocida con un mensaje, sin crear el cargo", async () => {
    await expect(createWorkerPosition({
      code: "LIC-MALA",
      name: "Cargo con clase mala",
      requiredLicenseClasses: ["A4", "Z9"],
    })).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringMatching(/Clase de licencia/) })

    const created = await inMemoryDb.query.workerPositions.findFirst({
      where: (item, { eq: equals }) => equals(item.code, "LIC-MALA"),
    })
    expect(created).toBeUndefined()
  })

  it("al actualizar, ausente no toca las clases; una lista las reemplaza y vacía las borra", async () => {
    const position = await createWorkerPosition({
      code: "LIC-EDIT",
      name: "Cargo editable (licencias)",
      requiredLicenseClasses: ["A4", "A5"],
    })
    const identity = { code: position.code, name: position.name }

    // Ausente: las acciones que sólo cambian el estado no mandan las clases.
    const untouched = await updateWorkerPosition(position.id, { ...identity, needsReview: true })
    expect(untouched.requiredLicenseClasses).toEqual(["A4", "A5"])

    const replaced = await updateWorkerPosition(position.id, { ...identity, requiredLicenseClasses: ["D"] })
    expect(replaced.requiredLicenseClasses).toEqual(["D"])

    const cleared = await updateWorkerPosition(position.id, { ...identity, requiredLicenseClasses: [] })
    expect(cleared.requiredLicenseClasses).toEqual([])
  })

  it("rechaza una clase desconocida al actualizar y deja las que ya tenía", async () => {
    const position = await createWorkerPosition({
      code: "LIC-EDIT-MALA",
      name: "Cargo editable malo",
      requiredLicenseClasses: ["B"],
    })

    await expect(updateWorkerPosition(position.id, {
      code: position.code, name: position.name, requiredLicenseClasses: ["XX"],
    })).rejects.toMatchObject({ code: "INVALID_INPUT" })

    const unchanged = await inMemoryDb.query.workerPositions.findFirst({
      where: (item, { eq: equals }) => equals(item.id, position.id),
    })
    expect(unchanged?.requiredLicenseClasses).toEqual(["B"])
  })

  it("el listado devuelve las clases de cada cargo", async () => {
    const position = await createWorkerPosition({
      code: "LIC-LISTA",
      name: "Cargo en el listado",
      requiredLicenseClasses: ["A2", "A4"],
    })

    const listed = await listWorkerPositions()

    expect(listed.find((item) => item.id === position.id)?.requiredLicenseClasses).toEqual(["A2", "A4"])
    expect(listed.find((item) => item.code === "SIN-CLASIFICAR")?.requiredLicenseClasses).toEqual([])
  })
})

describe("asignación masiva de cargo", () => {
  const WS_A = "ws-bulk-a"
  const WS_B = "ws-bulk-b"
  const ACTOR = "user-bulk-assign"
  const ACTOR_EMAIL = "bulk@test.cl"

  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values([
      { id: WS_A, name: "Faena masiva A", code: "BLK-A" },
      { id: WS_B, name: "Faena masiva B", code: "BLK-B" },
    ]).onConflictDoNothing()
    await inMemoryDb.insert(schema.users).values({
      id: ACTOR, name: "Admin masivo", email: ACTOR_EMAIL, hashedPassword: "x", isActive: true,
    }).onConflictDoNothing()
  })

  /** Trabajadores sin cargo del catálogo (sólo el texto legado), como los deja una importación. */
  async function sembrar(sufijo: string, worksites: string[] = [WS_A, WS_A, WS_A]) {
    const ids = worksites.map((_, index) => `worker-bulk-${sufijo}-${index + 1}`)
    await inMemoryDb.insert(schema.workers).values(ids.map((id, index) => ({
      id,
      firstName: `Persona${index + 1}`,
      lastName: sufijo,
      position: "Peoneta",
      worksiteId: worksites[index]!,
    })))
    return ids
  }

  async function nuevoCargo(sufijo: string, extra: Partial<Parameters<typeof createWorkerPosition>[0]> = {}) {
    return createWorkerPosition({ code: `BULK-${sufijo}`.toUpperCase(), name: `Cargo masivo ${sufijo}`, ...extra })
  }

  const asignar = (workerIds: string[], positionId: string, extra: Partial<Parameters<typeof bulkAssignWorkerPosition>[0]> = {}) =>
    bulkAssignWorkerPosition({
      workerIds, positionId, reason: "Clasificación de prueba",
      actorUserId: ACTOR, actorEmail: ACTOR_EMAIL, source: "admin", ...extra,
    })

  const trabajador = (id: string) => inMemoryDb.query.workers.findFirst({ where: (w, { eq: equals }) => equals(w.id, id) })
  const historial = (ids: string[]) => inMemoryDb.select().from(schema.workerPositionHistory)
    .where(inArray(schema.workerPositionHistory.workerId, ids))
  const auditoria = (ids: string[]) => inMemoryDb.select().from(schema.auditLog)
    .where(and(eq(schema.auditLog.entityType, "worker"), inArray(schema.auditLog.entityId, ids)))

  it("cambia el cargo de todos —columna canónica y texto legado— y los informa en el orden recibido", async () => {
    const ids = await sembrar("a")
    const cargo = await nuevoCargo("a")

    const result = await asignar([ids[2]!, ids[0]!, ids[1]!], cargo.id)

    expect(result).toEqual({ changed: [ids[2], ids[0], ids[1]], unchanged: [] })
    for (const id of ids) {
      const row = await trabajador(id)
      expect(row?.positionId).toBe(cargo.id)
      // El texto legado también se mueve: es el que todavía leen los informes viejos.
      expect(row?.position).toBe(cargo.name)
    }
  })

  it("deja una fila de historial por trabajador, con el cargo anterior, el origen y el motivo", async () => {
    const ids = await sembrar("b")
    const cargo = await nuevoCargo("b")

    await asignar(ids, cargo.id, { reason: "  Según la planilla  " })

    const rows = await historial(ids)
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row).toMatchObject({
        previousPositionId: null,
        previousPositionLabel: "Peoneta",
        nextPositionId: cargo.id,
        nextPositionLabel: cargo.name,
        source: "admin",
        reason: "Según la planilla",
        changedByUserId: ACTOR,
      })
    }
    expect(rows.map((row) => row.workerId).sort()).toEqual([...ids].sort())
  })

  it("audita a cada trabajador con el cargo de antes y de después, su faena y quién lo hizo", async () => {
    const ids = await sembrar("c", [WS_A, WS_B])
    const cargo = await nuevoCargo("c")

    await asignar(ids, cargo.id)

    const rows = await auditoria(ids)
    expect(rows).toHaveLength(2)
    const first = rows.find((row) => row.entityId === ids[0])!
    expect(first).toMatchObject({
      action: "update",
      userId: ACTOR,
      userEmail: ACTOR_EMAIL,
      worksiteId: WS_A,
      reason: "Clasificación de prueba",
    })
    expect(JSON.parse(first.oldState!)).toEqual({ position: "Peoneta" })
    expect(JSON.parse(first.newState!)).toEqual({ position: cargo.name })
    // La faena del hecho es la de cada trabajador, no la de quien opera.
    expect(rows.find((row) => row.entityId === ids[1])?.worksiteId).toBe(WS_B)
  })

  it("registra el origen import cuando lo pide el script de carga", async () => {
    const ids = await sembrar("d", [WS_A])
    const cargo = await nuevoCargo("d")

    await asignar(ids, cargo.id, { source: "import", actorEmail: null })

    expect((await historial(ids))[0]).toMatchObject({ source: "import" })
    expect((await auditoria(ids))[0]?.userEmail).toBeNull()
  })

  it("es idempotente: repetir el lote no cambia nada ni deja más historial ni auditoría", async () => {
    const ids = await sembrar("e")
    const cargo = await nuevoCargo("e")
    await asignar(ids, cargo.id)
    const historialAntes = (await historial(ids)).length
    const auditoriaAntes = (await auditoria(ids)).length

    const again = await asignar(ids, cargo.id)

    expect(again).toEqual({ changed: [], unchanged: ids })
    expect((await historial(ids)).length).toBe(historialAntes)
    expect((await auditoria(ids)).length).toBe(auditoriaAntes)
  })

  it("separa a quien ya tenía el cargo y sólo registra a los que cambiaron", async () => {
    const ids = await sembrar("f")
    const cargo = await nuevoCargo("f")
    await asignar([ids[1]!], cargo.id)

    const result = await asignar(ids, cargo.id)

    expect(result.changed).toEqual([ids[0], ids[2]])
    expect(result.unchanged).toEqual([ids[1]])
    // Una fila por cambio real: la del primero, más las dos de ahora.
    expect(await historial(ids)).toHaveLength(3)
  })

  it("ignora los ids repetidos y los vacíos", async () => {
    const ids = await sembrar("g", [WS_A])
    const cargo = await nuevoCargo("g")

    const result = await asignar([ids[0]!, ` ${ids[0]} `, ""], cargo.id)

    expect(result.changed).toEqual([ids[0]])
    expect(await historial(ids)).toHaveLength(1)
  })

  it("reclasificar de un cargo a otro conserva el cargo anterior en el historial", async () => {
    const ids = await sembrar("h", [WS_A])
    const antes = await nuevoCargo("h-antes")
    const despues = await nuevoCargo("h-despues")
    await asignar(ids, antes.id)

    await asignar(ids, despues.id)

    const rows = (await historial(ids)).sort((left, right) => left.changedAt.localeCompare(right.changedAt))
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({
      previousPositionId: antes.id,
      previousPositionLabel: antes.name,
      nextPositionId: despues.id,
    })
  })

  describe("alcance de faena", () => {
    it("si alguno queda fuera, no clasifica a nadie: ni cargo, ni historial, ni auditoría", async () => {
      const ids = await sembrar("alcance", [WS_A, WS_A, WS_B])
      const cargo = await nuevoCargo("alcance")

      await expect(asignar(ids, cargo.id, { canAccessWorksite: (worksiteId) => worksiteId === WS_A }))
        .rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("1 de los trabajadores") })

      for (const id of ids) expect((await trabajador(id))?.positionId).toBeNull()
      expect(await historial(ids)).toHaveLength(0)
      expect(await auditoria(ids)).toHaveLength(0)
    })

    it("con todos dentro del alcance clasifica normalmente", async () => {
      const ids = await sembrar("alcance-ok", [WS_A, WS_B])
      const cargo = await nuevoCargo("alcance-ok")

      const result = await asignar(ids, cargo.id, { canAccessWorksite: () => true })

      expect(result.changed).toEqual(ids)
    })

    it("un alcance que no deja pasar a nadie rechaza el lote entero", async () => {
      const ids = await sembrar("alcance-nada", [WS_A])
      const cargo = await nuevoCargo("alcance-nada")

      await expect(asignar(ids, cargo.id, { canAccessWorksite: () => false }))
        .rejects.toMatchObject({ code: "FORBIDDEN" })
      expect((await trabajador(ids[0]!))?.positionId).toBeNull()
    })
  })

  describe("entradas que no corresponden", () => {
    it("rechaza un cargo inactivo, uno inexistente y una lista vacía", async () => {
      const ids = await sembrar("malas", [WS_A])
      const inactivo = await nuevoCargo("inactivo", { isActive: false })

      await expect(asignar(ids, inactivo.id)).rejects.toMatchObject({ code: "INACTIVE" })
      await expect(asignar(ids, "worker-position-no-existe")).rejects.toMatchObject({ code: "NOT_FOUND" })
      await expect(asignar([], inactivo.id)).rejects.toMatchObject({ code: "INVALID_INPUT" })
      await expect(asignar(["", "  "], inactivo.id)).rejects.toMatchObject({ code: "INVALID_INPUT" })

      expect((await trabajador(ids[0]!))?.positionId).toBeNull()
    })

    it("si un trabajador no existe, no clasifica a los demás", async () => {
      const ids = await sembrar("fantasma", [WS_A, WS_A])
      const cargo = await nuevoCargo("fantasma")

      await expect(asignar([...ids, "worker-que-no-existe"], cargo.id))
        .rejects.toMatchObject({ code: "NOT_FOUND" })

      for (const id of ids) expect((await trabajador(id))?.positionId).toBeNull()
      expect(await historial(ids)).toHaveLength(0)
    })

    it("pone un tope por operación", async () => {
      const cargo = await nuevoCargo("tope")
      const demasiados = Array.from({ length: BULK_ASSIGN_WORKER_POSITION_LIMIT + 1 }, (_, index) => `w-tope-${index}`)

      await expect(asignar(demasiados, cargo.id)).rejects.toMatchObject({ code: "INVALID_INPUT" })
    })
  })

  it("compone con la transacción del llamador: si ésta se deshace, el lote también", async () => {
    const ids = await sembrar("tx", [WS_A, WS_A])
    const cargo = await nuevoCargo("tx")

    await expect(inMemoryDb.transaction(async (tx) => {
      await bulkAssignWorkerPosition({
        workerIds: ids, positionId: cargo.id, reason: "dentro de una transacción mayor",
        actorUserId: ACTOR, source: "import",
        // PGlite es compatible en runtime; sólo difiere el HKT del driver.
      }, tx as never)
      throw new Error("falla posterior del script")
    })).rejects.toThrow("falla posterior del script")

    for (const id of ids) expect((await trabajador(id))?.positionId).toBeNull()
    expect(await historial(ids)).toHaveLength(0)
    expect(await auditoria(ids)).toHaveLength(0)
  })
})
