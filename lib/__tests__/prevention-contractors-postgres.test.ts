/** Real PostgreSQL proof for DS 76 contractor accreditation, site access and coordination. */
import path from "node:path"
import postgres from "postgres"
import { and, eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import {
  assertSafeDestructiveDatabase,
  getDatabaseNameFromUrl,
  getMaintenanceDatabaseUrl,
  quotePostgresIdentifier,
} from "@/lib/testing/destructive-database-guard"

const databaseUrl = process.env.PREVENTION_CONTRACTORS_DATABASE_URL
const canReset = process.env.PREVENTION_CONTRACTORS_ALLOW_DESTRUCTIVE_RESET === "true"
const describeIf = databaseUrl && canReset ? describe : describe.skip
const previousDatabaseUrl = process.env.DATABASE_URL
let client: postgres.Sql | undefined
let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined

const scopeA = { mode: "some", ids: ["ws-co-a"] } as WorksiteScope
const ALL_PERMS = [
  "prevention:contractors:view", "prevention:contractors:manage", "prevention:contractors:submit",
  "prevention:contractors:accredit", "prevention:contractors:authorize_access", "prevention:contractors:coordinate",
]
const MANAGER = { userId: "co-manager", scope: scopeA, permissions: ["prevention:contractors:view", "prevention:contractors:manage", "prevention:contractors:submit"] }
const ACCREDITOR = { userId: "co-accreditor", scope: scopeA, permissions: ["prevention:contractors:view", "prevention:contractors:accredit", "prevention:contractors:authorize_access", "prevention:contractors:coordinate", "prevention:contractors:manage"] }
const OUTSIDER = { userId: "co-outsider", scope: { mode: "some", ids: ["ws-co-b"] } as WorksiteScope, permissions: ALL_PERMS }

function getDb() {
  if (!testDb) throw new Error("Test database not initialised")
  return testDb
}

describeIf("Contratistas DS 76 on real PostgreSQL", () => {
  let companyId = ""
  let contractId = ""
  let contractVersion = 1
  let workerId = ""
  let contractReqId = ""
  let workerReqId = ""

  beforeAll(async () => {
    assertSafeDestructiveDatabase({ databaseUrl: databaseUrl!, allowDestructiveReset: canReset, context: "PREVENTION_CONTRACTORS" })
    await ensureDatabaseExists(databaseUrl!)
    await resetDatabase(databaseUrl!)
    const migrationClient = postgres(databaseUrl!, { max: 1, onnotice: () => undefined })
    await migrate(drizzle(migrationClient), { migrationsFolder: path.resolve(process.cwd(), "db/migrations") })
    await migrationClient.end()
    client = postgres(databaseUrl!, { max: 10, onnotice: () => undefined })
    testDb = drizzle(client, { schema })
    ;(globalThis as typeof globalThis & { __db?: typeof testDb }).__db = testDb
    process.env.DATABASE_URL = databaseUrl
    vi.resetModules()
    await seedFixture(getDb())
  }, 60_000)

  afterAll(async () => {
    ;(globalThis as typeof globalThis & { __db?: unknown }).__db = undefined
    await client?.end()
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
  })

  it("registers a company and a contract that starts with access blocked", async () => {
    const service = await import("@/lib/services/prevention-contractors")
    const company = await service.createContractorCompany({
      rut: "76123456-7", legalName: "Servicios Industriales Norte SpA",
      insuranceAdministrator: "Mutual de Seguridad", contactEmail: "contacto@ejemplo.invalid",
    }, MANAGER)
    companyId = company.id

    const contract = await service.createContractorContract({
      code: "CT-2026-001", companyId, worksiteId: "ws-co-a", relationship: "contractor",
      scope: "Mantención de líneas de clasificación de residuos industriales.",
      startsOn: "2026-08-01", plannedHeadcount: 12,
    }, MANAGER)
    contractId = contract.id
    contractVersion = contract.version
    // El DS 76 pone la verificación documental antes del ingreso.
    expect(contract).toMatchObject({ status: "draft", accessBlocked: true })
  })

  it("denies contract creation from a foreign worksite scope", async () => {
    const service = await import("@/lib/services/prevention-contractors")
    await expect(service.createContractorContract({
      code: "CT-2026-999", companyId, worksiteId: "ws-co-a", relationship: "contractor",
      scope: "Intento de crear contrato en faena ajena al alcance.",
      startsOn: "2026-08-01",
    }, OUTSIDER)).rejects.toThrow(/fuera de alcance/)
  })

  it("creates blocking requirements at contract and worker level", async () => {
    const service = await import("@/lib/services/prevention-contractors")
    const contractReq = await service.createAccreditationRequirement({
      code: "F30-1", name: "Certificado F30-1 de cumplimiento laboral y previsional",
      appliesTo: "contract", enforcement: "blocking", requiresExpiry: true,
      legalBasis: "Ley 20.123 y DS 76: acreditación de cumplimiento de la empresa contratista.",
    }, MANAGER)
    contractReqId = contractReq.id

    const workerReq = await service.createAccreditationRequirement({
      code: "ODI-CONTR", name: "Obligación de informar riesgos laborales",
      appliesTo: "worker", enforcement: "blocking", requiresExpiry: false,
      legalBasis: "DS 44 art. 15: informar riesgos antes del inicio de labores.",
    }, MANAGER)
    workerReqId = workerReq.id
  })

  it("registers a contractor worker as pending and blocked", async () => {
    const service = await import("@/lib/services/prevention-contractors")
    const worker = await service.registerContractorWorker({
      contractId, rut: "15111222-3", firstName: "Ana", lastName: "Pérez", position: "Mantenedora mecánica",
    }, MANAGER)
    workerId = worker.id
    expect(worker).toMatchObject({ status: "pending", accessBlocked: true })
  })

  it("reports blocking gaps for both the contract and the worker", async () => {
    const service = await import("@/lib/services/prevention-contractors")
    const gaps = await service.listAccreditationGaps(MANAGER)
    expect(gaps).toHaveLength(2)
    expect(gaps.every((gap) => gap.enforcement === "blocking" && gap.gapType === "missing")).toBe(true)
  })

  it("refuses to release site access while blocking gaps remain", async () => {
    const service = await import("@/lib/services/prevention-contractors")
    const activated = await service.transitionContractStatus({
      contractId, expectedVersion: contractVersion, toStatus: "active",
      reason: "Contrato firmado y vigente desde el 1 de agosto.",
    }, MANAGER)
    contractVersion = activated.version

    await expect(service.releaseContractAccess({
      contractId, expectedVersion: contractVersion,
      reason: "Intento de liberar el ingreso con acreditación incompleta.",
    }, ACCREDITOR)).rejects.toThrow(/requisito\(s\) bloqueante/)
  })

  it("rejects evidence that omits a required expiry date", async () => {
    const service = await import("@/lib/services/prevention-contractors")
    await expect(service.submitAccreditationItem({
      requirementId: contractReqId, contractId, documentReference: "f30-1-julio.pdf",
    }, MANAGER)).rejects.toThrow(/fecha de vencimiento/)
  })

  it("rejects a worker-scoped requirement submitted without a person", async () => {
    const service = await import("@/lib/services/prevention-contractors")
    await expect(service.submitAccreditationItem({
      requirementId: workerReqId, contractId, documentReference: "odi.pdf",
    }, MANAGER)).rejects.toThrow(/por persona/)
  })

  it("blocks the submitter from approving their own evidence", async () => {
    const service = await import("@/lib/services/prevention-contractors")
    const item = await service.submitAccreditationItem({
      requirementId: contractReqId, contractId,
      documentReference: "f30-1-julio.pdf", issuedOn: "2026-07-01", expiresOn: "2026-12-31",
    }, MANAGER)
    expect(item.status).toBe("submitted")

    const selfReviewer = { ...MANAGER, permissions: [...MANAGER.permissions, "prevention:contractors:accredit"] }
    await expect(service.reviewAccreditationItem({
      itemId: item.id, decision: "approved", expectedVersion: item.version,
    }, selfReviewer)).rejects.toThrow(/no puede aprobarla/)

    const approved = await service.reviewAccreditationItem({
      itemId: item.id, decision: "approved", expectedVersion: item.version,
    }, ACCREDITOR)
    expect(approved).toMatchObject({ status: "approved", reviewedByUserId: "co-accreditor" })
  })

  it("keeps the contract blocked while the worker requirement is still missing", async () => {
    const service = await import("@/lib/services/prevention-contractors")
    const gaps = await service.listAccreditationGaps(MANAGER)
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({ contractorWorkerId: workerId, requirementCode: "ODI-CONTR" })

    // La brecha es de una persona, no del contrato: el contrato ya puede
    // liberarse y esa persona queda bloqueada individualmente.
    const released = await service.releaseContractAccess({
      contractId, expectedVersion: contractVersion,
      reason: "Acreditación de empresa completa y verificada por jefatura.",
    }, ACCREDITOR)
    contractVersion = released.version
    expect(released.accessBlocked).toBe(false)

    const [worker] = await getDb().select().from(schema.preventionContractorWorkers)
      .where(eq(schema.preventionContractorWorkers.id, workerId))
    expect(worker).toMatchObject({ status: "pending", accessBlocked: true })
  })

  it("accredits the worker once their own evidence is approved", async () => {
    const service = await import("@/lib/services/prevention-contractors")
    const item = await service.submitAccreditationItem({
      requirementId: workerReqId, contractId, contractorWorkerId: workerId,
      documentReference: "odi-ana-perez.pdf", issuedOn: "2026-07-15",
    }, MANAGER)
    await service.reviewAccreditationItem({ itemId: item.id, decision: "approved", expectedVersion: item.version }, ACCREDITOR)

    expect(await service.listAccreditationGaps(MANAGER)).toEqual([])

    const released = await service.releaseContractAccess({
      contractId, expectedVersion: contractVersion,
      reason: "Acreditación completa de empresa y personas verificada.",
    }, ACCREDITOR)
    contractVersion = released.version
    const [worker] = await getDb().select().from(schema.preventionContractorWorkers)
      .where(eq(schema.preventionContractorWorkers.id, workerId))
    expect(worker).toMatchObject({ status: "accredited", accessBlocked: false })
  })

  it("observing evidence reopens the gap and requires a comment", async () => {
    const service = await import("@/lib/services/prevention-contractors")
    const resubmitted = await service.submitAccreditationItem({
      requirementId: contractReqId, contractId,
      documentReference: "f30-1-agosto.pdf", issuedOn: "2026-08-01", expiresOn: "2027-01-31",
    }, MANAGER)
    // Reenviar limpia la aprobación anterior: nadie hereda una revisión vieja.
    expect(resubmitted).toMatchObject({ status: "submitted", reviewedByUserId: null })

    await expect(service.reviewAccreditationItem({
      itemId: resubmitted.id, decision: "observed", expectedVersion: resubmitted.version,
    }, ACCREDITOR)).rejects.toThrow()

    const observed = await service.reviewAccreditationItem({
      itemId: resubmitted.id, decision: "observed", observation: "El certificado no cubre a la totalidad de la dotación declarada.",
      expectedVersion: resubmitted.version,
    }, ACCREDITOR)
    expect(observed.status).toBe("observed")
    const gaps = await service.listAccreditationGaps(MANAGER)
    expect(gaps.find((gap) => gap.requirementCode === "F30-1")?.gapType).toBe("observed")
  })

  it("expires lapsed evidence and re-blocks the contract", async () => {
    const service = await import("@/lib/services/prevention-contractors")
    const [item] = await getDb().select().from(schema.preventionAccreditationItems)
      .where(and(
        eq(schema.preventionAccreditationItems.requirementId, workerReqId),
        eq(schema.preventionAccreditationItems.contractId, contractId),
      ))
    // El constraint impide un vencimiento anterior a la emisión, así que se
    // retrocede el par completo para simular un documento ya caducado.
    await getDb().update(schema.preventionAccreditationItems)
      .set({ issuedOn: "2019-01-01", expiresOn: "2020-01-01" })
      .where(eq(schema.preventionAccreditationItems.id, item!.id))

    const result = await service.expireLapsedAccreditations()
    expect(result.expired).toBe(1)

    const [contract] = await getDb().select().from(schema.preventionContractorContracts)
      .where(eq(schema.preventionContractorContracts.id, contractId))
    expect(contract).toMatchObject({ accessBlocked: true })
    expect(contract!.accessBlockReason).toMatch(/vencida/)
  })

  it("does not leak contracts or gaps of another worksite", async () => {
    const service = await import("@/lib/services/prevention-contractors")
    // OUTSIDER sólo alcanza ws-co-b: ve su propio contrato sembrado y nunca el
    // de ws-co-a, ni por listado, ni por brechas, ni por detalle directo.
    const visible = await service.listContractorContracts(OUTSIDER)
    expect(visible.map((row) => row.contract.worksiteId)).toEqual(["ws-co-b"])
    expect(visible.some((row) => row.contract.id === contractId)).toBe(false)
    expect((await service.listAccreditationGaps(OUTSIDER)).every((gap) => gap.worksiteId === "ws-co-b")).toBe(true)
    expect(await service.getContractorContractDetail(contractId, OUTSIDER)).toBeNull()
  })

  it("suspending a contract cuts site access in the same act", async () => {
    const service = await import("@/lib/services/prevention-contractors")
    const [before] = await getDb().select().from(schema.preventionContractorContracts)
      .where(eq(schema.preventionContractorContracts.id, contractId))
    const suspended = await service.transitionContractStatus({
      contractId, expectedVersion: before!.version, toStatus: "suspended",
      reason: "Incumplimiento crítico detectado en inspección de coordinación.",
    }, MANAGER)
    expect(suspended).toMatchObject({ status: "suspended", accessBlocked: true })
    const workers = await getDb().select().from(schema.preventionContractorWorkers)
      .where(eq(schema.preventionContractorWorkers.contractId, contractId))
    expect(workers.every((worker) => worker.accessBlocked)).toBe(true)
  })

  it("closes a coordination meeting deriving every agreement to CAPA", async () => {
    const service = await import("@/lib/services/prevention-contractors")
    const meeting = await service.createCoordinationMeeting({
      worksiteId: "ws-co-a", heldAt: "2026-08-05T14:00:00.000Z",
      subject: "Coordinación preventiva mensual DS 76",
      agenda: "Intercambio de riesgos, procedimientos de emergencia y control de accesos.",
      attendees: [{ name: "Jefatura Chome", organization: "Chome", role: "Empresa principal" }, { name: "Supervisor contratista", organization: "Servicios Industriales Norte SpA" }],
      contractIds: [contractId],
      riskExchangeSummary: "Se entregó MIPER vigente y plan de emergencia de la faena.",
    }, ACCREDITOR)
    expect(meeting.status).toBe("planned")

    const closed = await service.closeCoordinationMeeting({
      meetingId: meeting.id, expectedVersion: meeting.version,
      minutes: "Se acordó reforzar el control de acceso y actualizar la matriz de riesgos compartida.",
      attendedContractIds: [contractId],
      agreements: [
        { finding: "Control de acceso sin verificación de acreditación vigente", actionDescription: "Implementar verificación en portería contra el estado de acreditación", priority: "high", targetDate: "2026-09-15" },
        { finding: "Plan de emergencia del contratista desactualizado", actionDescription: "Actualizar y difundir el plan de emergencia conjunto", priority: "medium", targetDate: "2026-09-30" },
      ],
    }, ACCREDITOR)
    expect(closed.agreementsCreated).toBe(2)

    const actions = await getDb().select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.sourceType, "contractor"))
    expect(actions).toHaveLength(2)
    expect(actions.every((action) => action.sourceId === meeting.id && action.worksiteId === "ws-co-a")).toBe(true)

    const [participant] = await getDb().select().from(schema.preventionCoordinationParticipants)
      .where(eq(schema.preventionCoordinationParticipants.meetingId, meeting.id))
    expect(participant?.attended).toBe(true)

    await expect(service.closeCoordinationMeeting({
      meetingId: meeting.id, expectedVersion: closed.meeting.version,
      minutes: "Intento de cerrar dos veces la misma acta.", attendedContractIds: [], agreements: [],
    }, ACCREDITOR)).rejects.toThrow(/ya fue cerrada/)
  })

  it("refuses to convene a contract from another worksite", async () => {
    const service = await import("@/lib/services/prevention-contractors")
    await expect(service.createCoordinationMeeting({
      worksiteId: "ws-co-a", heldAt: "2026-08-06T14:00:00.000Z",
      subject: "Coordinación con contrato de otra faena",
      agenda: "Intento de convocar a un contrato que no pertenece a esta faena.",
      attendees: [{ name: "Jefatura", organization: "Chome" }],
      contractIds: [foreignContractId],
    }, ACCREDITOR)).rejects.toThrow(/otra faena/)
  })
})

