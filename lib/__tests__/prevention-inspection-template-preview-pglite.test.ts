/**
 * Vista previa de una plantilla (auditoría UI/UX 2026-10-19, P1-12): hasta ahora
 * se aprobaba y se declaraba la paridad sin poder leer una sola pregunta, y el
 * historial de versiones de un instrumento sólo existía en la base.
 *
 * Se prueba contra Postgres real (PGlite) porque lo que importa es lo que el
 * servicio lee de la fila y de sus hermanas del mismo código.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
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

const service = await import("@/lib/services/prevention-inspections")
const { getInspectionTemplatePreview } = await import("@/lib/services/prevention-inspections/template-preview")

const AUTHOR_ID = "user-prev-author"
const APPROVER_ID = "user-prev-approver"
const scope = { mode: "all", ids: [] } as WorksiteScope
const VIEW = "prevention:inspections:view"
const MANAGE = "prevention:inspections:manage"
const APPROVE = "prevention:inspections:approve"
const AUTHOR = { userId: AUTHOR_ID, scope, permissions: [VIEW, MANAGE] }
const APPROVER = { userId: APPROVER_ID, scope, permissions: [VIEW, MANAGE, APPROVE] }
const VIEWER = { userId: AUTHOR_ID, scope, permissions: [VIEW] }
const NO_VIEW = { userId: AUTHOR_ID, scope, permissions: ["prevention:inspections:execute"] }

/** Anexos oficiales: no se aprueban sin planilla, pero se leen igual. */
const EXTINTORES = "inspeccion_extintores"
const EPP = "inspeccion_epp"
/** Definición de plataforma: se aprueba sin planilla oficial. */
const PLATFORM = "inspeccion_condiciones_ambientales"

async function importDraft(definitionCode: string, versionLabel: string) {
  return service.importInspectionTemplate({ definitionCode, versionLabel }, AUTHOR)
}

