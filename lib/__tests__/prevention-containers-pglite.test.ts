import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

import {
  createContainer,
  deleteContainer,
  getContainerDetail,
  listContainers,
  listContainersForWorksite,
  updateContainer,
} from "@/lib/services/prevention-containers"

const worksiteId = "ws-containers"
const otherWorksiteId = "ws-containers-otra"
const userId = "user-containers"

const access = {
  userId,
  permissions: ["admin:containers"],
  scope: [worksiteId, otherWorksiteId],
} as const
/** Alcance acotado a una sola faena: la otra debe comportarse como inexistente. */
const narrowAccess = { userId, permissions: ["admin:containers"], scope: [worksiteId] } as const
const noPermissionAccess = { userId, permissions: [], scope: "all" } as const

describe("catálogo de contenedores", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    const now = new Date().toISOString()
    await testDb.insert(schema.users).values({
      id: userId,
      name: "Prevencionista",
      email: "containers@chome.cl",
      hashedPassword: "hash",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    await testDb.insert(schema.worksites).values([
      { id: worksiteId, name: "Faena Contenedores", code: "CONT", isActive: true, createdAt: now, updatedAt: now },
      { id: otherWorksiteId, name: "Faena Destino", code: "CONT2", isActive: true, createdAt: now, updatedAt: now },
    ])
  })

  afterAll(async () => pg.close())

  it("da de alta un contenedor y lo lista con su conteo de inspecciones en cero", async () => {
    const created = await createContainer(
      { worksiteId, code: "CT-001", location: "Acopio norte" },
      access,
    )
    expect(created.code).toBe("CT-001")
    expect(created.status).toBe("operational")
    expect(created.version).toBe(1)

    const rows = await listContainers(access)
    const row = rows.find((item) => item.container.id === created.id)
    expect(row?.worksiteName).toBe("Faena Contenedores")
    expect(row?.inspectionCount).toBe(0)
  })

  it("rechaza el alta en una faena fuera de alcance sin revelar si existe", async () => {
    await expect(
      createContainer({ worksiteId: otherWorksiteId, code: "CT-002", location: "Portería" }, narrowAccess),
    ).rejects.toThrow(/no encontrado o fuera de alcance/i)
  })

  it("rechaza a quien no tiene el permiso del catálogo", async () => {
    await expect(
      createContainer({ worksiteId, code: "CT-003", location: "Taller" }, noPermissionAccess),
    ).rejects.toThrow(/no encontrado o fuera de alcance/i)
    await expect(listContainers(noPermissionAccess)).rejects.toThrow(/no encontrado o fuera de alcance/i)
  })

  it("impide dos fichas con el mismo código, porque el código es la identidad del activo", async () => {
    await createContainer({ worksiteId, code: "CT-010", location: "Patio" }, access)
    await expect(
      createContainer({ worksiteId: otherWorksiteId, code: "CT-010", location: "Otro patio" }, access),
    ).rejects.toThrow(/ya existe un contenedor con el código/i)
  })

  it("edita con bloqueo optimista: una versión desfasada no pisa el cambio ajeno", async () => {
    const created = await createContainer({ worksiteId, code: "CT-020", location: "Acopio sur" }, access)

    const updated = await updateContainer(
      { containerId: created.id, expectedVersion: created.version, location: "Acopio sur (movido)", status: "observed" },
      access,
    )
    expect(updated.location).toBe("Acopio sur (movido)")
    expect(updated.status).toBe("observed")
    expect(updated.version).toBe(created.version + 1)

    await expect(
      updateContainer({ containerId: created.id, expectedVersion: created.version, location: "Tarde" }, access),
    ).rejects.toThrow(/cambió en otra sesión/i)
  })

  it("traslada el contenedor de faena y deja el movimiento en la auditoría", async () => {
    const created = await createContainer({ worksiteId, code: "CT-030", location: "Acopio" }, access)

    const moved = await updateContainer(
      { containerId: created.id, expectedVersion: created.version, worksiteId: otherWorksiteId },
      access,
    )
    expect(moved.worksiteId).toBe(otherWorksiteId)

    const audits = await testDb.select().from(schema.auditLog).where(and(
      eq(schema.auditLog.entityType, "prevention_container"),
      eq(schema.auditLog.entityId, created.id),
    ))
    const move = audits.find((entry) => entry.reason?.includes("Faena Destino"))
    expect(move).toBeTruthy()
    expect(move?.action).toBe("update")

    // El traslado no puede llevarse el contenedor a una faena fuera de alcance.
    await expect(
      updateContainer({ containerId: created.id, expectedVersion: moved.version, worksiteId: "ws-inexistente" }, access),
    ).rejects.toThrow()
  })

  it("lista para una faena sólo los contenedores activos de esa faena", async () => {
    const activo = await createContainer({ worksiteId, code: "CT-040", location: "Rampa" }, access)
    const retirado = await createContainer({ worksiteId, code: "CT-041", location: "Rampa" }, access)
    await updateContainer(
      { containerId: retirado.id, expectedVersion: retirado.version, isActive: false, status: "out_of_service" },
      access,
    )

    const options = await listContainersForWorksite(worksiteId)
    const ids = options.map((item) => item.id)
    expect(ids).toContain(activo.id)
    expect(ids).not.toContain(retirado.id)
  })

  it("no borra un contenedor al que apunta una programación, ni lo traslada de faena", async () => {
    const created = await createContainer({ worksiteId, code: "CT-070", location: "Rampa norte" }, access)
    const now = new Date().toISOString()

    await testDb.insert(schema.preventionInspectionTemplates).values({
      id: "tpl-cont-programa",
      code: "inspeccion_contenedores_prog",
      versionLabel: "03",
      name: "Inspección de Contenedores",
      kind: "inspection",
      sourceDefinitionCode: "inspeccion_contenedores",
      definitionSnapshot: {},
      contentHash: "d".repeat(64),
      status: "approved",
      authorUserId: userId,
      approvedByUserId: userId,
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    await testDb.insert(schema.preventionInspectionPrograms).values({
      id: "insprog-contenedor",
      templateId: "tpl-cont-programa",
      worksiteId,
      frequency: "monthly",
      intervalDays: 30,
      nextDueOn: "2026-03-01",
      subjectType: "contenedor",
      subjectContainerId: created.id,
      isActive: true,
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    })

    // La FK es ON DELETE SET NULL: sin esta guarda el programa quedaría sin
    // sujeto y generaría inspecciones de contenedor sin contenedor.
    await expect(deleteContainer({ containerId: created.id }, access))
      .rejects.toThrow(/programación de inspecciones/i)

    // Y trasladarlo lo dejaría en otra faena que la del programa: el barrido
    // fallaría en silencio en vez de generar la inspección.
    const fresh = await getContainerDetail(created.id, access)
    await expect(updateContainer(
      { containerId: created.id, expectedVersion: fresh.container.version, worksiteId: otherWorksiteId },
      access,
    )).rejects.toThrow(/programación de inspecciones activa/i)
  })

  it("borra una ficha nunca inspeccionada", async () => {
    const created = await createContainer({ worksiteId, code: "CT-050", location: "Bodega" }, access)
    await expect(deleteContainer({ containerId: created.id }, access)).resolves.toEqual({ deleted: true })
    await expect(getContainerDetail(created.id, access)).rejects.toThrow(/no encontrado o fuera de alcance/i)
  })

  it("no borra una ficha que ya sostiene evidencia y la muestra en su historial", async () => {
    const created = await createContainer({ worksiteId, code: "CT-060", location: "Acopio central" }, access)
    const now = new Date().toISOString()

    await testDb.insert(schema.preventionInspectionTemplates).values({
      id: "tpl-contenedores",
      code: "inspeccion_contenedores",
      versionLabel: "03",
      name: "Inspección de Contenedores",
      kind: "inspection",
      sourceDefinitionCode: "inspeccion_contenedores",
      definitionSnapshot: {},
      contentHash: "c".repeat(64),
      status: "approved",
      authorUserId: userId,
      approvedByUserId: userId,
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    await testDb.insert(schema.preventionInspectionRuns).values({
      id: "insrun-contenedor",
      code: "INSP-2026-CONT",
      templateId: "tpl-contenedores",
      worksiteId,
      subjectType: "contenedor",
      subjectLabel: "CT-060 · Acopio central",
      subjectContainerId: created.id,
      status: "completed",
      executedAt: now,
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    })

    await expect(deleteContainer({ containerId: created.id }, access))
      .rejects.toThrow(/ya fue inspeccionado/i)

    const detail = await getContainerDetail(created.id, access)
    expect(detail.inspections).toHaveLength(1)
    expect(detail.inspections[0]?.code).toBe("INSP-2026-CONT")

    const rows = await listContainers(access)
    expect(rows.find((item) => item.container.id === created.id)?.inspectionCount).toBe(1)
    // El listado suma runs + PDTP; la ficha tiene que poder explicar la resta.
  })
})
