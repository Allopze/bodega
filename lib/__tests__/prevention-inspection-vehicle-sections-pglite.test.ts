/**
 * Secciones que no aplican al equipo, horómetro y firmas del papel (Reporte de
 * Equipos v03) a través del servicio real: la lectura del run, el cierre y el
 * tipo del equipo que sale del catálogo (`fuel_equipment_types.slug`).
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
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

import {
  completeInspectionRun,
  createInspectionRun,
  getInspectionRunDetail,
  saveInspectionAnswers,
} from "@/lib/services/prevention-inspections"
import { getRunVehicleType } from "@/lib/services/prevention-inspections/run-vehicle"

const worksiteId = "ws-veh-sections"
const userId = "user-veh-sections"
const TEMPLATE = "tpl-veh-sections"
const access = {
  userId,
  scope: { mode: "some", ids: [worksiteId] } as WorksiteScope,
  permissions: ["prevention:inspections:view", "prevention:inspections:execute", "prevention:inspections:manage"],
}

/** Una versión mínima del Reporte de Equipos v03: lo que importa son los campos nuevos. */
const SNAPSHOT = {
  code: "reporte_equipos", version: "03", revisionDate: "2026-11-17", tipo: "seguimiento", title: "Reporte de Equipos",
  legalFramework: [], applicableTo: "x",
  closingAct: {
    title: "Cierre", resultOptions: [{ value: "operativo", label: "Operativo" }],
    signatureRoles: ["operador_entrante", "operador_saliente", "supervisor_turno"],
    allowMissingSignatures: true,
  },
  sections: [
    { id: "horometro", title: "Horómetro", countsForCompliance: false, items: [
      { id: "horometro_inicio", label: "Horómetro inicio.", kind: "number", required: true },
      { id: "horometro_termino", label: "Horómetro término.", kind: "number", notLessThanItemId: "horometro_inicio" },
    ] },
    { id: "estado_camion", title: "Estado", countsForCompliance: true, items: [
      { id: "luces", label: "Luces.", kind: "cumple_nocumple_na_obs" },
    ] },
    { id: "exclusivo_carga", title: "Exclusivo carga", countsForCompliance: true, appliesToVehicleTypes: ["cargador", "excavadora"], items: [
      { id: "estado_balde", label: "Estado balde.", kind: "cumple_nocumple_na_obs" },
    ] },
  ],
}

const luces = { sectionId: "estado_camion", itemId: "luces", result: "conforming" as const }
const inicio = (value: string) => ({ sectionId: "horometro", itemId: "horometro_inicio", result: "recorded" as const, value })
const termino = (value: string) => ({ sectionId: "horometro", itemId: "horometro_termino", result: "recorded" as const, value })
const balde = { sectionId: "exclusivo_carga", itemId: "estado_balde", result: "conforming" as const }

async function newRun(vehicleId: string | null) {
  const { run } = await createInspectionRun({ templateId: TEMPLATE, worksiteId, subjectVehicleId: vehicleId }, access)
  return run
}
async function saved(runId: string, answers: unknown[]) {
  const detail = await getInspectionRunDetail(runId, access)
  return (await saveInspectionAnswers({ runId, expectedVersion: detail!.run.version, answers }, access)).version
}
const closingAct = (signatures: { role: string; name: string }[]) => ({ result: "operativo", signatures })