describe("vista previa de una plantilla", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    const now = new Date().toISOString()
    await testDb.insert(schema.users).values([
      { id: AUTHOR_ID, name: "Autor", email: "prev-author@chome.cl", hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now },
      { id: APPROVER_ID, name: "Aprobador", email: "prev-approver@chome.cl", hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now },
    ])
  })

  beforeEach(async () => {
    await testDb.delete(schema.preventionInspectionRuns)
    await testDb.delete(schema.preventionInspectionPrograms)
    await testDb.delete(schema.preventionInspectionTemplates)
  })

  it("devuelve el cuestionario con su escala, el acta y los totales", async () => {
    const draft = await importDraft(EXTINTORES, "pv-01")
    const preview = await getInspectionTemplatePreview(draft.id, VIEWER)

    expect(preview).not.toBeNull()
    expect(preview!.template).toMatchObject({
      id: draft.id, code: EXTINTORES, versionLabel: "pv-01", status: "draft", statusLabel: "Borrador",
    })
    const items = preview!.questionnaire.sections.flatMap((section) => section.items)
    expect(items.length).toBeGreaterThan(0)
    expect(preview!.questionnaire.totals.items).toBe(items.length)
    // La escala del anexo, no la genérica: Extintores es Bueno / Malo.
    expect(items.some((item) => item.scale.map((o) => o.label).join("/") === "Bueno/Malo")).toBe(true)
    expect(preview!.questionnaire.closingAct?.signatureRoles.map((role) => role.label)).toEqual(["Prevencionista", "Supervisor"])
    expect(preview!.questionnaire.rowsFromWarehouse).toBe(false)
  })

  it("avisa que las prendas de EPP salen de la bodega", async () => {
    const draft = await importDraft(EPP, "pv-epp")
    const preview = await getInspectionTemplatePreview(draft.id, VIEWER)
    expect(preview!.questionnaire.rowsFromWarehouse).toBe(true)
  })

  it("el historial trae todas las versiones del mismo código, con «Retirada» y «Reemplazada» bien dichas", async () => {
    const v1 = await importDraft(PLATFORM, "pv-10")
    await service.approveInspectionTemplate({ templateId: v1.id, expectedVersion: v1.version, reason: "Habilitada para la prueba." }, APPROVER)
    const v2 = await importDraft(PLATFORM, "pv-11")
    await service.approveInspectionTemplate({ templateId: v2.id, expectedVersion: v2.version, reason: "Nueva versión habilitada." }, APPROVER)
    const v3 = await importDraft(PLATFORM, "pv-12")
    // Un instrumento de otro código no debe colarse en el historial.
    await importDraft(EPP, "pv-otro")

    const preview = await getInspectionTemplatePreview(v2.id, VIEWER)
    expect(preview!.versions.map((v) => v.versionLabel).sort()).toEqual(["pv-10", "pv-11", "pv-12"])
    const byLabel = Object.fromEntries(preview!.versions.map((v) => [v.versionLabel, v]))
    expect(byLabel["pv-10"]).toMatchObject({ status: "superseded", statusLabel: "Reemplazada", current: false })
    expect(byLabel["pv-11"]).toMatchObject({ status: "approved", statusLabel: "Aprobada", current: true })
    expect(byLabel["pv-12"]).toMatchObject({ status: "draft", statusLabel: "Borrador", current: false })
    expect(byLabel["pv-11"]!.approvedAt).not.toBeNull()
    expect(preview!.versions.filter((v) => v.current)).toHaveLength(1)
    expect(v3.id).toBe(preview!.versions.find((v) => v.versionLabel === "pv-12")!.id)

    // Una retirada a propósito (superseded sin reemplazo) se llama «Retirada».
    await testDb.update(schema.preventionInspectionTemplates)
      .set({ status: "superseded", supersededByTemplateId: null })
      .where(eq(schema.preventionInspectionTemplates.id, v2.id))
    const after = await getInspectionTemplatePreview(v1.id, VIEWER)
    expect(after!.versions.find((v) => v.versionLabel === "pv-11")).toMatchObject({ statusLabel: "Retirada" })
    expect((await getInspectionTemplatePreview(v2.id, VIEWER))!.template.statusLabel).toBe("Retirada")
  })

  it("el detalle técnico trae el código, la definición de origen, el hash del JSON y el informe de paridad", async () => {
    const draft = await importDraft(EXTINTORES, "pv-20")
    await testDb.update(schema.preventionInspectionTemplates).set({
      parityReport: {
        status: "failed", verifiedAt: "2026-10-01T12:00:00.000Z", verifiedByUserId: APPROVER_ID,
        expectedItems: 30, actualItems: 28, differences: ["Falta el ítem «Manómetro»", "Falta el ítem «Pasador»"],
      },
      sourceSnapshot: {
        documentId: "doc-x", versionId: "docv-x", fileName: "anexo-10.xlsx", revision: "Rev. 02",
        effectiveFrom: null, checksumSha256: "a".repeat(64),
      },
    }).where(eq(schema.preventionInspectionTemplates.id, draft.id))

    const preview = await getInspectionTemplatePreview(draft.id, VIEWER)
    expect(preview!.technical).toMatchObject({
      code: EXTINTORES,
      sourceDefinitionCode: EXTINTORES,
      contentHash: draft.contentHash,
      source: { fileName: "anexo-10.xlsx", revision: "Rev. 02", checksumSha256: "a".repeat(64) },
      parity: {
        status: "failed", expectedItems: 30, actualItems: 28,
        differences: ["Falta el ítem «Manómetro»", "Falta el ítem «Pasador»"],
      },
    })
    expect(preview!.technical.provenanceLabel).toBeTruthy()
  })

  it("una plantilla sin fuente ni paridad deja esos campos en nulo y no inventa nada", async () => {
    const draft = await importDraft(EXTINTORES, "pv-30")
    await testDb.update(schema.preventionInspectionTemplates)
      .set({ sourceSnapshot: null })
      .where(eq(schema.preventionInspectionTemplates.id, draft.id))
    const preview = await getInspectionTemplatePreview(draft.id, VIEWER)
    expect(preview!.technical.source).toBeNull()
  })

  it("un id que no existe devuelve null, no un error", async () => {
    await expect(getInspectionTemplatePreview("insptpl-no-existe", VIEWER)).resolves.toBeNull()
  })

  it("sin permiso de ver inspecciones no se lee nada", async () => {
    const draft = await importDraft(EXTINTORES, "pv-40")
    await expect(getInspectionTemplatePreview(draft.id, NO_VIEW)).rejects.toThrow()
  })
})
