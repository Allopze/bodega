import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

import { createContainer } from "@/lib/services/prevention-containers"
import {
  createInspectionProgram,
  createInspectionRun,
  listInspectionSubjects,
  resolveSubject,
  updateInspectionProgram,
} from "@/lib/services/prevention-inspections"
import { updateContainer } from "@/lib/services/prevention-containers"
import { materializeProgramRuns } from "@/lib/services/prevention-inspection-scheduler"

const worksiteId = "ws-cont-subject"
const otherWorksiteId = "ws-cont-subject-b"
const userId = "user-cont-subject"

const scope = { mode: "some", ids: [worksiteId, otherWorksiteId] } as WorksiteScope
const access = {
  userId,
  scope,
  permissions: [
    "prevention:inspections:view",
    "prevention:inspections:manage",
    "prevention:inspections:execute",
  ],
}
const adminAccess = { userId, permissions: ["admin:containers"], scope: [worksiteId, otherWorksiteId] } as const

const CONTAINER_TEMPLATE = "tpl-cont-subject"
const OTHER_TEMPLATE = "tpl-otra"

async function seedTemplate(id: string, definitionCode: string | null) {
  const now = new Date().toISOString()
  await testDb.insert(schema.preventionInspectionTemplates).values({
    id,
    code: definitionCode ?? id,
    versionLabel: "01",
    name: definitionCode === "inspeccion_contenedores" ? "Inspección de Contenedores" : "Otra inspección",
    kind: "inspection",
    sourceDefinitionCode: definitionCode,
    definitionSnapshot: {},
    contentHash: id.padEnd(64, "0").slice(0, 64),
    status: "approved",
    authorUserId: userId,
    approvedByUserId: userId,
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  })
}