let foreignContractId = ""

async function seedFixture(database: ReturnType<typeof drizzle<typeof schema>>) {
  const now = new Date().toISOString()
  await database.insert(schema.worksites).values([
    { id: "ws-co-a", name: "Faena Norte", code: "CO-A", createdAt: now, updatedAt: now },
    { id: "ws-co-b", name: "Faena Sur", code: "CO-B", createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.users).values([
    { id: "co-manager", name: "Gestor contratos", email: "co-manager@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "co-accreditor", name: "Acreditador", email: "co-accreditor@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
    { id: "co-outsider", name: "Ajeno", email: "co-outsider@local.invalid", hashedPassword: "hash", createdAt: now, updatedAt: now },
  ])
  await database.insert(schema.preventionContractorCompanies).values({
    id: "cocomp-foreign", rut: "77999888-1", legalName: "Contratista Faena Sur Ltda",
    createdByUserId: "co-manager", createdAt: now, updatedAt: now,
  })
  foreignContractId = "cocont-foreign"
  await database.insert(schema.preventionContractorContracts).values({
    id: foreignContractId, code: "CT-SUR-001", companyId: "cocomp-foreign", worksiteId: "ws-co-b",
    relationship: "contractor", scope: "Contrato de otra faena para pruebas de alcance.",
    startsOn: "2026-08-01", status: "active", accessBlocked: true,
    createdByUserId: "co-manager", createdAt: now, updatedAt: now,
  })
}

async function resetDatabase(url: string) {
  const setupClient = postgres(url, { max: 1, onnotice: () => undefined })
  const setupDb = drizzle(setupClient)
  try {
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await setupDb.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await setupDb.execute(sql`CREATE SCHEMA public`)
    await setupDb.execute(sql`GRANT ALL ON SCHEMA public TO PUBLIC`)
  } finally { await setupClient.end() }
}

async function ensureDatabaseExists(url: string) {
  const databaseName = getDatabaseNameFromUrl(url)
  const maintenanceClient = postgres(getMaintenanceDatabaseUrl(url), { max: 1, onnotice: () => undefined })
  try {
    const rows = await maintenanceClient<{ exists: number }[]>`SELECT 1 AS exists FROM pg_database WHERE datname = ${databaseName} LIMIT 1`
    if (rows.length === 0) await maintenanceClient.unsafe(`CREATE DATABASE ${quotePostgresIdentifier(databaseName)}`)
  } finally { await maintenanceClient.end() }
}
