/**
 * Ciclo completo del expediente de certificación contra Postgres real
 * (PGlite): crear → declarar lo manual → evaluación en vivo → presentar
 * (congela + abre CAPA por cada brecha, a 60 días) → el expediente presentado
 * ya no cambia aunque los datos subyacentes lo hagan → registrar el resultado
 * de la auditoría fija la vigencia anual.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { todayInChile } from "@/lib/services/prevention-cphs-access"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const ALL: WorksiteScope = { mode: "all", ids: [] }
const OTHER: WorksiteScope = { mode: "some", ids: ["ws-cert-b"] }
const MANAGER = { userId: "u-cert", scope: ALL, permissions: ["prevention:cphs:view", "prevention:cphs:manage", "prevention:cphs:certify"] }
const VIEWER = { userId: "u-cert", scope: ALL, permissions: ["prevention:cphs:view"] }
const OUTSIDER = { userId: "u-cert", scope: OTHER, permissions: ["prevention:cphs:view", "prevention:cphs:certify"] }

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.preventionCapaActions)
  await inMemoryDb.delete(schema.preventionCertificationEvaluations)
  await inMemoryDb.delete(schema.preventionCertificationDossiers)
  await inMemoryDb.delete(schema.preventionCommitteeMembers)
  await inMemoryDb.delete(schema.preventionCommittees)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: "u-cert", name: "Prevencionista", email: "cert@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values([
    { id: "ws-cert-a", name: "Faena Cholguán", code: "CHOL", isActive: true },
    { id: "ws-cert-b", name: "Faena ajena", code: "AJE", isActive: true },
  ])
  await inMemoryDb.insert(schema.workers).values([
    { id: "wk-cert-1", firstName: "Ana", lastName: "Rojas", worksiteId: "ws-cert-a", isActive: true, createdAt: new Date().toISOString() },
    { id: "wk-cert-2", firstName: "Luis", lastName: "Soto", worksiteId: "ws-cert-a", isActive: true, createdAt: new Date().toISOString() },
  ])
  await inMemoryDb.insert(schema.preventionCommittees).values({
    id: "cphs-cert-a", worksiteId: "ws-cert-a", name: "CPHS Cholguán",
    constitutedOn: "2026-01-15", mandateEndsOn: "2028-01-15", createdByUserId: "u-cert",
  })
  // Paridad válida (1 titular por representación) pero sin fuero declarado y
  // sin registro DT: deja brechas reales para que el ciclo tenga algo que
  // presentar, en vez de un expediente artificialmente perfecto.
  await inMemoryDb.insert(schema.preventionCommitteeMembers).values([
    { id: "cphsm-cert-1", committeeId: "cphs-cert-a", workerId: "wk-cert-1", representation: "company", seat: "titular", role: "presidente", status: "active", hasFuero: false },
    { id: "cphsm-cert-2", committeeId: "cphs-cert-a", workerId: "wk-cert-2", representation: "workers", seat: "titular", role: "secretario", status: "active", hasFuero: false },
  ])
})

describe("expediente de certificación · ciclo completo", () => {
  it("crea el expediente en preparación y rechaza un nivel duplicado en el mismo período", async () => {
    const { createCertificationDossier } = await import("@/lib/services/prevention-cphs-certification")
    const dossier = await createCertificationDossier({ committeeId: "cphs-cert-a", level: "bronce", periodYear: 2026 }, MANAGER)
    expect(dossier.status).toBe("draft")

    await expect(createCertificationDossier({ committeeId: "cphs-cert-a", level: "bronce", periodYear: 2026 }, MANAGER))
      .rejects.toThrow(/ya existe un expediente/i)
  })

  it("la evaluación en vivo refleja el estado real del comité", async () => {
    const { createCertificationDossier, getCertificationDossier } = await import("@/lib/services/prevention-cphs-certification")
    const dossier = await createCertificationDossier({ committeeId: "cphs-cert-a", level: "bronce", periodYear: 2026 }, MANAGER)

    const status = await getCertificationDossier(dossier.id, MANAGER)
    expect(status?.frozen).toBe(false)
    expect(status?.requirements.find((r) => r.code === "committee_constituted")).toMatchObject({ status: "met" })
    expect(status?.requirements.find((r) => r.code === "fuero_declared")).toMatchObject({ status: "not_met" })
    expect(status?.requirements.find((r) => r.code === "dt_registered")).toMatchObject({ status: "not_met" })
    // Sin eventos en el período, la investigación se da por cumplida.
    expect(status?.requirements.find((r) => r.code === "event_investigation")).toMatchObject({ status: "met" })
  })

  it("un requisito manual exige evidencia, la muestra y cambia la versión del expediente", async () => {
    const { createCertificationDossier, getCertificationDossier, recordManualEvaluation } = await import("@/lib/services/prevention-cphs-certification")
    const dossier = await createCertificationDossier({ committeeId: "cphs-cert-a", level: "bronce", periodYear: 2026 }, MANAGER)

    await expect(recordManualEvaluation({
      dossierId: dossier.id, requirementCode: "serious_risk_communication",
      expectedVersion: dossier.version,
      status: "met", detail: "Procedimiento DO-12 difundido en la sesión de marzo.",
    }, MANAGER)).rejects.toThrow(/evidencia/i)

    await recordManualEvaluation({
      dossierId: dossier.id, requirementCode: "serious_risk_communication",
      expectedVersion: dossier.version,
      status: "met", detail: "Procedimiento DO-12 difundido en la sesión de marzo.",
      evidenceReference: "DOC-SST-2026-0042",
    }, MANAGER)

    const status = await getCertificationDossier(dossier.id, MANAGER)
    expect(status?.dossier.version).toBe(dossier.version + 1)
    expect(status?.requirements.find((r) => r.code === "serious_risk_communication")).toMatchObject({
      status: "met",
      evidenceReference: "DOC-SST-2026-0042",
    })

    const { submitCertificationDossier } = await import("@/lib/services/prevention-cphs-certification")
    await expect(submitCertificationDossier({ dossierId: dossier.id, expectedVersion: dossier.version }, MANAGER))
      .rejects.toThrow(/cambió/i)
  })

  it("un requisito automático no admite declaración manual", async () => {
    const { createCertificationDossier, recordManualEvaluation } = await import("@/lib/services/prevention-cphs-certification")
    const dossier = await createCertificationDossier({ committeeId: "cphs-cert-a", level: "bronce", periodYear: 2026 }, MANAGER)

    await expect(recordManualEvaluation({
      dossierId: dossier.id, expectedVersion: dossier.version,
      requirementCode: "dt_registered", status: "met", detail: "Intento de forzarlo a mano.",
    }, MANAGER)).rejects.toThrow(/no admite declaración manual/i)
  })

  it("presentar congela el snapshot y abre una CAPA por cada brecha a 60 días", async () => {
    const { db } = await import("@/db")
    const { createCertificationDossier, getCertificationDossier, submitCertificationDossier } = await import("@/lib/services/prevention-cphs-certification")
    const dossier = await createCertificationDossier({ committeeId: "cphs-cert-a", level: "bronce", periodYear: 2026 }, MANAGER)

    const before = await getCertificationDossier(dossier.id, MANAGER)
    const expectedGaps = before!.requirements.filter((r) => r.status === "not_met").length
    expect(expectedGaps).toBeGreaterThan(0) // el fixture está diseñado para dejar brechas reales

    // El servicio calcula el plazo desde `todayInChile()`, no desde UTC: usar
    // la misma fuente evita que el test falle sólo por la diferencia horaria
    // entre Chile y UTC en ciertos tramos del día.
    const today = todayInChile()
    const expectedDeadline = new Date(`${today}T00:00:00.000Z`)
    expectedDeadline.setUTCDate(expectedDeadline.getUTCDate() + 60)

    const submitted = await submitCertificationDossier({ dossierId: dossier.id, expectedVersion: dossier.version }, MANAGER)
    expect(submitted.status).toBe("submitted")
    expect(submitted.version).toBe(dossier.version + 1)
    expect(submitted.gapsDeadlineOn).toBe(expectedDeadline.toISOString().slice(0, 10))

    const capaRows = await db.select().from(schema.preventionCapaActions)
      .where(and(eq(schema.preventionCapaActions.sourceType, "cphs"), eq(schema.preventionCapaActions.sourceId, dossier.id)))
    expect(capaRows).toHaveLength(expectedGaps)
    for (const capa of capaRows) {
      expect(capa.targetDate).toBe(submitted.gapsDeadlineOn)
      expect(capa.worksiteId).toBe("ws-cert-a")
    }

    const after = await getCertificationDossier(dossier.id, MANAGER)
    expect(after?.frozen).toBe(true)
    expect(after?.gaps).toHaveLength(expectedGaps)
    expect(after?.gaps.every((gap) => gap.capaActionId !== null)).toBe(true)
  })

  it("un expediente presentado no cambia aunque el comité cambie después", async () => {
    const { createCertificationDossier, getCertificationDossier, submitCertificationDossier } = await import("@/lib/services/prevention-cphs-certification")
    const dossier = await createCertificationDossier({ committeeId: "cphs-cert-a", level: "bronce", periodYear: 2026 }, MANAGER)
    await submitCertificationDossier({ dossierId: dossier.id, expectedVersion: dossier.version }, MANAGER)
    const frozen = await getCertificationDossier(dossier.id, MANAGER)
    const frozenDetail = frozen?.requirements.find((r) => r.code === "dt_registered")?.detail

    // Registrar el DT después de presentar no debe alterar lo ya congelado.
    await inMemoryDb.update(schema.preventionCommittees).set({
      dtRegisteredOn: "2026-06-01", dtRegistrationReference: "DT-9999",
    }).where(eq(schema.preventionCommittees.id, "cphs-cert-a"))

    const stillFrozen = await getCertificationDossier(dossier.id, MANAGER)
    expect(stillFrozen?.requirements.find((r) => r.code === "dt_registered")).toMatchObject({ status: "not_met" })
    expect(stillFrozen?.requirements.find((r) => r.code === "dt_registered")?.detail).toBe(frozenDetail)
  })

  it("no se puede presentar dos veces ni con una versión vieja", async () => {
    const { createCertificationDossier, submitCertificationDossier } = await import("@/lib/services/prevention-cphs-certification")
    const dossier = await createCertificationDossier({ committeeId: "cphs-cert-a", level: "bronce", periodYear: 2026 }, MANAGER)
    await submitCertificationDossier({ dossierId: dossier.id, expectedVersion: dossier.version }, MANAGER)

    await expect(submitCertificationDossier({ dossierId: dossier.id, expectedVersion: dossier.version }, MANAGER))
      .rejects.toThrow(/ya fue presentado/i)
  })

  it("registrar el resultado de la auditoría fija la vigencia anual", async () => {
    const { createCertificationDossier, submitCertificationDossier, recordAuditResult } = await import("@/lib/services/prevention-cphs-certification")
    const dossier = await createCertificationDossier({ committeeId: "cphs-cert-a", level: "bronce", periodYear: 2026 }, MANAGER)
    const submitted = await submitCertificationDossier({ dossierId: dossier.id, expectedVersion: dossier.version }, MANAGER)

    const certified = await recordAuditResult({
      dossierId: dossier.id, expectedVersion: submitted.version,
      outcome: "certified", auditedOn: "2026-09-01", auditResult: "Cumple lo presentado, sin observaciones adicionales.",
    }, MANAGER)
    expect(certified.status).toBe("certified")
    expect(certified.validUntilOn).toBe("2027-09-01")
  })

  it("un rechazo no fija vigencia", async () => {
    const { createCertificationDossier, submitCertificationDossier, recordAuditResult } = await import("@/lib/services/prevention-cphs-certification")
    const dossier = await createCertificationDossier({ committeeId: "cphs-cert-a", level: "bronce", periodYear: 2026 }, MANAGER)
    const submitted = await submitCertificationDossier({ dossierId: dossier.id, expectedVersion: dossier.version }, MANAGER)

    const rejected = await recordAuditResult({
      dossierId: dossier.id, expectedVersion: submitted.version,
      outcome: "rejected", auditedOn: "2026-09-01", auditResult: "Brechas insuficientemente cerradas al momento de auditar.",
    }, MANAGER)
    expect(rejected.status).toBe("rejected")
    expect(rejected.validUntilOn).toBeNull()
  })

  it("no se puede auditar un expediente que sigue en preparación", async () => {
    const { createCertificationDossier, recordAuditResult } = await import("@/lib/services/prevention-cphs-certification")
    const dossier = await createCertificationDossier({ committeeId: "cphs-cert-a", level: "bronce", periodYear: 2026 }, MANAGER)

    await expect(recordAuditResult({
      dossierId: dossier.id, expectedVersion: dossier.version,
      outcome: "certified", auditedOn: "2026-09-01", auditResult: "Auditoría anticipada.",
    }, MANAGER)).rejects.toThrow(/expediente presentado/i)
  })

  it("niega el expediente de una faena fuera de alcance sin filtrar su existencia", async () => {
    const { createCertificationDossier } = await import("@/lib/services/prevention-cphs-certification")
    await expect(createCertificationDossier({ committeeId: "cphs-cert-a", level: "bronce", periodYear: 2027 }, OUTSIDER))
      .rejects.toThrow(/no encontrado o fuera de alcance/i)
  })

  it("un lector sin permiso de certificar no puede crear ni presentar", async () => {
    const { createCertificationDossier } = await import("@/lib/services/prevention-cphs-certification")
    await expect(createCertificationDossier({ committeeId: "cphs-cert-a", level: "bronce", periodYear: 2027 }, VIEWER))
      .rejects.toThrow(/no encontrado o fuera de alcance/i)
  })
})
