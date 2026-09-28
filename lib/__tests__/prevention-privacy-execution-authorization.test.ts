/**
 * FX-A (A7–A10) — autorización e idempotencia del ejercicio de derechos de
 * privacidad, contra PostgreSQL real (PGlite).
 *
 * `prevention:privacy:manage_requests` se concede a roles que NO tienen los
 * permisos de salud ni los de documentos sensibles. Atender una solicitud no
 * puede servir de atajo para rectificar la aptitud de alguien, purgar su
 * expediente clínico, exportar sus restricciones o leer títulos de documentos
 * sensibles. Y la ejecución de un derecho es irreversible: repetir el mismo
 * clic no puede ejecutarla dos veces aunque el proceso se reinicie entremedio.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { encryptPreventionPayload } from "@/lib/security/prevention-field-encryption"

process.env.PREVENTION_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64")
process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = "fxa-test"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const { executePreventionPrivacyRight, getPreventionPrivacyRequestWorkbench } = await import("@/lib/services/prevention-privacy-rights")
const { getPreventionPrivacyExportDataset, listGeneralLibrarySensitiveAccess } = await import("@/lib/services/prevention-privacy")

const NOW = "2026-09-27T10:00:00.000Z"
const SCOPE = { mode: "some" as const, ids: ["ws-fx"] }
const MANAGE = "prevention:privacy:manage_requests"

function request(id: string, rightType: string) {
  return {
    id, subjectWorkerId: "wrk-fx", rightType, status: "en_proceso", requestScope: "Antecedentes del titular",
    receivedAt: NOW, identityVerifiedAt: NOW, identityVerifiedByUserId: "u-fx", createdAt: NOW, updatedAt: NOW,
  }
}

function execute(permissions: string[], input: Record<string, unknown>, idempotencyKey?: string) {
  return executePreventionPrivacyRight({
    ctx: { userId: "u-fx" }, scope: SCOPE, permissions, idempotencyKey,
    input: { reason: "Titular validado ejerce su derecho", changes: {}, ...input },
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values({ id: "ws-fx", name: "Faena FX", code: "FN-FX" })
  await testDb.insert(schema.users).values({ id: "u-fx", name: "Encargada", email: "fx@chome.cl", hashedPassword: "x" })
  await testDb.insert(schema.workers).values({ id: "wrk-fx", rut: "9.876.543-2", firstName: "Ana", lastName: "Titular", worksiteId: "ws-fx" })
  await testDb.insert(schema.sstDocumentCategories).values({ slug: "gestion_preventiva", name: "Gestión preventiva", createdAt: NOW, updatedAt: NOW })
})
afterAll(async () => { await pg.close() })

beforeEach(async () => {
  await testDb.delete(schema.preventionSensitiveAccessAudit)
  await testDb.delete(schema.preventionSubjectProcessingRestrictions)
  await testDb.delete(schema.preventionPrivacyRequestExecutions)
  await testDb.delete(schema.preventionPrivacyRequests)
  await testDb.delete(schema.preventionHealthClinicalPayloads)
  await testDb.delete(schema.preventionHealthRecords)
  await testDb.delete(schema.sstDocumentAudit)
  await testDb.delete(schema.sstDocumentLinks)
  await testDb.delete(schema.sstDocuments)

  await testDb.insert(schema.preventionPrivacyRequests).values([
    request("req-rect", "rectification"),
    request("req-del", "deletion"),
    request("req-opp", "opposition"),
    request("req-access", "access"),
  ])
  await testDb.insert(schema.preventionHealthRecords).values({
    id: "hr-fx", workerId: "wrk-fx", worksiteId: "ws-fx", recordType: "aptitud", status: "vigente",
    fitnessStatus: "apto_con_restricciones", restrictionsSummary: "No levantar más de 10 kg",
    issuerName: "Médico", createdByUserId: "u-fx", createdAt: NOW, updatedAt: NOW,
  })
  await testDb.insert(schema.preventionHealthClinicalPayloads).values({
    id: "phc-fx", healthRecordId: "hr-fx", ...encryptPreventionPayload({ diagnostico: "reservado" }, "health:hr-fx"),
    createdByUserId: "u-fx", createdAt: NOW, updatedAt: NOW,
  })
  await testDb.insert(schema.sstDocuments).values([
    {
      id: "doc-sens", categorySlug: "gestion_preventiva", title: "Evaluación psicosocial de Ana", worksiteId: "ws-fx",
      status: "vigente", confidentiality: "sensible", dataClass: "sensitive_preventive", uploadedBy: "u-fx", createdAt: NOW, updatedAt: NOW,
    },
    {
      id: "doc-oper", categorySlug: "gestion_preventiva", title: "Charla operacional", worksiteId: "ws-fx",
      status: "vigente", confidentiality: "publico_interno", dataClass: "sensitive_preventive", uploadedBy: "u-fx", createdAt: NOW, updatedAt: NOW,
    },
  ])
  await testDb.insert(schema.sstDocumentLinks).values({
    id: "link-sens", documentId: "doc-sens", entityType: "worker", entityId: "wrk-fx", createdAt: NOW,
  })
  await testDb.insert(schema.sstDocumentAudit).values([
    { id: "sda-1", documentId: "doc-sens", action: "view", userId: "u-fx", createdAt: NOW },
    { id: "sda-2", documentId: "doc-oper", action: "download", userId: "u-fx", createdAt: NOW },
  ])
})

describe("A7 — ejecutar un derecho sobre salud o documentos exige el permiso del dominio", () => {
  it("rectificar aptitud o restricciones exige health:view_restrictions", async () => {
    await expect(execute([MANAGE], {
      requestId: "req-rect", domain: "health_record", entityId: "hr-fx", operation: "rectification",
      changes: { fitnessStatus: "apto" },
    })).rejects.toThrow(/aptitud/i)
    const [record] = await testDb.select().from(schema.preventionHealthRecords).where(eq(schema.preventionHealthRecords.id, "hr-fx"))
    expect(record?.fitnessStatus).toBe("apto_con_restricciones")

    await expect(execute([MANAGE, "prevention:health:view_restrictions"], {
      requestId: "req-rect", domain: "health_record", entityId: "hr-fx", operation: "rectification",
      changes: { restrictionsSummary: "Sin restricciones" },
    })).resolves.toMatchObject({ outcome: "applied" })
  })

  it("rectificar datos no clínicos del registro (emisor) no exige permisos de salud", async () => {
    await expect(execute([MANAGE], {
      requestId: "req-rect", domain: "health_record", entityId: "hr-fx", operation: "rectification",
      changes: { issuerName: "Médico corregido" },
    })).resolves.toMatchObject({ outcome: "applied" })
  })

  it("suprimir el expediente clínico exige health:view_clinical", async () => {
    await expect(execute([MANAGE, "prevention:health:view_restrictions"], {
      requestId: "req-del", domain: "health_record", entityId: "hr-fx", operation: "deletion",
    })).rejects.toThrow(/clínic/i)
    expect(await testDb.select().from(schema.preventionHealthClinicalPayloads)).toHaveLength(1)

    await expect(execute([MANAGE, "prevention:health:view_restrictions", "prevention:health:view_clinical"], {
      requestId: "req-del", domain: "health_record", entityId: "hr-fx", operation: "deletion",
    })).resolves.toMatchObject({ outcome: "applied" })
    expect(await testDb.select().from(schema.preventionHealthClinicalPayloads)).toHaveLength(0)
  })

  it("oponerse al tratamiento de un documento sensible exige docs:manage_sensitive", async () => {
    await expect(execute([MANAGE], {
      requestId: "req-opp", domain: "document", entityId: "link-sens", operation: "opposition",
    })).rejects.toThrow(/no encontrado o fuera de alcance/i)

    await expect(execute([MANAGE, "prevention:docs:manage_sensitive"], {
      requestId: "req-opp", domain: "document", entityId: "link-sens", operation: "opposition",
    })).resolves.toMatchObject({ outcome: "applied" })
  })
})

describe("A8 — la exportación al titular no filtra aptitud sin health:view_restrictions", () => {
  const exportArgs = (permissions: string[]) => ({
    requestId: "req-access", includeClinical: false, purpose: "Respuesta al derecho de acceso",
    ctx: { userId: "u-fx" }, scope: SCOPE, permissions,
  })

  it("omite aptitud y restricciones sin el permiso, y lo declara", async () => {
    const dataset = await getPreventionPrivacyExportDataset(exportArgs(["prevention:privacy:export_subject"]))
    expect(dataset.includesFitness).toBe(false)
    expect(dataset.healthRecords[0]).toMatchObject({ id: "hr-fx", fitnessStatus: null, restrictionsSummary: null })
  })

  it("los incluye con el permiso", async () => {
    const dataset = await getPreventionPrivacyExportDataset(exportArgs(["prevention:privacy:export_subject", "prevention:health:view_restrictions"]))
    expect(dataset.includesFitness).toBe(true)
    expect(dataset.healthRecords[0]).toMatchObject({ fitnessStatus: "apto_con_restricciones", restrictionsSummary: "No levantar más de 10 kg" })
  })
})

describe("A9 — la auditoría de biblioteca no muestra títulos de documentos que el auditor no puede ver", () => {
  it("sin docs:manage_sensitive sólo lista accesos a documentos que puede leer", async () => {
    const limited = await listGeneralLibrarySensitiveAccess(SCOPE, ["prevention:privacy:audit"])
    expect(limited.map((row) => row.documentId)).toEqual(["doc-oper"])

    const full = await listGeneralLibrarySensitiveAccess(SCOPE, ["prevention:privacy:audit", "prevention:docs:manage_sensitive"])
    expect(full.map((row) => row.documentId).sort()).toEqual(["doc-oper", "doc-sens"])
  })
})

describe("el inventario de la solicitud no muestra títulos de documentos que quien atiende no puede leer", () => {
  const workbench = (permissions: string[]) => getPreventionPrivacyRequestWorkbench({
    requestId: "req-access", ctx: { userId: "u-fx" }, scope: SCOPE, permissions,
  })

  it("sin docs:manage_sensitive, el documento sensible queda como contador", async () => {
    const bundle = await workbench([MANAGE])
    expect(bundle?.inventory.documentLinks).toEqual([])
    expect(bundle?.restrictedDocumentCount).toBe(1)
  })

  it("con el permiso, se lista", async () => {
    const bundle = await workbench([MANAGE, "prevention:docs:manage_sensitive"])
    expect(bundle?.inventory.documentLinks.map((row) => row.documentId)).toEqual(["doc-sens"])
    expect(bundle?.restrictedDocumentCount).toBe(0)
  })
})

describe("A10 — la idempotencia de la ejecución vive en la base, no en memoria", () => {
  const withRestrictions = [MANAGE, "prevention:health:view_restrictions"]
  const rectify = { requestId: "req-rect", domain: "health_record", entityId: "hr-fx", operation: "rectification", changes: { issuerName: "Médico corregido" } }

  it("la misma clave devuelve la ejecución previa sin volver a aplicarla", async () => {
    const first = await execute(withRestrictions, rectify, "clave-dialogo-1")
    const second = await execute(withRestrictions, rectify, "clave-dialogo-1")
    expect(second.id).toBe(first.id)
    expect(second.replayed).toBe(true)
    expect(await testDb.select().from(schema.preventionPrivacyRequestExecutions)).toHaveLength(1)
  })

  it("dos envíos concurrentes con la misma clave dejan una sola ejecución", async () => {
    const [a, b] = await Promise.all([
      execute(withRestrictions, rectify, "clave-dialogo-2"),
      execute(withRestrictions, rectify, "clave-dialogo-2"),
    ])
    expect(a.id).toBe(b.id)
    expect(await testDb.select().from(schema.preventionPrivacyRequestExecutions)).toHaveLength(1)
  })

  it("claves distintas son ejecuciones distintas", async () => {
    await execute(withRestrictions, rectify, "clave-dialogo-3")
    await execute(withRestrictions, rectify, "clave-dialogo-4")
    expect(await testDb.select().from(schema.preventionPrivacyRequestExecutions)).toHaveLength(2)
  })
})
