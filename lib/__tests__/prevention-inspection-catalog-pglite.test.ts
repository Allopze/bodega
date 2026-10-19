/**
 * Servicios del catálogo de plantillas de Inspecciones (auditoría UI/UX
 * 2026-10-19: P1-11, P2-13, P2-15).
 *
 * - Un anexo oficial incorporado sin fuente no tenía salida: aprobar exige fuente
 *   y paridad, y ninguna acción permitía vincular la fuente después.
 * - Incorporar dejaba todo como «inspección», aunque fuera una observación o una
 *   auditoría.
 * - Revertir tomaba cualquier versión `superseded` (también las retiradas a
 *   propósito), no verificaba el anexo oficial y no subía la versión de los
 *   programas y ejecuciones que movía.
 * - Retirar no avisaba cuántas programaciones activas dejaban de generar.
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
import { readModuleHistory } from "@/lib/testing/audit-history"
import { officialInspectionSourceFor } from "@/lib/sst/official-inspection-sources"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const service = await import("@/lib/services/prevention-inspections")

const AUTHOR_ID = "user-cat-author"
const APPROVER_ID = "user-cat-approver"
const WORKSITE_ID = "ws-cat"
const SST_CATEGORY = "fixture-catalogo"

const scope = { mode: "all", ids: [] } as WorksiteScope
const VIEW = "prevention:inspections:view"
const MANAGE = "prevention:inspections:manage"
const APPROVE = "prevention:inspections:approve"
/** Incorpora y administra, pero no habilita ni declara paridad. */
const AUTHOR = { userId: AUTHOR_ID, scope, permissions: [VIEW, MANAGE, "prevention:inspections:execute"] }
/** Habilita y declara paridad. Es otra persona que el autor. */
const APPROVER = { userId: APPROVER_ID, scope, permissions: [VIEW, MANAGE, APPROVE, "prevention:inspections:execute"] }
const VIEWER = { userId: AUTHOR_ID, scope, permissions: [VIEW] }

/** Una plantilla de plataforma: no transcribe ningún anexo del SGI. */
const PLATFORM_CODE = "inspeccion_condiciones_ambientales"

const PASSED_PARITY = { status: "passed" as const, expectedItems: null, actualItems: null, differences: [] }

