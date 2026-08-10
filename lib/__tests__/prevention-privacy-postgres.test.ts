/**
 * Real PostgreSQL proof for privacy-right execution, structural subjects and
 * encrypted-file backup/restore. Runs only against an explicitly disposable DB.
 */
import path from "node:path"
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises"
import os from "node:os"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq, sql } from "drizzle-orm"
import * as schema from "@/db/schema"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"
import { encryptPreventionPayload } from "@/lib/security/prevention-field-encryption"
import {
  createSstDocumentPath,
  resolvePreventionSensitiveFile,
  resolveSstDocumentsDir,
} from "@/lib/storage/config"

const databaseUrl = process.env.PREVENTION_PRIVACY_DATABASE_URL
const canResetDatabase = process.env.PREVENTION_PRIVACY_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canResetDatabase ? describe : describe.skip

let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined
let storageDir: string | undefined
const previousDatabaseUrl = process.env.DATABASE_URL
const previousStoragePath = process.env.STORAGE_PATH
const previousKey = process.env.PREVENTION_DATA_ENCRYPTION_KEY
const previousKeyVersion = process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION

describeIf("privacy rights and sensitive backup/restore on real Postgres", () => {
  beforeAll(async () => {
    assertSafeDestructiveDatabase({
      databaseUrl: databaseUrl!,
      allowDestructiveReset: canResetDatabase,
      context: "PREVENTION_PRIVACY",
    })
    await ensureDatabaseExists(databaseUrl!)
    await resetDatabase(databaseUrl!)
    const migrationClient = postgres(databaseUrl!, { max: 1 })
    await migrate(drizzle(migrationClient), { migrationsFolder: path.resolve(process.cwd(), "db/migrations") })
    await migrationClient.end()

    client = postgres(databaseUrl!, { max: 10 })
    testDb = drizzle(client, { schema })
    const globalWithDb = globalThis as typeof globalThis & { __db?: typeof testDb }
    globalWithDb.__db = testDb
    process.env.DATABASE_URL = databaseUrl
    storageDir = await mkdtemp(path.join(os.tmpdir(), "chome-privacy-test-"))
    process.env.STORAGE_PATH = storageDir
    process.env.PREVENTION_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 19).toString("base64")
    process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = "privacy-test-v1"
    vi.resetModules()
    await seedFixture(getDb())
  }, 60_000)

  afterAll(async () => {
    const globalWithDb = globalThis as typeof globalThis & { __db?: unknown }
    globalWithDb.__db = undefined
    await client?.end()
    if (storageDir) await rm(storageDir, { recursive: true, force: true })
    restoreEnv("DATABASE_URL", previousDatabaseUrl)
    restoreEnv("STORAGE_PATH", previousStoragePath)
    restoreEnv("PREVENTION_DATA_ENCRYPTION_KEY", previousKey)
    restoreEnv("PREVENTION_DATA_ENCRYPTION_KEY_VERSION", previousKeyVersion)
  })

  it("executes deletion with minimization, audit hashes and completion evidence", async () => {
    const { executePreventionPrivacyRight } = await import("@/lib/services/prevention-privacy-rights")
    const { transitionPreventionPrivacyRequest } = await import("@/lib/services/prevention-privacy")
    const access = {
      ctx: { userId: "privacy-manager" },
      scope: { mode: "some" as const, ids: ["ws-privacy"] },
      permissions: ["prevention:privacy:manage_requests"],
    }

    const execution = await executePreventionPrivacyRight({
      ...access,
      input: {
        requestId: "privacy-delete-health",
        domain: "health_record",
        entityId: "health-delete",
        operation: "deletion",
        reason: "Titular validado solicita supresión; no existe retención vigente",
        changes: {},
      },
    })
    expect(execution).toMatchObject({ operation: "deletion", outcome: "applied" })
    expect(execution.beforeHash).toHaveLength(64)
    expect(execution.afterHash).toHaveLength(64)

    const db = getDb()
    const [health] = await db.select().from(schema.preventionHealthRecords).where(eq(schema.preventionHealthRecords.id, "health-delete"))
    expect(health).toMatchObject({ status: "archivado", restrictionsSummary: null, issuerName: null, providerName: null })
    expect(await db.select().from(schema.preventionHealthClinicalPayloads)
      .where(eq(schema.preventionHealthClinicalPayloads.healthRecordId, "health-delete"))).toHaveLength(0)

    await expect(transitionPreventionPrivacyRequest({
      ...access,
      input: { requestId: "privacy-delete-health", toStatus: "completada", reason: "Supresión ejecutada y hashes revisados" },
    })).resolves.toMatchObject({ status: "completada" })
  })

  it("rejects foreign-subject mutations and structurally redacts a reserved case", async () => {
    const { executePreventionPrivacyRight } = await import("@/lib/services/prevention-privacy-rights")
    const common = {
      ctx: { userId: "privacy-manager" },
      scope: { mode: "some" as const, ids: ["ws-privacy"] },
      permissions: ["prevention:privacy:manage_requests", "prevention:reserved_case:investigate"],
    }
    await expect(executePreventionPrivacyRight({
      ...common,
      input: {
        requestId: "privacy-delete-reserved",
        domain: "health_record",
        entityId: "health-foreign-subject",
        operation: "deletion",
        reason: "Intento sobre un registro que no pertenece al titular",
        changes: {},
      },
    })).rejects.toThrow(/no encontrado o fuera de alcance/i)

    await executePreventionPrivacyRight({
      ...common,
      input: {
        requestId: "privacy-delete-reserved",
        domain: "reserved_case",
        entityId: "reserved-privacy",
        operation: "deletion",
        reason: "Redacción nominativa validada preservando la evidencia obligatoria",
        changes: { redactedPayload: { summary: "Evidencia reservada conservada sin identificadores directos" } },
      },
    })
    const db = getDb()
    const [subjectLink] = await db.select().from(schema.preventionReservedCaseSubjects)
      .where(eq(schema.preventionReservedCaseSubjects.caseId, "reserved-privacy"))
    expect(subjectLink?.removedAt).toBeTruthy()
    const [reservedCase] = await db.select().from(schema.preventionReservedCases)
      .where(eq(schema.preventionReservedCases.id, "reserved-privacy"))
    expect(reservedCase?.encryptedPayload).not.toContain("Titular")
  })

  it("validates document-link existence/scope and permits audited re-link after removal", async () => {
    const { createDocumentLink, removeDocumentLink } = await import("@/lib/services/prevention-documents/links")
    const scope = { mode: "some" as const, ids: ["ws-privacy"] }
    const first = await createDocumentLink({
      documentId: "doc-sensitive", entityType: "worker", entityId: "worker-privacy",
      notes: "Titular estructural", userId: "privacy-manager", scope,
    })
    await removeDocumentLink({
      linkId: first.id, reason: "Corrección controlada del vínculo", userId: "privacy-manager", scope,
    })
    await expect(createDocumentLink({
      documentId: "doc-sensitive", entityType: "worker", entityId: "worker-privacy",
      notes: "Vínculo corregido", userId: "privacy-manager", scope,
    })).resolves.toMatchObject({ entityId: "worker-privacy" })
    await expect(createDocumentLink({
      documentId: "doc-sensitive", entityType: "worker", entityId: "worker-missing",
      userId: "privacy-manager", scope,
    })).rejects.toThrow(/no existe/i)
    await expect(createDocumentLink({
      documentId: "doc-sensitive", entityType: "worker", entityId: "worker-privacy-foreign",
      userId: "privacy-manager", scope,
    })).rejects.toThrow(/sin acceso|otra faena/i)
  })

  it("applies one deterministic document regularization and records before/after", async () => {
    const db = getDb()
    const now = new Date().toISOString()
    await db.insert(schema.sstDocuments).values({
      id: "doc-invalid-current", categorySlug: "salud_ocupacional", title: "Documento con referencia inválida",
      worksiteId: "ws-privacy", status: "vigente", confidentiality: "publico_interno", dataClass: "operational",
      currentVersionId: "version-that-does-not-exist", uploadedBy: "privacy-manager", createdAt: now, updatedAt: now,
    })
    const { regularizeDocumentIntegrityFinding } = await import("@/lib/services/prevention-documents/integrity")
    await regularizeDocumentIntegrityFinding({
      documentId: "doc-invalid-current",
      findingCode: "CURRENT_VERSION_MISSING",
      action: "clear_invalid_current_version",
      reason: "Referencia contrastada contra inventario de versiones",
      userId: "privacy-manager",
      scope: { mode: "some", ids: ["ws-privacy"] },
    })
    const [doc] = await db.select().from(schema.sstDocuments).where(eq(schema.sstDocuments.id, "doc-invalid-current"))
    expect(doc).toMatchObject({ status: "borrador", currentVersionId: null })
    const audit = await db.select().from(schema.sstDocumentAudit).where(eq(schema.sstDocumentAudit.documentId, doc!.id))
    expect(audit.some((row) => (row.metadata as { integrityResolution?: boolean })?.integrityResolution)).toBe(true)
  })

  it("relocates a prohibited document, restores its encrypted backup and keeps authorization closed", async () => {
    const db = getDb()
    const sourceName = "clinical-source.pdf"
    const sourceBuffer = Buffer.from("contenido clinico reservado para prueba de respaldo")
    await mkdir(resolveSstDocumentsDir(), { recursive: true })
    await writeFile(path.join(resolveSstDocumentsDir(), sourceName), sourceBuffer)
    const { relocateGeneralDocumentToSensitiveDomain, readPreventionSensitiveFile } = await import("@/lib/services/prevention-sensitive-files")
    const relocation = await relocateGeneralDocumentToSensitiveDomain({
      documentId: "doc-sensitive",
      versionId: "doc-sensitive-v1",
      targetDomain: "health",
      targetEntityId: "health-target",
      reason: "Reubicación histórica autorizada hacia expediente clínico segregado",
      ctx: { userId: "privacy-manager" },
      scope: { mode: "some", ids: ["ws-privacy"] },
      permissions: ["prevention:docs:publish", "prevention:docs:manage_sensitive", "prevention:health:upload_clinical"],
    })
    const [sensitiveFile] = await db.select().from(schema.preventionSensitiveFiles)
      .where(eq(schema.preventionSensitiveFiles.id, relocation.sensitiveFileId))
    expect(sensitiveFile).toBeTruthy()
    const absolutePath = resolvePreventionSensitiveFile(sensitiveFile!.encryptedFilePath)!
    const fileBackup = await readFile(absolutePath)
    expect(fileBackup.includes(sourceBuffer)).toBe(false)
    const metadataBackup = {
      iv: sensitiveFile!.iv,
      authTag: sensitiveFile!.authTag,
      keyVersion: sensitiveFile!.keyVersion,
      encryptedChecksum: sensitiveFile!.encryptedChecksum,
    }

    await unlink(absolutePath)
    await db.update(schema.preventionSensitiveFiles).set({ iv: Buffer.alloc(12).toString("base64") })
      .where(eq(schema.preventionSensitiveFiles.id, sensitiveFile!.id))
    await writeFile(absolutePath, fileBackup, { mode: 0o600 })
    await db.update(schema.preventionSensitiveFiles).set(metadataBackup)
      .where(eq(schema.preventionSensitiveFiles.id, sensitiveFile!.id))

    const restored = await readPreventionSensitiveFile({
      fileId: sensitiveFile!.id,
      purpose: "verificación de restauración cifrada",
      ctx: { userId: "privacy-manager" },
      scope: { mode: "some", ids: ["ws-privacy"] },
      permissions: ["prevention:health:view_clinical"],
    })
    expect(restored.buffer).toEqual(sourceBuffer)
    await expect(readPreventionSensitiveFile({
      fileId: sensitiveFile!.id,
      purpose: "intento sin autorización clínica",
      ctx: { userId: "privacy-outsider" },
      scope: { mode: "some", ids: ["ws-privacy"] },
      permissions: ["prevention:docs:view"],
    })).rejects.toThrow(/no encontrado o fuera de alcance/i)

    const [doc] = await db.select().from(schema.sstDocuments).where(eq(schema.sstDocuments.id, "doc-sensitive"))
    expect(doc).toMatchObject({ status: "archivado", currentVersionId: null })
  })
})