describe("v03 a través del servicio", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    const now = new Date().toISOString()
    await testDb.insert(schema.users).values({
      id: userId, name: "Jefe de faena", email: "veh-sections@chome.cl", hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now,
    })
    await testDb.insert(schema.worksites).values({ id: worksiteId, name: "Faena Equipos", code: "VSEC", isActive: true, createdAt: now, updatedAt: now })
    await testDb.insert(schema.preventionInspectionTemplates).values({
      id: TEMPLATE, code: "reporte_equipos", versionLabel: "03", name: "Reporte de Equipos", kind: "inspection",
      sourceDefinitionCode: "reporte_equipos", definitionSnapshot: SNAPSHOT,
      contentHash: "v".repeat(64), status: "approved",
      authorUserId: userId, approvedByUserId: userId, approvedAt: now, createdAt: now, updatedAt: now,
    })
    await testDb.insert(schema.fuelEquipmentTypes).values([
      { id: "fet-vs-grua", slug: "grua_horquilla", name: "Grúa horquilla", category: "heavy" },
      { id: "fet-vs-legacy", slug: "legacy-abc123", name: "Raro", category: "other" },
    ]).onConflictDoNothing()
    const vehicle = (id: string, plate: string, typeId: string, legacyType: string) => ({
      id, plate, code: id, type: legacyType, equipmentTypeId: typeId, worksiteId,
    })
    await testDb.insert(schema.fuelVehicles).values([
      vehicle("veh-grua", "GRUA-01", "fet-vs-grua", "grua horquilla"),
      vehicle("veh-cargador", "CARG-01", "fet-cargador", "cargador"),
      vehicle("veh-legacy", "LEG-01", "fet-vs-legacy", "algo raro"),
    ])
  })

  afterAll(async () => pg.close())

  it("el tipo sale del catálogo; un tipo heredado o la falta de equipo son «desconocido»", async () => {
    expect(await getRunVehicleType(testDb, "veh-grua")).toBe("grua_horquilla")
    expect(await getRunVehicleType(testDb, "veh-cargador")).toBe("cargador")
    expect(await getRunVehicleType(testDb, "veh-legacy")).toBeNull()
    expect(await getRunVehicleType(testDb, null)).toBeNull()
    expect(await getRunVehicleType(testDb, "no-existe")).toBeNull()
  })

  it("el detalle del run omite la sección que no corresponde al equipo", async () => {
    const sectionsOf = async (vehicleId: string | null) => {
      const run = await newRun(vehicleId)
      const detail = await getInspectionRunDetail(run.id, access)
      return {
        ids: (detail!.definitionSnapshot as unknown as typeof SNAPSHOT).sections.map((section) => section.id),
        type: detail!.subjectVehicleType,
      }
    }
    expect(await sectionsOf("veh-grua")).toEqual({ ids: ["horometro", "estado_camion"], type: "grua_horquilla" })
    expect((await sectionsOf("veh-cargador")).ids).toEqual(["horometro", "estado_camion", "exclusivo_carga"])
    // Sin equipo y con tipo heredado: todo, como en la v02.
    expect((await sectionsOf(null)).ids).toHaveLength(3)
    expect((await sectionsOf("veh-legacy")).ids).toHaveLength(3)
  })

  it("una grúa se declara ejecutada sin la sección de carga; un cargador la exige", async () => {
    const grua = await newRun("veh-grua")
    const gruaVersion = await saved(grua.id, [luces, inicio("1000")])
    const done = await completeInspectionRun({ runId: grua.id, expectedVersion: gruaVersion, closingAct: closingAct([]) }, access)
    expect(done).toMatchObject({ compliancePercent: 100 })

    const cargador = await newRun("veh-cargador")
    const version = await saved(cargador.id, [luces, inicio("1000")])
    await expect(completeInspectionRun({ runId: cargador.id, expectedVersion: version, closingAct: closingAct([]) }, access))
      .rejects.toThrow(/Estado balde/)
    const version2 = await saved(cargador.id, [luces, inicio("1000"), balde])
    await expect(completeInspectionRun({ runId: cargador.id, expectedVersion: version2, closingAct: closingAct([]) }, access))
      .resolves.toBeDefined()
  })

  it("una respuesta de una sección que no aplica no puntúa ni levanta hallazgo", async () => {
    const grua = await newRun("veh-grua")
    // Guardar tolera la fila (puede venir de la planilla leída o de una cola sin conexión)…
    const version = await saved(grua.id, [luces, inicio("1000"), { ...balde, result: "non_conforming", comment: "roto" }])
    const done = await completeInspectionRun({ runId: grua.id, expectedVersion: version, closingAct: closingAct([]) }, access)
    // …pero el cierre la deja fuera: 1 de 1, sin hallazgos.
    expect(done).toMatchObject({ compliancePercent: 100, findings: 0 })
  })

  it("bloquea el cierre con el horómetro de término menor que el de inicio, con coma decimal", async () => {
    const run = await newRun("veh-cargador")
    const version = await saved(run.id, [luces, balde, inicio("1000,5"), termino("1000,4")])
    await expect(completeInspectionRun({ runId: run.id, expectedVersion: version, closingAct: closingAct([]) }, access))
      .rejects.toThrow(/El horómetro término \(1000,4\) es menor que el horómetro inicio \(1000,5\)/)
    const fixed = await saved(run.id, [luces, balde, inicio("1000,5"), termino("1000,5")])
    await expect(completeInspectionRun({ runId: run.id, expectedVersion: fixed, closingAct: closingAct([]) }, access))
      .resolves.toBeDefined()
  })

  it("con `allowMissingSignatures` acepta una sola firma; la presente se guarda con su nombre", async () => {
    const run = await newRun("veh-grua")
    const version = await saved(run.id, [luces, inicio("1000")])
    await completeInspectionRun({
      runId: run.id, expectedVersion: version,
      closingAct: closingAct([{ role: "operador_entrante", name: "Ana Soto" }]),
    }, access)
    const detail = await getInspectionRunDetail(run.id, access)
    expect(detail!.run.closingSignatures).toEqual([expect.objectContaining({ role: "operador_entrante", name: "Ana Soto" })])
  })

  it("sin el campo (plantilla v02) el cierre sigue exigiendo las tres firmas", async () => {
    const now = new Date().toISOString()
    const v02 = {
      ...SNAPSHOT, version: "02",
      closingAct: { ...SNAPSHOT.closingAct, allowMissingSignatures: undefined },
    }
    await testDb.insert(schema.preventionInspectionTemplates).values({
      id: "tpl-veh-sections-v02", code: "reporte_equipos_v02", versionLabel: "02", name: "Reporte de Equipos", kind: "inspection",
      sourceDefinitionCode: "reporte_equipos", definitionSnapshot: JSON.parse(JSON.stringify(v02)),
      contentHash: "w".repeat(64), status: "approved",
      authorUserId: userId, approvedByUserId: userId, approvedAt: now, createdAt: now, updatedAt: now,
    })
    const { run } = await createInspectionRun({ templateId: "tpl-veh-sections-v02", worksiteId, subjectVehicleId: "veh-grua" }, access)
    const version = await saved(run.id, [luces, inicio("1000")])
    await expect(completeInspectionRun({
      runId: run.id, expectedVersion: version,
      closingAct: closingAct([{ role: "operador_entrante", name: "Ana Soto" }]),
    }, access)).rejects.toThrow(/Faltan firmas del acta: Operador saliente, Supervisor turno/)
  })
})
