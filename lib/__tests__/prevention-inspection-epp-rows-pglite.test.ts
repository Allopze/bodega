import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { INSPECCION_EPP } from "@/lib/sst/definitions/inspeccion-epp"
import { EPP_USE_SECTION_ID } from "@/lib/sst/definitions/inspeccion-epp-sections"
import { eppRowId } from "@/lib/prevention/epp-inspection-rows"
import type { ChecklistDefinition } from "@/lib/sst/types"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

import { listWorksiteEppRows } from "@/lib/services/prevention-inspections/epp-rows"
import {
  createInspectionRun,
  getInspectionRunDetail,
  saveInspectionAnswers,
} from "@/lib/services/prevention-inspections"

const worksiteId = "ws-epp-rows"
const otherWorksiteId = "ws-epp-rows-b"
const emptyWorksiteId = "ws-epp-rows-vacia"
const userId = "user-epp-rows"
const TEMPLATE = "tpl-epp-rows"

const access = {
  userId,
  scope: { mode: "some", ids: [worksiteId, otherWorksiteId, emptyWorksiteId] } as WorksiteScope,
  permissions: [
    "prevention:inspections:view",
    "prevention:inspections:manage",
    "prevention:inspections:execute",
  ],
}

function matrixIds(definition: unknown) {
  return (definition as ChecklistDefinition).sections
    .find((section) => section.id === EPP_USE_SECTION_ID)!.items.map((item) => item.id)
}

describe("inspección de uso de EPP con filas de la bodega de la faena", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    const now = new Date().toISOString()
    await testDb.insert(schema.users).values({
      id: userId, name: "Prevencionista", email: "epp-rows@chome.cl", hashedPassword: "hash",
      isActive: true, createdAt: now, updatedAt: now,
    })
    await testDb.insert(schema.worksites).values([
      { id: worksiteId, name: "Faena EPP", code: "EPPR", isActive: true, createdAt: now, updatedAt: now },
      { id: otherWorksiteId, name: "Faena Vecina", code: "EPPR2", isActive: true, createdAt: now, updatedAt: now },
      { id: emptyWorksiteId, name: "Faena Nueva", code: "EPPR3", isActive: true, createdAt: now, updatedAt: now },
    ])
    await testDb.insert(schema.productCategories).values([
      { id: "cat-epp-rows", name: "EPP", slug: "epp-rows", isEpp: true },
      { id: "cat-ins-rows", name: "Insumos", slug: "insumos-rows", isEpp: false },
    ])
    const [cabeza] = await testDb.select().from(schema.eppTypes)
      .where(eq(schema.eppTypes.code, "cabeza")).limit(1)
    await testDb.insert(schema.eppProductFamilies).values({
      id: "fam-casco", categoryId: "cat-epp-rows", canonicalName: "Casco de seguridad", identityKey: "casco-rows",
      eppTypeId: cabeza?.id ?? null,
    })
    await testDb.insert(schema.products).values([
      // Dos tallas de la misma familia: una sola fila.
      { id: "prd-casco-m", sku: "CAS-M", name: "Casco M", categoryId: "cat-epp-rows", familyId: "fam-casco", isEpp: true },
      { id: "prd-casco-l", sku: "CAS-L", name: "Casco L", categoryId: "cat-epp-rows", familyId: "fam-casco", isEpp: true },
      // Sólo tuvo un movimiento, sin fila de stock.
      { id: "prd-guante", sku: "GUA-1", name: "Guante nitrilo", categoryId: "cat-epp-rows", isEpp: true },
      // EPP que nunca pasó por esta faena.
      { id: "prd-arnes", sku: "ARN-1", name: "Arnés", categoryId: "cat-epp-rows", isEpp: true },
      // Con stock, pero no es EPP.
      { id: "prd-cinta", sku: "CIN-1", name: "Cinta aisladora", categoryId: "cat-ins-rows", isEpp: false },
    ])
    await testDb.insert(schema.worksiteStock).values([
      // Stock en cero: estuvo en la bodega, hoy no hay.
      { id: "ws-stock-casco-m", worksiteId, productId: "prd-casco-m", quantity: 0 },
      { id: "ws-stock-casco-l", worksiteId, productId: "prd-casco-l", quantity: 3 },
      { id: "ws-stock-cinta", worksiteId, productId: "prd-cinta", quantity: 10 },
      { id: "ws-stock-arnes-b", worksiteId: otherWorksiteId, productId: "prd-arnes", quantity: 2 },
    ])
    await testDb.insert(schema.inventoryMovements).values({
      id: "mov-guante", worksiteId, productId: "prd-guante", type: "ajuste", quantity: 1,
      stockBefore: 1, stockAfter: 0, performedBy: userId,
    })
    await testDb.insert(schema.preventionInspectionTemplates).values({
      id: TEMPLATE, code: "inspeccion_epp_jt", versionLabel: "01", name: "Inspección de Uso y Estado de EPP (JT)",
      kind: "inspection", sourceDefinitionCode: "inspeccion_epp",
      definitionSnapshot: INSPECCION_EPP as unknown as Record<string, unknown>,
      contentHash: TEMPLATE.padEnd(64, "0").slice(0, 64), status: "approved",
      authorUserId: userId, approvedByUserId: userId, approvedAt: now, createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => pg.close())

  it("lista los EPP que alguna vez estuvieron en la bodega, aunque no tengan stock", async () => {
    const rows = await listWorksiteEppRows(testDb, worksiteId)
    expect(rows).toEqual([
      { key: "fam:fam-casco", label: "Casco de seguridad", eppTypeCode: "cabeza" },
      { key: "prd:prd-guante", label: "Guante nitrilo", eppTypeCode: null },
    ])
  })

  it("la ficha de la ejecución ofrece esas filas y el guardado las acepta", async () => {
    const { run } = await createInspectionRun({ templateId: TEMPLATE, worksiteId, subjectLabel: "Juan Pérez" }, access)
    const detail = await getInspectionRunDetail(run.id, access)
    const cascoUso = `${eppRowId("fam:fam-casco")}_uso`
    expect(matrixIds(detail!.definitionSnapshot)).toEqual([
      cascoUso, `${eppRowId("fam:fam-casco")}_estado`,
      `${eppRowId("prd:prd-guante")}_uso`, `${eppRowId("prd:prd-guante")}_estado`,
    ])

    await expect(saveInspectionAnswers({
      runId: run.id,
      expectedVersion: run.version,
      answers: [{ sectionId: EPP_USE_SECTION_ID, itemId: cascoUso, result: "conforming" }],
    }, access)).resolves.toBeTruthy()

    // Una fila de la lista fija ya no corresponde a esta faena.
    const after = await getInspectionRunDetail(run.id, access)
    await expect(saveInspectionAnswers({
      runId: run.id,
      expectedVersion: after!.run.version,
      answers: [{ sectionId: EPP_USE_SECTION_ID, itemId: "zapatos_seguridad_uso", result: "conforming" }],
    }, access)).rejects.toThrow(/ningún ítem/)
  })

  it("una faena sin historial de EPP conserva la lista fija", async () => {
    const { run } = await createInspectionRun({ templateId: TEMPLATE, worksiteId: emptyWorksiteId, subjectLabel: "Ana Soto" }, access)
    const detail = await getInspectionRunDetail(run.id, access)
    expect(matrixIds(detail!.definitionSnapshot)).toContain("zapatos_seguridad_uso")
  })
})
