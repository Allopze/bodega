/**
 * Patrón P3 (auditoría 2026-09-14): tres vencimientos con consecuencia legal
 * que no avisaban a nadie y dependían de que alguien abriera la pantalla
 * correcta — `FLO-002` (documentos del vehículo), `MIP-001` (revisión de la
 * MIPER) y `PRI-001` (solicitud de derechos del titular).
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
// El correo no es lo que se está probando: interesa la notificación en base.
vi.mock("@/lib/email/smtp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/smtp")>()),
  sendEmail: vi.fn(async () => {}),
  sendBatchEmails: vi.fn(async () => {}),
}))

const { runDeadlineReminders, DEADLINE_WARNING_DAYS } =
  await import("@/lib/services/deadline-reminders")

const WS = "ws-dl-1"
const RESPONSABLE = "user-dl-flota"
const PREVENCION = "user-dl-prev"
const PRIVACIDAD = "user-dl-priv"
const AJENO = "user-dl-ajeno"
const NOW = new Date("2026-09-14T12:00:00.000Z")

const inDays = (days: number) =>
  new Date(NOW.getTime() + days * 86_400_000)
const plainDate = (days: number) => inDays(days).toISOString().slice(0, 10)

async function grant(userId: string, permissionName: string) {
  const [perm] = await testDb.select({ id: schema.permissions.id })
    .from(schema.permissions).where(eq(schema.permissions.name, permissionName))
  const id = perm?.id ?? nanoid()
  if (!perm) {
    await testDb.insert(schema.permissions).values({
      id, name: permissionName, module: permissionName.split(":")[0]!, description: permissionName,
    })
  }
  await testDb.insert(schema.userPermissions).values({ userId, permissionId: id }).onConflictDoNothing()
}

const notifications = async () =>
  testDb.select().from(schema.notifications)

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values([
    { id: RESPONSABLE, name: "Flota", email: "flota@dl.cl", hashedPassword: "x", isActive: true },
    { id: PREVENCION, name: "Prevención", email: "prev@dl.cl", hashedPassword: "x", isActive: true },
    { id: PRIVACIDAD, name: "Privacidad", email: "priv@dl.cl", hashedPassword: "x", isActive: true },
    { id: AJENO, name: "Ajeno", email: "ajeno@dl.cl", hashedPassword: "x", isActive: true },
  ])
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena Plazos", code: "DL", isActive: true })
  await testDb.insert(schema.worksiteUsers).values([
    { userId: RESPONSABLE, worksiteId: WS },
    { userId: PREVENCION, worksiteId: WS },
  ])
  await grant(RESPONSABLE, "flota:manage_documents")
  await grant(PREVENCION, "prevention:risk:edit")
  await grant(PRIVACIDAD, "prevention:privacy:manage_requests")

  const [tipo] = await testDb.select({ id: schema.fuelEquipmentTypes.id })
    .from(schema.fuelEquipmentTypes).limit(1)
  if (tipo) {
    equipmentTypeId = tipo.id
  } else {
    equipmentTypeId = "eqt-dl-1"
    await testDb.insert(schema.fuelEquipmentTypes).values({
      id: equipmentTypeId, slug: `dl-${nanoid(6).toLowerCase()}`, name: "Camioneta de prueba",
    })
  }
})

beforeEach(async () => {
  await testDb.delete(schema.notifications)
  await testDb.delete(schema.fleetVehicleDocuments)
  await testDb.delete(schema.fuelVehicles)
  await testDb.delete(schema.preventionRiskReviewTriggers)
  await testDb.delete(schema.preventionPrivacyRequests)
})

/**
 * El catálogo de tipos de equipo lo siembran las migraciones: se reutiliza uno
 * existente en vez de insertar otro, que chocaría por `slug`.
 */
let equipmentTypeId = ""

async function seedVehicleDocument(options: {
  expiresInDays: number
  documentType?: string
  status?: string
}) {
  const vehicleId = nanoid()
  await testDb.insert(schema.fuelVehicles).values({
    id: vehicleId, plate: `PL-${nanoid(6).toUpperCase()}`, code: "KA-63",
    type: "camioneta", equipmentTypeId: equipmentTypeId, worksiteId: WS,
  })
  const docId = nanoid()
  await testDb.insert(schema.fleetVehicleDocuments).values({
    id: docId, vehicleId, documentType: options.documentType ?? "revision_tecnica",
    fileName: "rt.pdf", filePath: "storage/rt.pdf", uploadedBy: RESPONSABLE,
    expiresAt: plainDate(options.expiresInDays),
    status: options.status ?? "current",
  })
  return { vehicleId, docId }
}