describe("contenedor como sujeto de inspección", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    const now = new Date().toISOString()
    await testDb.insert(schema.users).values({
      id: userId,
      name: "Prevencionista",
      email: "cont-subject@chome.cl",
      hashedPassword: "hash",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    await testDb.insert(schema.worksites).values([
      { id: worksiteId, name: "Faena Contenedores", code: "CSUB", isActive: true, createdAt: now, updatedAt: now },
      { id: otherWorksiteId, name: "Faena Vecina", code: "CSUB2", isActive: true, createdAt: now, updatedAt: now },
    ])
    await seedTemplate(CONTAINER_TEMPLATE, "inspeccion_contenedores")
    await seedTemplate(OTHER_TEMPLATE, "inspeccion_epp")
  })

  afterAll(async () => pg.close())

  it("ofrece los contenedores de la faena como sujetos inspeccionables", async () => {
    const container = await createContainer({ worksiteId, code: "CS-001", location: "Acopio" }, adminAccess)
    const subjects = await listInspectionSubjects(worksiteId, access)
    const option = subjects.find((item) => item.id === container.id)
    expect(option?.source).toBe("container")
    expect(option?.name).toBe("CS-001 · Acopio")
  })

  it("resuelve la etiqueta del contenedor y rechaza uno de otra faena", async () => {
    const container = await createContainer({ worksiteId, code: "CS-002", location: "Portería" }, adminAccess)
    await expect(resolveSubject(testDb, { worksiteId, subjectContainerId: container.id }))
      .resolves.toBe("CS-002 · Portería")
    await expect(resolveSubject(testDb, { worksiteId: otherWorksiteId, subjectContainerId: container.id }))
      .rejects.toThrow(/otra faena/i)
  })

  it("no admite dos sujetos tipados a la vez", async () => {
    const container = await createContainer({ worksiteId, code: "CS-003", location: "Rampa" }, adminAccess)
    await expect(resolveSubject(testDb, {
      worksiteId,
      subjectContainerId: container.id,
      subjectResourceId: "cualquier-recurso",
    })).rejects.toThrow(/un solo sujeto/i)
  })

  it("exige contenedor del catálogo en la inspección de contenedores", async () => {
    await expect(createInspectionRun({
      templateId: CONTAINER_TEMPLATE,
      worksiteId,
      subjectLabel: "Contenedor RESPEL N°2",
    }, access)).rejects.toThrow(/contenedor del catálogo/i)

    const container = await createContainer({ worksiteId, code: "CS-010", location: "Acopio central" }, adminAccess)
    const { run } = await createInspectionRun({
      templateId: CONTAINER_TEMPLATE,
      worksiteId,
      subjectContainerId: container.id,
      // La etiqueta libre que venga se ignora: manda el catálogo.
      subjectLabel: "lo que sea",
    }, access)
    expect(run.subjectContainerId).toBe(container.id)
    expect(run.subjectLabel).toBe("CS-010 · Acopio central")
    expect(run.subjectType).toBe("contenedor")
  })

  it("no le impone el catálogo a las demás plantillas", async () => {
    const { run } = await createInspectionRun({
      templateId: OTHER_TEMPLATE,
      worksiteId,
      subjectLabel: "Cuadrilla forestal",
    }, access)
    expect(run.subjectContainerId).toBeNull()
    expect(run.subjectLabel).toBe("Cuadrilla forestal")
  })

  it("propaga el contenedor del programa al run que materializa el cron", async () => {
    const container = await createContainer({ worksiteId, code: "CS-020", location: "Patio norte" }, adminAccess)
    const program = await createInspectionProgram({
      templateId: CONTAINER_TEMPLATE,
      worksiteId,
      frequency: "monthly",
      startsOn: "2026-01-01",
      subjectContainerId: container.id,
    }, access)
    expect(program.subjectContainerId).toBe(container.id)

    await materializeProgramRuns({ programId: program.id })

    const [run] = await testDb.select().from(schema.preventionInspectionRuns)
      .where(eq(schema.preventionInspectionRuns.programId, program.id))
    expect(run?.subjectContainerId).toBe(container.id)
    expect(run?.subjectLabel).toBe("CS-020 · Patio norte")
  })

  it("deja detener una programación heredada que nunca tuvo contenedor", async () => {
    const now = new Date().toISOString()
    /* Anterior al catálogo: `subject_container_id` nulo. Exigir sujeto en toda
     * edición la dejaba imposible de detener mientras el cron la seguía
     * ejecutando. */
    await testDb.insert(schema.preventionInspectionPrograms).values({
      id: "insprog-heredado",
      templateId: CONTAINER_TEMPLATE,
      worksiteId,
      frequency: "monthly",
      intervalDays: 30,
      nextDueOn: "2026-01-01",
      subjectType: "contenedor",
      isActive: true,
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    })

    const stopped = await updateInspectionProgram({
      programId: "insprog-heredado",
      expectedVersion: 1,
      isActive: false,
      reason: "Se detiene mientras se carga el catálogo de contenedores.",
    }, access)
    expect(stopped.isActive).toBe(false)

    // Pero elegir explícitamente "sin contenedor" sigue rechazado.
    await expect(updateInspectionProgram({
      programId: "insprog-heredado",
      expectedVersion: stopped.version,
      subjectContainerId: null,
    }, access)).rejects.toThrow(/contenedor del catálogo/i)
  })

  it("no admite un contenedor retirado como sujeto de trabajo nuevo", async () => {
    const container = await createContainer({ worksiteId, code: "CS-030", location: "Patio sur" }, adminAccess)
    await updateContainer(
      { containerId: container.id, expectedVersion: container.version, isActive: false, status: "out_of_service" },
      adminAccess,
    )

    await expect(createInspectionRun({
      templateId: CONTAINER_TEMPLATE,
      worksiteId,
      subjectContainerId: container.id,
    }, access)).rejects.toThrow(/retirado del catálogo/i)

    // Resolver la etiqueta sigue funcionando: el cron materializa programas ya
    // existentes y hacerlo fallar los detendría en silencio.
    await expect(resolveSubject(testDb, { worksiteId, subjectContainerId: container.id }))
      .resolves.toBe("CS-030 · Patio sur")
  })

  it("exige contenedor también al programar la inspección de contenedores", async () => {
    await expect(createInspectionProgram({
      templateId: CONTAINER_TEMPLATE,
      worksiteId,
      frequency: "monthly",
      startsOn: "2026-02-01",
    }, access)).rejects.toThrow(/contenedor del catálogo/i)
  })
})