function getDb() {
  if (!testDb) throw new Error("Privacy test database was not initialized")
  return testDb
}

async function seedFixture(db: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await db.insert(schema.worksites).values([
    { id: "ws-privacy", name: "Faena Privacy", code: "PRIV-TEST", createdAt: now, updatedAt: now },
    { id: "ws-privacy-foreign", name: "Faena Foreign", code: "PRIV-FGN", createdAt: now, updatedAt: now },
  ])
  await db.insert(schema.workers).values([
    { id: "worker-privacy", rut: "11.111.111-1", firstName: "Titular", lastName: "Prueba", worksiteId: "ws-privacy", createdAt: now },
    { id: "worker-privacy-foreign", rut: "22.222.222-2", firstName: "Persona", lastName: "Ajena", worksiteId: "ws-privacy-foreign", createdAt: now },
  ])
  await db.insert(schema.users).values([
    { id: "privacy-manager", name: "Privacy Manager", email: "privacy-manager@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "privacy-outsider", name: "Privacy Outsider", email: "privacy-outsider@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
  ])
  await db.insert(schema.preventionHealthRecords).values([
    { id: "health-delete", workerId: "worker-privacy", worksiteId: "ws-privacy", recordType: "examen_ocupacional", status: "vigente", fitnessStatus: "apto_con_restricciones", restrictionsSummary: "restricción de prueba", issuerName: "Clínica", providerName: "Proveedor", createdByUserId: "privacy-manager", createdAt: now, updatedAt: now },
    { id: "health-target", workerId: "worker-privacy", worksiteId: "ws-privacy", recordType: "vigilancia", status: "vigente", fitnessStatus: "apto", createdByUserId: "privacy-manager", createdAt: now, updatedAt: now },
    { id: "health-foreign-subject", workerId: "worker-privacy-foreign", worksiteId: "ws-privacy-foreign", recordType: "aptitud", status: "vigente", fitnessStatus: "apto", createdByUserId: "privacy-manager", createdAt: now, updatedAt: now },
  ])
  const encryptedHealth = encryptPreventionPayload({ diagnosis: "dato que debe purgarse" }, "health:health-delete")
  await db.insert(schema.preventionHealthClinicalPayloads).values({
    id: "clinical-delete", healthRecordId: "health-delete", ...encryptedHealth,
    createdByUserId: "privacy-manager", createdAt: now, updatedAt: now,
  })
  await db.insert(schema.preventionPrivacyRequests).values([
    { id: "privacy-delete-health", subjectWorkerId: "worker-privacy", rightType: "deletion", status: "en_proceso", requestScope: "Suprimir expediente clínico", receivedAt: now, handledByUserId: "privacy-manager", createdByUserId: "privacy-manager", identityVerifiedAt: now, identityVerifiedByUserId: "privacy-manager", createdAt: now, updatedAt: now },
    { id: "privacy-delete-reserved", subjectWorkerId: "worker-privacy", rightType: "deletion", status: "en_proceso", requestScope: "Suprimir vínculo en caso reservado", receivedAt: now, handledByUserId: "privacy-manager", createdByUserId: "privacy-manager", identityVerifiedAt: now, identityVerifiedByUserId: "privacy-manager", createdAt: now, updatedAt: now },
  ])
  const reserved = encryptPreventionPayload({ reporter: "Titular Prueba", testimony: "evidencia" }, "reserved:reserved-privacy")
  await db.insert(schema.preventionReservedCases).values({
    id: "reserved-privacy", code: "RES-PRIVACY", worksiteId: "ws-privacy", category: "ley_karin", status: "abierto",
    ...reserved, createdByUserId: "privacy-manager", createdAt: now, updatedAt: now,
  })
  await db.insert(schema.preventionReservedCaseMembers).values({
    caseId: "reserved-privacy", userId: "privacy-manager", memberRole: "investigador", purpose: "investigación asignada",
    assignedByUserId: "privacy-manager", assignedAt: now,
  })
  await db.insert(schema.preventionReservedCaseSubjects).values({
    id: "subject-link-privacy", caseId: "reserved-privacy", workerId: "worker-privacy", relationship: "titular",
    linkagePurpose: "ejercicio de derechos del titular", linkedByUserId: "privacy-manager", linkedAt: now,
  })
  await db.insert(schema.sstDocumentCategories).values({
    slug: "salud_ocupacional", name: "Salud ocupacional", sortOrder: 1, isActive: true, createdAt: now, updatedAt: now,
  })
  const sourceBuffer = Buffer.from("contenido clinico reservado para prueba de respaldo")
  const sourceChecksum = (await import("node:crypto")).createHash("sha256").update(sourceBuffer).digest("hex")
  await db.insert(schema.sstDocuments).values({
    id: "doc-sensitive", categorySlug: "salud_ocupacional", title: "Ficha clínica histórica", worksiteId: "ws-privacy",
    status: "vigente", confidentiality: "sensible", dataClass: "sensitive_preventive", currentVersionId: "doc-sensitive-v1",
    uploadedBy: "privacy-manager", checksum: sourceChecksum, createdAt: now, updatedAt: now,
  })
  await db.insert(schema.sstDocumentVersions).values({
    id: "doc-sensitive-v1", documentId: "doc-sensitive", version: 1, status: "vigente", fileName: "ficha-clinica.pdf",
    storageName: "clinical-source.pdf", filePath: createSstDocumentPath("clinical-source.pdf"), mimeType: "application/pdf",
    fileSize: sourceBuffer.byteLength, checksum: sourceChecksum, uploadedBy: "privacy-manager", approvedBy: "privacy-manager", approvedAt: now,
    createdAt: now, updatedAt: now,
  })
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

async function resetDatabase(url: string) {
  const setupClient = postgres(url, { max: 1 })
  const setupDb = drizzle(setupClient)
  try {
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await setupDb.execute(sql`CREATE SCHEMA public`)
    await setupDb.execute(sql`CREATE SCHEMA drizzle`)
    await setupDb.execute(sql`GRANT ALL ON SCHEMA public TO PUBLIC`)
  } finally {
    await setupClient.end()
  }
}

async function ensureDatabaseExists(url: string) {
  const databaseName = getDatabaseNameFromUrl(url)
  const maintenanceClient = postgres(getMaintenanceDatabaseUrl(url), { max: 1 })
  try {
    const rows = await maintenanceClient<{ exists: number }[]>`
      SELECT 1 AS exists FROM pg_database WHERE datname = ${databaseName} LIMIT 1
    `
    if (rows.length === 0) await maintenanceClient.unsafe(`CREATE DATABASE ${quotePostgresIdentifier(databaseName)}`)
  } finally {
    await maintenanceClient.end()
  }
}