describe("FLO-002 — documentos legales del vehículo", () => {
  it("avisa a quien gestiona documentos de esa faena cuando falta poco", async () => {
    await seedVehicleDocument({ expiresInDays: 10 })
    const result = await runDeadlineReminders(NOW)

    expect(result.fleetDocuments).toBe(1)
    const avisos = await notifications()
    expect(avisos).toHaveLength(1)
    expect(avisos[0]!.userId).toBe(RESPONSABLE)
    expect(avisos[0]!.type).toBe("fleet_document_due_soon")
    expect(avisos[0]!.title).toContain("KA-63")
    expect(avisos[0]!.title).toContain("revisión técnica")
  })

  it("un documento vencido se distingue del que está por vencer", async () => {
    await seedVehicleDocument({ expiresInDays: -3 })
    await runDeadlineReminders(NOW)
    const [aviso] = await notifications()
    expect(aviso?.type).toBe("fleet_document_overdue")
    expect(aviso?.body).toContain("no puede circular")
  })

  it("no avisa por algo que vence más allá de la ventana", async () => {
    await seedVehicleDocument({ expiresInDays: DEADLINE_WARNING_DAYS + 5 })
    const result = await runDeadlineReminders(NOW)
    expect(result.fleetDocuments).toBe(0)
    expect(await notifications()).toEqual([])
  })

  it("una versión reemplazada no reclama: para eso se renovó", async () => {
    await seedVehicleDocument({ expiresInDays: -100, status: "replaced" })
    expect((await runDeadlineReminders(NOW)).fleetDocuments).toBe(0)
  })

  it("correr dos veces el mismo día no repite el aviso", async () => {
    await seedVehicleDocument({ expiresInDays: 5 })
    await runDeadlineReminders(NOW)
    await runDeadlineReminders(NOW)
    expect(await notifications()).toHaveLength(1)
  })
})

describe("MIP-001 — revisión de la matriz de riesgos", () => {
  async function seedTrigger(dueInDays: number, status = "pending") {
    const id = nanoid()
    await testDb.insert(schema.preventionRiskReviewTriggers).values({
      id, idempotencyKey: id, worksiteId: WS, triggerType: "annual",
      sourceType: "matrix", sourceId: nanoid(),
      description: "Revisión anual de la MIPER", status,
      dueAt: plainDate(dueInDays),
    })
    return id
  }

  it("avisa al equipo de prevención de la faena", async () => {
    await seedTrigger(7)
    const result = await runDeadlineReminders(NOW)
    expect(result.riskReviews).toBe(1)
    const [aviso] = await notifications()
    expect(aviso?.userId).toBe(PREVENCION)
    expect(aviso?.type).toBe("risk_review_due_soon")
  })

  it("un disparador ya resuelto no reclama", async () => {
    await seedTrigger(-10, "completed")
    expect((await runDeadlineReminders(NOW)).riskReviews).toBe(0)
  })

  it("el asignado recibe el aviso aunque no tenga el permiso general", async () => {
    const id = await seedTrigger(2)
    await testDb.update(schema.preventionRiskReviewTriggers)
      .set({ assignedToUserId: AJENO }).where(eq(schema.preventionRiskReviewTriggers.id, id))

    await runDeadlineReminders(NOW)
    const destinatarios = (await notifications()).map((n) => n.userId)
    expect(destinatarios).toContain(AJENO)
    expect(destinatarios).toContain(PREVENCION)
  })
})

describe("PRI-001 — solicitudes de derechos del titular", () => {
  async function seedRequest(dueInDays: number | null, status = "recibida") {
    const workerId = nanoid()
    await testDb.insert(schema.workers).values({
      id: workerId, firstName: "Ana", lastName: "Soto", worksiteId: WS, isActive: true,
    })
    const id = nanoid()
    const now = NOW.toISOString()
    await testDb.insert(schema.preventionPrivacyRequests).values({
      id, subjectWorkerId: workerId, rightType: "access", status,
      requestScope: "Copia de su ficha", receivedAt: now,
      dueAt: dueInDays === null ? null : inDays(dueInDays).toISOString(),
      createdAt: now, updatedAt: now,
    })
    return id
  }

  it("avisa a quien gestiona solicitudes, con el titular en el título", async () => {
    await seedRequest(5)
    const result = await runDeadlineReminders(NOW)
    expect(result.privacyRequests).toBe(1)
    const [aviso] = await notifications()
    expect(aviso?.userId).toBe(PRIVACIDAD)
    expect(aviso?.title).toContain("Ana Soto")
  })

  it("una solicitud vencida se marca como tal", async () => {
    await seedRequest(-2)
    await runDeadlineReminders(NOW)
    expect((await notifications())[0]?.type).toBe("privacy_request_overdue")
  })

  it("una completada o rechazada ya no tiene plazo que correr", async () => {
    await seedRequest(-5, "completada")
    await seedRequest(-5, "rechazada")
    expect((await runDeadlineReminders(NOW)).privacyRequests).toBe(0)
  })

  it("los tres barridos suman sus entregas en una sola corrida", async () => {
    await seedVehicleDocument({ expiresInDays: 1 })
    await testDb.insert(schema.preventionRiskReviewTriggers).values({
      id: "trg-mix", idempotencyKey: "trg-mix", worksiteId: WS, triggerType: "annual",
      sourceType: "matrix", sourceId: "m1", description: "Revisión", status: "pending",
      dueAt: plainDate(1),
    })
    await seedRequest(1)

    const result = await runDeadlineReminders(NOW)
    expect(result.fleetDocuments).toBe(1)
    expect(result.riskReviews).toBe(1)
    expect(result.privacyRequests).toBe(1)
    expect(result.deliveries).toBe(3)
  })
})