async function seedSource(id: string, checksum: string, status = "vigente") {
  const now = new Date().toISOString()
  await testDb.insert(schema.sstDocuments).values({
    id: `doc-${id}`,
    categorySlug: SST_CATEGORY,
    title: `Respaldo ${id}`,
    status: "vigente",
    uploadedBy: AUTHOR_ID,
    createdAt: now,
    updatedAt: now,
  })
  await testDb.insert(schema.sstDocumentVersions).values({
    id: `docv-${id}`,
    documentId: `doc-${id}`,
    version: 1,
    status,
    fileName: `${id}.xlsx`,
    storageName: `${id}.xlsx`,
    filePath: `storage/sst-documents/${id}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fileSize: 1024,
    checksum,
    uploadedBy: AUTHOR_ID,
    createdAt: now,
    updatedAt: now,
  })
  return `docv-${id}`
}

async function importDraft(
  definitionCode: string,
  versionLabel: string,
  extra: Record<string, unknown> = {},
  access: typeof AUTHOR = AUTHOR,
) {
  return service.importInspectionTemplate({ definitionCode, versionLabel, ...extra }, access)
}

function approve(template: { id: string; version: number }) {
  return service.approveInspectionTemplate({
    templateId: template.id,
    expectedVersion: template.version,
    reason: "Instrumento habilitado en la prueba del catálogo.",
  }, APPROVER)
}

async function readTemplate(id: string) {
  const [row] = await testDb.select().from(schema.preventionInspectionTemplates)
    .where(eq(schema.preventionInspectionTemplates.id, id))
  return row
}

describe("servicios del catálogo de plantillas", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    const now = new Date().toISOString()
    await testDb.insert(schema.users).values([
      { id: AUTHOR_ID, name: "Autor", email: "cat-author@chome.cl", hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now },
      { id: APPROVER_ID, name: "Aprobador", email: "cat-approver@chome.cl", hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now },
    ])
    await testDb.insert(schema.worksites).values({
      id: WORKSITE_ID, name: "Faena Catálogo", code: "CAT", isActive: true, createdAt: now, updatedAt: now,
    })
    await testDb.insert(schema.sstDocumentCategories).values({
      slug: SST_CATEGORY, name: "Respaldo documental de las pruebas", createdAt: now, updatedAt: now,
    })
  })

  beforeEach(async () => {
    // Todas las pruebas comparten códigos de instrumento: aprobar una versión
    // retira a la vigente del mismo código, así que cada una parte sin plantillas.
    await testDb.delete(schema.preventionInspectionRuns)
    await testDb.delete(schema.preventionInspectionPrograms)
    await testDb.delete(schema.preventionInspectionTemplates)
  })

  /* ── P2-15: tipo por defecto ─────────────────────────────────────────────── */

  describe("tipo de instrumento al incorporar", () => {
    it("toma el tipo que declara el programa 2026: observación y auditoría ya no entran como inspección", async () => {
      const ampliroll = await importDraft("observacion_ampliroll", "kd-01")
      const auditoria = await importDraft("auditoria_sgsst", "kd-01")
      const checklist = await importDraft(PLATFORM_CODE, "kd-01")

      expect(ampliroll.kind).toBe("observation")
      expect(auditoria.kind).toBe("audit")
      expect(checklist.kind).toBe("inspection")
    })

    it("lo que se manda explícito manda sobre el tipo por defecto", async () => {
      const ampliroll = await importDraft("observacion_ampliroll", "kd-02", { kind: "inspection" })
      expect(ampliroll.kind).toBe("inspection")
    })

    it("el catálogo importable informa tipo por defecto, fuente obligatoria y checksum", () => {
      const byCode = new Map(service.listImportableDefinitions().map((definition) => [definition.code, definition]))

      expect(byCode.get("observacion_ampliroll")).toMatchObject({
        defaultKind: "observation",
        needsOfficialSource: true,
        officialChecksumSha256: officialInspectionSourceFor("observacion_ampliroll")!.sha256,
      })
      expect(byCode.get("auditoria_sgsst")).toMatchObject({
        defaultKind: "audit", needsOfficialSource: false, officialChecksumSha256: null,
      })
      // Exige respaldo documental aunque no figure entre los anexos con checksum.
      expect(byCode.get("reporte_equipos")).toMatchObject({
        needsOfficialSource: true, officialChecksumSha256: null,
      })
    })
  })

  /* ── P2-15: revertir versión ─────────────────────────────────────────────── */

  describe("revertir a la versión anterior", () => {
    it("restaura la versión que esta reemplazó y sube la versión de programas y ejecuciones", async () => {
      const v1 = await approve(await importDraft(PLATFORM_CODE, "rb-01"))
      const v2 = await approve(await importDraft(PLATFORM_CODE, "rb-02"))
      expect((await readTemplate(v1.id))).toMatchObject({ status: "superseded", supersededByTemplateId: v2.id })

      const program = await service.createInspectionProgram({
        templateId: v2.id, worksiteId: WORKSITE_ID, frequency: "monthly", startsOn: "2026-06-01",
      }, AUTHOR)
      await testDb.insert(schema.preventionInspectionRuns).values({
        id: "insrun-rb-planned", code: "INSP-RB-0001", templateId: v2.id, worksiteId: WORKSITE_ID,
        scheduledFor: "2026-06-01", status: "planned", createdByUserId: AUTHOR_ID,
      })
      const [programBefore] = await testDb.select().from(schema.preventionInspectionPrograms)
        .where(eq(schema.preventionInspectionPrograms.id, program.id))
      const [runBefore] = await testDb.select().from(schema.preventionInspectionRuns)
        .where(eq(schema.preventionInspectionRuns.id, "insrun-rb-planned"))

      const result = await service.rollbackInspectionTemplate({
        currentTemplateId: v2.id, previousTemplateId: v1.id, reason: "La nueva versión tiene un ítem mal transcrito.",
      }, APPROVER)

      expect(result).toEqual({ restored: v1.id, programs: 1, plannedRuns: 1 })
      expect(await readTemplate(v1.id)).toMatchObject({ status: "approved", supersededByTemplateId: null })
      expect(await readTemplate(v2.id)).toMatchObject({ status: "superseded", supersededByTemplateId: v1.id })

      // Quien tenía abierto el programa o la ejecución con la plantilla anterior
      // debe chocar con el bloqueo optimista: igual que al aprobar.
      const [programAfter] = await testDb.select().from(schema.preventionInspectionPrograms)
        .where(eq(schema.preventionInspectionPrograms.id, program.id))
      const [runAfter] = await testDb.select().from(schema.preventionInspectionRuns)
        .where(eq(schema.preventionInspectionRuns.id, "insrun-rb-planned"))
      expect(programAfter).toMatchObject({ templateId: v1.id, version: programBefore!.version + 1 })
      expect(runAfter).toMatchObject({ templateId: v1.id, version: runBefore!.version + 1 })
    })

    it("rechaza una versión que se retiró a propósito: sólo se restaura la que esta reemplazó", async () => {
      const retiredTemplate = await approve(await importDraft(PLATFORM_CODE, "rb-10"))
      await service.createInspectionProgram({
        templateId: retiredTemplate.id, worksiteId: WORKSITE_ID, frequency: "monthly", startsOn: "2026-06-01",
      }, AUTHOR)
      // Tiene una programación, así que retirarla no la borra: queda `superseded`
      // pero sin ninguna versión que la haya reemplazado.
      await service.retireInspectionTemplate({
        templateId: retiredTemplate.id, reason: "Instrumento retirado por decisión de Prevención.",
      }, APPROVER)
      expect(await readTemplate(retiredTemplate.id)).toMatchObject({ status: "superseded", supersededByTemplateId: null })

      const current = await approve(await importDraft(PLATFORM_CODE, "rb-11"))

      await expect(service.rollbackInspectionTemplate({
        currentTemplateId: current.id, previousTemplateId: retiredTemplate.id,
        reason: "Intento de resucitar una versión retirada.",
      }, APPROVER)).rejects.toThrow(/versión retirada no se restaura/i)
      // Nada cambió.
      expect(await readTemplate(current.id)).toMatchObject({ status: "approved" })
      expect(await readTemplate(retiredTemplate.id)).toMatchObject({ status: "superseded" })
    })

    it("rechaza volver a una versión cuyo anexo oficial cambió, y la restaura al recuperarse", async () => {
      const officialSha = officialInspectionSourceFor("inspeccion_extintores")!.sha256
      const sourceId = await seedSource("rb-extintores", officialSha)
      const official = { sourceDocumentVersionId: sourceId, parityReport: PASSED_PARITY }
      const v1 = await approve(await importDraft("inspeccion_extintores", "of-01", official))
      const v2 = await approve(await importDraft("inspeccion_extintores", "of-02", official))
      const rollback = () => service.rollbackInspectionTemplate({
        currentTemplateId: v2.id, previousTemplateId: v1.id, reason: "Volver a la versión anterior del anexo.",
      }, APPROVER)

      // El archivo vigente ya no es el que se contrastó al aprobar v1.
      await testDb.update(schema.sstDocumentVersions)
        .set({ checksum: "d".repeat(64) })
        .where(eq(schema.sstDocumentVersions.id, sourceId))
      await expect(rollback()).rejects.toThrow(/cambió su integridad/i)
      expect(await readTemplate(v2.id)).toMatchObject({ status: "approved" })
      expect(await readTemplate(v1.id)).toMatchObject({ status: "superseded" })

      await testDb.update(schema.sstDocumentVersions)
        .set({ checksum: officialSha })
        .where(eq(schema.sstDocumentVersions.id, sourceId))
      await expect(rollback()).resolves.toMatchObject({ restored: v1.id })
    })
  })

  /* ── P2-14: retirar ──────────────────────────────────────────────────────── */

  describe("retirar una plantilla", () => {
    it("informa cuántas programaciones activas dejan de generar y no marca reemplazo", async () => {
      const template = await approve(await importDraft(PLATFORM_CODE, "rt-01"))
      const active = await service.createInspectionProgram({
        templateId: template.id, worksiteId: WORKSITE_ID, frequency: "monthly", startsOn: "2026-06-01",
      }, AUTHOR)
      const paused = await service.createInspectionProgram({
        templateId: template.id, worksiteId: WORKSITE_ID, frequency: "weekly", startsOn: "2026-06-01",
      }, AUTHOR)
      await service.updateInspectionProgram({
        programId: paused.id, expectedVersion: paused.version, isActive: false,
        reason: "Se detiene mientras se revisa el instrumento.",
      }, AUTHOR)

      const result = await service.retireInspectionTemplate({
        templateId: template.id, reason: "Instrumento fuera de uso en la faena.",
      }, APPROVER)

      expect(result).toEqual({ outcome: "superseded", runs: 0, programs: 2, activePrograms: 1 })
      const row = await readTemplate(template.id)
      expect(row).toMatchObject({ status: "superseded", supersededByTemplateId: null })
      expect(active.isActive).toBe(true)
    })

    it("una plantilla sin uso se elimina y no tiene programaciones activas", async () => {
      const draft = await importDraft(PLATFORM_CODE, "rt-02")
      const result = await service.retireInspectionTemplate({
        templateId: draft.id, reason: "Incorporada por error.",
      }, APPROVER)
      expect(result).toEqual({ outcome: "deleted", runs: 0, programs: 0, activePrograms: 0 })
      expect(await readTemplate(draft.id)).toBeUndefined()
    })
  })

  /* ── P1-11: vincular la fuente de un anexo oficial ───────────────────────── */

  describe("vincular la fuente documental", () => {
    const maquinariaSha = officialInspectionSourceFor("observacion_maquinaria")!.sha256

    it("camino completo: vincular, paridad por otra persona y aprobar", async () => {
      const sourceId = await seedSource("ln-maquinaria", maquinariaSha)
      const draft = await importDraft("observacion_maquinaria", "ln-01")
      expect(draft).toMatchObject({ sourceDocumentVersionId: null, provenanceKind: "official_document" })

      // El callejón sin salida: sin fuente no se puede aprobar, y antes tampoco
      // había forma de agregarla.
      await expect(approve(draft)).rejects.toThrow(/versión oficial vinculada/i)

      const linked = await service.linkInspectionTemplateSource({
        templateId: draft.id, expectedVersion: draft.version,
        sourceDocumentVersionId: sourceId, sourceRevision: "Rev. 03",
      }, AUTHOR)
      expect(linked.sourceDocumentVersionId).toBe(sourceId)
      expect(linked.sourceSnapshot).toMatchObject({
        versionId: sourceId, documentId: "doc-ln-maquinaria", fileName: "ln-maquinaria.xlsx",
        revision: "Rev. 03", checksumSha256: maquinariaSha,
      })
      expect(linked.parityReport).toMatchObject({
        status: "pending", verifiedAt: null, verifiedByUserId: null, differences: [],
      })
      expect(linked.version).toBe(draft.version + 1)

      // La paridad la declara otra persona con permiso de aprobación.
      const verified = await service.setInspectionTemplateParity({
        templateId: linked.id, expectedVersion: linked.version, status: "passed",
        reason: "Contrastada ítem por ítem contra el Anexo 5 impreso.",
      }, APPROVER)
      expect(verified.parityReport).toMatchObject({ status: "passed", verifiedByUserId: APPROVER_ID })

      // Cambiar la fuente invalida lo declarado contra la anterior.
      const relinked = await service.linkInspectionTemplateSource({
        templateId: verified.id, expectedVersion: verified.version, sourceDocumentVersionId: sourceId,
      }, AUTHOR)
      expect(relinked.parityReport).toMatchObject({ status: "pending", verifiedAt: null, verifiedByUserId: null })
      await expect(approve(relinked)).rejects.toThrow(/paridad documental/i)

      const verifiedAgain = await service.setInspectionTemplateParity({
        templateId: relinked.id, expectedVersion: relinked.version, status: "passed",
        reason: "Contrastada otra vez tras volver a vincular la planilla.",
      }, APPROVER)
      const approved = await approve(verifiedAgain)
      expect(approved.status).toBe("approved")

      const history = await readModuleHistory(testDb, {
        module: "inspection", entityType: "template", entityId: draft.id, changeType: "source_linked",
      })
      expect(history).toHaveLength(2)
      expect(history[0]!.reason).toMatch(/ln-maquinaria\.xlsx \(Rev\. 03\)/)
      expect(history[0]!.actorUserId).toBe(AUTHOR_ID)
    })

    it("sólo un borrador puede cambiar su fuente", async () => {
      const approved = await approve(await importDraft(PLATFORM_CODE, "ln-10"))
      const sourceId = await seedSource("ln-no-borrador", maquinariaSha)
      await expect(service.linkInspectionTemplateSource({
        templateId: approved.id, expectedVersion: approved.version, sourceDocumentVersionId: sourceId,
      }, AUTHOR)).rejects.toThrow("Sólo un borrador puede cambiar su fuente documental.")
    })

    it("una plantilla que no transcribe un anexo oficial no necesita fuente", async () => {
      const draft = await importDraft(PLATFORM_CODE, "ln-11")
      expect(draft.provenanceKind).toBe("platform_definition")
      const sourceId = await seedSource("ln-plataforma", maquinariaSha)
      await expect(service.linkInspectionTemplateSource({
        templateId: draft.id, expectedVersion: draft.version, sourceDocumentVersionId: sourceId,
      }, AUTHOR)).rejects.toThrow("Esta plantilla no transcribe un anexo oficial: no necesita fuente.")
      expect((await readTemplate(draft.id))!.sourceDocumentVersionId).toBeNull()
    })

    it("rechaza un archivo cuyo checksum no es el del anexo oficial", async () => {
      const draft = await importDraft("observacion_maquinaria", "ln-12")
      const wrongId = await seedSource("ln-otro-archivo", "e".repeat(64))
      await expect(service.linkInspectionTemplateSource({
        templateId: draft.id, expectedVersion: draft.version, sourceDocumentVersionId: wrongId,
      }, AUTHOR)).rejects.toThrow(/no coincide con el checksum de la fuente oficial/i)
      const unchanged = await readTemplate(draft.id)
      expect(unchanged).toMatchObject({ sourceDocumentVersionId: null, version: draft.version })
    })

    it("rechaza una versión documental que no está aprobada ni vigente", async () => {
      const draft = await importDraft("observacion_maquinaria", "ln-13")
      const draftSourceId = await seedSource("ln-borrador", maquinariaSha, "borrador")
      await expect(service.linkInspectionTemplateSource({
        templateId: draft.id, expectedVersion: draft.version, sourceDocumentVersionId: draftSourceId,
      }, AUTHOR)).rejects.toThrow(/aprobada o vigente/i)
    })

    it("exige permiso de gestión y respeta el bloqueo optimista", async () => {
      const draft = await importDraft("observacion_maquinaria", "ln-14")
      const sourceId = await seedSource("ln-permisos", maquinariaSha)
      await expect(service.linkInspectionTemplateSource({
        templateId: draft.id, expectedVersion: draft.version, sourceDocumentVersionId: sourceId,
      }, VIEWER)).rejects.toThrow(/fuera de alcance/i)

      await expect(service.linkInspectionTemplateSource({
        templateId: draft.id, expectedVersion: draft.version + 5, sourceDocumentVersionId: sourceId,
      }, AUTHOR)).rejects.toThrow(/cambió mientras la editabas/i)
    })
  })
})
