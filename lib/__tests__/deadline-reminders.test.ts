/**
 * Patrón P3 (auditoría 2026-09-14): tres vencimientos con consecuencia legal
 * que no avisaban a nadie y dependían de que alguien abriera la pantalla
 * correcta — `FLO-002` (documentos del vehículo), `MIP-001` (revisión de la
 * MIPER) y `PRI-001` (solicitud de derechos del titular).
 *
 * 2026-11: el barrido de flota mira también las fechas guardadas en el equipo
 * (antes sólo los documentos subidos), titula con el código o la patente y mide
 * con el día civil de Chile y la ventana de flota; y se suman los avisos de
 * licencias de conducir.
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
import { formatDate } from "@/lib/utils"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
// El servicio de licencias importa `can`; el aviso no lo usa (no hay sesión) y
// cargar next-auth aquí no aporta nada a lo que se prueba.
vi.mock("@/lib/auth/can", () => ({
  can: (session: { user?: { permissions?: string[] } } | null, permission: string) =>
    session?.user?.permissions?.includes(permission) ?? false,
}))
// El correo no es lo que se está probando: interesa la notificación en base.
vi.mock("@/lib/email/smtp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/smtp")>()),
  sendEmail: vi.fn(async () => {}),
  sendBatchEmails: vi.fn(async () => {}),
}))

const { runDeadlineReminders, DEADLINE_WARNING_DAYS } =
  await import("@/lib/services/deadline-reminders")

const WS = "ws-dl-1"
const WS_OTRA = "ws-dl-2"
const RESPONSABLE = "user-dl-flota"
const PREVENCION = "user-dl-prev"
const PRIVACIDAD = "user-dl-priv"
const AJENO = "user-dl-ajeno"
const LICENCIAS = "user-dl-licencias"
const LICENCIAS_OTRA = "user-dl-licencias-otra"
const POS_CHOFER = "pos-dl-chofer"
const POS_SUPERVISOR = "pos-dl-supervisor"
const POS_SOLDADOR = "pos-dl-soldador"
// Mediodía UTC del 14 de septiembre: en Chile también es 14 (08:00 u 09:00).
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

let drivesCapabilityId = ""

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values([
    { id: RESPONSABLE, name: "Flota", email: "flota@dl.cl", hashedPassword: "x", isActive: true },
    { id: PREVENCION, name: "Prevención", email: "prev@dl.cl", hashedPassword: "x", isActive: true },
    { id: PRIVACIDAD, name: "Privacidad", email: "priv@dl.cl", hashedPassword: "x", isActive: true },
    { id: AJENO, name: "Ajeno", email: "ajeno@dl.cl", hashedPassword: "x", isActive: true },
    { id: LICENCIAS, name: "Licencias", email: "lic@dl.cl", hashedPassword: "x", isActive: true },
    { id: LICENCIAS_OTRA, name: "Licencias otra faena", email: "lic2@dl.cl", hashedPassword: "x", isActive: true },
  ])
  await testDb.insert(schema.worksites).values([
    { id: WS, name: "Faena Plazos", code: "DL", isActive: true },
    { id: WS_OTRA, name: "Otra faena", code: "DL2", isActive: true },
  ])
  await testDb.insert(schema.worksiteUsers).values([
    { userId: RESPONSABLE, worksiteId: WS },
    { userId: PREVENCION, worksiteId: WS },
    { userId: LICENCIAS, worksiteId: WS },
    { userId: LICENCIAS_OTRA, worksiteId: WS_OTRA },
  ])
  await grant(RESPONSABLE, "flota:manage_documents")
  await grant(PREVENCION, "prevention:risk:edit")
  await grant(PRIVACIDAD, "prevention:privacy:manage_requests")
  await grant(LICENCIAS, "flota:manage_licenses")
  await grant(LICENCIAS_OTRA, "flota:manage_licenses")

  // Cargos: dos que conducen (con clases exigidas distintas) y uno que no. Las
  // capacidades `drives_vehicle` y `operates_equipment` las siembra la migración.
  const capabilities = await testDb.select().from(schema.workerCapabilities)
  drivesCapabilityId = capabilities.find((item) => item.code === "drives_vehicle")!.id
  await testDb.insert(schema.workerPositions).values([
    { id: POS_CHOFER, code: "DL-CHOFER", name: "Conductor de camión", normalizedKey: "conductor de camion dl", requiredLicenseClasses: ["A4", "A5"] },
    { id: POS_SUPERVISOR, code: "DL-SUPERVISOR", name: "Supervisor", normalizedKey: "supervisor dl", requiredLicenseClasses: ["B"] },
    { id: POS_SOLDADOR, code: "DL-SOLDADOR", name: "Soldador", normalizedKey: "soldador dl", requiredLicenseClasses: [] },
  ])
  await testDb.insert(schema.workerPositionCapabilities).values([
    { positionId: POS_CHOFER, capabilityId: drivesCapabilityId },
    { positionId: POS_SUPERVISOR, capabilityId: drivesCapabilityId },
  ])

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
  // Los trabajadores van después de lo que los referencia.
  await testDb.delete(schema.workerCapabilityOverrides)
  await testDb.delete(schema.workerDriverLicenses)
  await testDb.delete(schema.workers)
  await testDb.delete(schema.systemSettings).where(eq(schema.systemSettings.key, "fleet.document.warning_days"))
})

/**
 * El catálogo de tipos de equipo lo siembran las migraciones: se reutiliza uno
 * existente en vez de insertar otro, que chocaría por `slug`.
 */
let equipmentTypeId = ""

interface SeedVehicleOptions {
  code?: string | null
  plate?: string
  worksiteId?: string
  isActive?: boolean
  declared?: {
    soapExpiresAt?: string
    technicalReviewExpiresAt?: string
    circulationPermitExpiresAt?: string
    insuranceExpiresAt?: string
  }
}

async function seedVehicle(options: SeedVehicleOptions = {}) {
  const vehicleId = nanoid()
  await testDb.insert(schema.fuelVehicles).values({
    id: vehicleId,
    plate: options.plate ?? `PL-${nanoid(6).toUpperCase()}`,
    code: options.code === undefined ? "KA-63" : options.code,
    type: "camioneta",
    equipmentTypeId,
    worksiteId: options.worksiteId ?? WS,
    isActive: options.isActive ?? true,
    ...options.declared,
  })
  return vehicleId
}

async function seedDocument(vehicleId: string, options: { expiresInDays: number; documentType?: string; status?: string }) {
  const docId = nanoid()
  await testDb.insert(schema.fleetVehicleDocuments).values({
    id: docId, vehicleId, documentType: options.documentType ?? "Revisión técnica",
    fileName: "rt.pdf", filePath: "storage/rt.pdf", uploadedBy: RESPONSABLE,
    expiresAt: plainDate(options.expiresInDays),
    status: options.status ?? "current",
  })
  return docId
}

async function seedVehicleDocument(options: {
  expiresInDays: number
  documentType?: string
  status?: string
}) {
  const vehicleId = await seedVehicle()
  const docId = await seedDocument(vehicleId, options)
  return { vehicleId, docId }
}

const titles = async () => (await notifications()).map((aviso) => aviso.title).sort()

describe("FLO-002 — documentos legales del vehículo", () => {
  it("avisa a quien gestiona documentos de esa faena cuando falta poco", async () => {
    await seedVehicleDocument({ expiresInDays: 10 })
    const result = await runDeadlineReminders(NOW)

    expect(result.fleetDocuments).toBe(1)
    const avisos = await notifications()
    expect(avisos).toHaveLength(1)
    expect(avisos[0]!.userId).toBe(RESPONSABLE)
    expect(avisos[0]!.type).toBe("fleet_document_due_soon")
    // El rótulo sale del tipo guardado («Revisión técnica»), no de un slug que
    // nunca calzaba, y el cuerpo trae la fecha en el formato de la plataforma.
    expect(avisos[0]!.title).toBe("KA-63: la revisión técnica está por vencer")
    expect(avisos[0]!.body).toBe(`La revisión técnica vence el ${formatDate(plainDate(10))}.`)
  })

  it("un documento vencido se distingue del que está por vencer", async () => {
    await seedVehicleDocument({ expiresInDays: -3 })
    await runDeadlineReminders(NOW)
    const [aviso] = await notifications()
    expect(aviso?.type).toBe("fleet_document_overdue")
    expect(aviso?.title).toBe("KA-63: la revisión técnica está vencida")
    expect(aviso?.body).toContain("no puede circular")
    expect(aviso?.body).toContain(formatDate(plainDate(-3)))
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

  describe("fechas guardadas en el equipo", () => {
    it("un equipo que sólo tiene la fecha en su ficha (sin documento subido) avisa", async () => {
      await seedVehicle({ declared: { technicalReviewExpiresAt: plainDate(10) } })
      const result = await runDeadlineReminders(NOW)

      expect(result.fleetDocuments).toBe(1)
      const [aviso] = await notifications()
      expect(aviso?.type).toBe("fleet_document_due_soon")
      expect(aviso?.title).toBe("KA-63: la revisión técnica está por vencer")
    })

    it("un equipo sin código (batea, carro) se identifica por su patente", async () => {
      await seedVehicle({ code: null, plate: "JN-6770", declared: { soapExpiresAt: plainDate(-3) } })
      await runDeadlineReminders(NOW)
      const [aviso] = await notifications()
      expect(aviso?.type).toBe("fleet_document_overdue")
      expect(aviso?.title).toBe("JN-6770: el SOAP está vencido")
      expect(aviso?.title).not.toContain("null")
    })

    it("el título concuerda en género: la revisión técnica «vencida», el permiso de circulación «vencido»", async () => {
      await seedVehicle({
        declared: { technicalReviewExpiresAt: plainDate(-1), circulationPermitExpiresAt: plainDate(-1) },
      })
      await runDeadlineReminders(NOW)
      expect(await titles()).toEqual([
        "KA-63: el permiso de circulación está vencido",
        "KA-63: la revisión técnica está vencida",
      ])
    })

    it("cada tipo vencido avisa por separado, con su propia fecha", async () => {
      await seedVehicle({
        declared: { soapExpiresAt: plainDate(3), insuranceExpiresAt: plainDate(20) },
      })
      const result = await runDeadlineReminders(NOW)
      expect(result.fleetDocuments).toBe(2)
      expect(await titles()).toEqual([
        "KA-63: el SOAP está por vencer",
        "KA-63: el seguro está por vencer",
      ])
    })

    it("la fecha de la ficha manda sobre el documento subido del mismo tipo", async () => {
      // La ficha dice que está al día; la póliza subida el año pasado no manda.
      const vehicleId = await seedVehicle({ declared: { technicalReviewExpiresAt: plainDate(200) } })
      await seedDocument(vehicleId, { expiresInDays: 5 })
      const result = await runDeadlineReminders(NOW)
      expect(result.fleetDocuments).toBe(0)
      expect(await notifications()).toEqual([])
    })

    it("el documento aporta cuando la ficha no declara ese tipo", async () => {
      const vehicleId = await seedVehicle({ declared: { soapExpiresAt: plainDate(200) } })
      await seedDocument(vehicleId, { expiresInDays: 4, documentType: "Seguro" })
      await runDeadlineReminders(NOW)
      expect(await titles()).toEqual(["KA-63: el seguro está por vencer"])
    })

    it("un tipo sin rótulo propio se nombra con su nombre guardado", async () => {
      const vehicleId = await seedVehicle()
      await seedDocument(vehicleId, { expiresInDays: 3, documentType: "Otro" })
      await runDeadlineReminders(NOW)
      expect(await titles()).toEqual(["KA-63: el documento «Otro» está por vencer"])
    })

    it("un equipo dado de baja no avisa", async () => {
      await seedVehicle({ isActive: false, declared: { soapExpiresAt: plainDate(-30) } })
      const inactiveWithDocument = await seedVehicle({ isActive: false, code: "KA-64" })
      await seedDocument(inactiveWithDocument, { expiresInDays: -10 })

      const result = await runDeadlineReminders(NOW)
      expect(result.fleetDocuments).toBe(0)
      expect(await notifications()).toEqual([])
    })

    it("corregir la fecha crea un aviso nuevo; repetir la corrida no", async () => {
      const vehicleId = await seedVehicle({ declared: { soapExpiresAt: plainDate(5) } })
      await runDeadlineReminders(NOW)
      await runDeadlineReminders(NOW)
      expect(await notifications()).toHaveLength(1)

      await testDb.update(schema.fuelVehicles)
        .set({ soapExpiresAt: plainDate(12) }).where(eq(schema.fuelVehicles.id, vehicleId))
      await runDeadlineReminders(NOW)
      expect(await notifications()).toHaveLength(2)
    })

    it("sin nadie con permiso en la faena el equipo se examina pero no se crea ningún aviso", async () => {
      await seedVehicle({ worksiteId: WS_OTRA, declared: { soapExpiresAt: plainDate(2) } })
      const result = await runDeadlineReminders(NOW)
      expect(result.fleetDocuments).toBe(1)
      expect(await notifications()).toEqual([])
    })
  })

  describe("ventana y día de Chile", () => {
    it("la ventana es el ajuste de flota, no 30 días fijos", async () => {
      await seedVehicle({ declared: { soapExpiresAt: plainDate(45) } })
      expect((await runDeadlineReminders(NOW)).fleetDocuments).toBe(0)

      await testDb.insert(schema.systemSettings).values({ key: "fleet.document.warning_days", value: "60" })
      expect((await runDeadlineReminders(NOW)).fleetDocuments).toBe(1)
      expect((await notifications())[0]?.type).toBe("fleet_document_due_soon")
    })

    it("«hoy» es el día civil de Chile: a las 23:30 del 14 todavía no venció lo que vence el 14", async () => {
      // 02:30 UTC del 15 son las 23:30 (o 22:30) del 14 en Chile. Medido en UTC,
      // lo que vence el 14 salía «vencido» una noche antes de tiempo.
      const lateInChile = new Date("2026-09-15T02:30:00.000Z")
      await seedVehicle({ declared: { soapExpiresAt: "2026-09-14" } })
      await runDeadlineReminders(lateInChile)
      const [aviso] = await notifications()
      expect(aviso?.type).toBe("fleet_document_due_soon")
      expect(aviso?.title).toBe("KA-63: el SOAP está por vencer")
    })
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

  it("todos los barridos suman sus entregas en una sola corrida", async () => {
    await seedVehicleDocument({ expiresInDays: 1 })
    await testDb.insert(schema.preventionRiskReviewTriggers).values({
      id: "trg-mix", idempotencyKey: "trg-mix", worksiteId: WS, triggerType: "annual",
      sourceType: "matrix", sourceId: "m1", description: "Revisión", status: "pending",
      dueAt: plainDate(1),
    })
    await seedRequest(1)
    await seedWorker({ license: { classes: ["B"], expiresInDays: 1 } })

    const result = await runDeadlineReminders(NOW)
    expect(result.fleetDocuments).toBe(1)
    expect(result.driverLicenses).toBe(1)
    expect(result.riskReviews).toBe(1)
    expect(result.privacyRequests).toBe(1)
    expect(result.deliveries).toBe(4)
  })
})

/* ── Licencias de conducir ───────────────────────────────────────────────── */

interface SeedWorkerOptions {
  firstName?: string
  lastName?: string
  worksiteId?: string
  positionId?: string | null
  isActive?: boolean
  license?: { classes: string[]; expiresInDays?: number | null; expiresAt?: string | null; notes?: string }
}

async function seedWorker(options: SeedWorkerOptions = {}) {
  const id = nanoid()
  await testDb.insert(schema.workers).values({
    id,
    firstName: options.firstName ?? "Juan",
    lastName: options.lastName ?? "Pérez",
    worksiteId: options.worksiteId ?? WS,
    positionId: options.positionId ?? null,
    isActive: options.isActive ?? true,
  })
  if (options.license) {
    await testDb.insert(schema.workerDriverLicenses).values({
      workerId: id,
      classes: options.license.classes,
      expiresAt: options.license.expiresAt !== undefined
        ? options.license.expiresAt
        : options.license.expiresInDays == null ? null : plainDate(options.license.expiresInDays),
      notes: options.license.notes ?? null,
    })
  }
  return id
}

const recipientsOf = async () => (await notifications()).map((aviso) => aviso.userId).sort()

describe("licencias de conducir", () => {
  describe("vencimiento", () => {
    it("una licencia vencida avisa sólo a quien gestiona licencias en esa faena", async () => {
      const workerId = await seedWorker({ license: { classes: ["A5", "B"], expiresInDays: -5 } })
      const result = await runDeadlineReminders(NOW)

      expect(result.driverLicenses).toBe(1)
      const avisos = await notifications()
      // No llega a quien gestiona licencias de OTRA faena, ni a quien sólo
      // gestiona documentos de flota o riesgos en ésta.
      expect(avisos.map((aviso) => aviso.userId)).toEqual([LICENCIAS])
      expect(avisos[0]).toMatchObject({
        type: "driver_license_overdue",
        title: "Licencia de Juan Pérez: vencida",
        body: `La licencia de Juan Pérez venció el ${formatDate(plainDate(-5))}. No debe conducir hasta renovarla.`,
        entityType: "worker",
        entityId: workerId,
        entityHref: `/flota/conductores?editar=${workerId}`,
      })
    })

    it("una licencia por vencer avisa con su fecha", async () => {
      await seedWorker({ license: { classes: ["B"], expiresInDays: 10 } })
      await runDeadlineReminders(NOW)
      const [aviso] = await notifications()
      expect(aviso).toMatchObject({
        userId: LICENCIAS,
        type: "driver_license_due_soon",
        title: "Licencia de Juan Pérez: por vencer",
        body: `La licencia de Juan Pérez vence el ${formatDate(plainDate(10))}.`,
      })
    })

    it("el borde de la ventana de flota: avisa hasta el último día y no antes", async () => {
      await seedWorker({ firstName: "Dentro", license: { classes: ["B"], expiresInDays: DEADLINE_WARNING_DAYS } })
      await seedWorker({ firstName: "Fuera", license: { classes: ["B"], expiresInDays: DEADLINE_WARNING_DAYS + 1 } })
      const result = await runDeadlineReminders(NOW)
      expect(result.driverLicenses).toBe(1)
      expect((await notifications())[0]?.title).toBe("Licencia de Dentro Pérez: por vencer")
    })

    it("una licencia que vence hoy todavía no está vencida: avisa como por vencer", async () => {
      await seedWorker({ license: { classes: ["B"], expiresInDays: 0 } })
      await runDeadlineReminders(NOW)
      expect((await notifications())[0]?.type).toBe("driver_license_due_soon")
    })

    it("una licencia vigente no avisa", async () => {
      await seedWorker({ license: { classes: ["B"], expiresInDays: 200 } })
      const result = await runDeadlineReminders(NOW)
      expect(result.driverLicenses).toBe(0)
      expect(await notifications()).toEqual([])
    })

    it("el jefe de otra faena recibe lo de su faena y no lo de ésta", async () => {
      await seedWorker({ firstName: "Aquí", worksiteId: WS, license: { classes: ["B"], expiresInDays: -2 } })
      await seedWorker({ firstName: "Allá", worksiteId: WS_OTRA, license: { classes: ["B"], expiresInDays: -2 } })
      await runDeadlineReminders(NOW)

      const avisos = await notifications()
      const byUser = Object.fromEntries(avisos.map((aviso) => [aviso.userId, aviso.title]))
      expect(byUser).toEqual({
        [LICENCIAS]: "Licencia de Aquí Pérez: vencida",
        [LICENCIAS_OTRA]: "Licencia de Allá Pérez: vencida",
      })
    })

    it("un trabajador inactivo no avisa aunque su licencia esté vencida", async () => {
      await seedWorker({ isActive: false, license: { classes: ["B"], expiresInDays: -30 } })
      await seedWorker({ isActive: false, positionId: POS_CHOFER })
      const result = await runDeadlineReminders(NOW)
      expect(result.driverLicenses).toBe(0)
      expect(await notifications()).toEqual([])
    })

    it("una licencia sin fecha no avisa por vencimiento (no hay fecha que vigilar)", async () => {
      await seedWorker({ license: { classes: ["B"], expiresInDays: null } })
      expect((await runDeadlineReminders(NOW)).driverLicenses).toBe(0)
    })

    it("dos corridas no duplican; corregir la fecha sí crea un aviso nuevo", async () => {
      const workerId = await seedWorker({ license: { classes: ["B"], expiresInDays: -5 } })
      await runDeadlineReminders(NOW)
      await runDeadlineReminders(NOW)
      expect(await notifications()).toHaveLength(1)

      await testDb.update(schema.workerDriverLicenses)
        .set({ expiresAt: plainDate(8) }).where(eq(schema.workerDriverLicenses.workerId, workerId))
      await runDeadlineReminders(NOW)
      const avisos = await notifications()
      expect(avisos).toHaveLength(2)
      expect(avisos.map((aviso) => aviso.type).sort()).toEqual(["driver_license_due_soon", "driver_license_overdue"])
    })

    it("«hoy» es el día civil de Chile", async () => {
      const lateInChile = new Date("2026-09-15T02:30:00.000Z")
      await seedWorker({ license: { classes: ["B"], expiresAt: "2026-09-14" } })
      await runDeadlineReminders(lateInChile)
      expect((await notifications())[0]?.type).toBe("driver_license_due_soon")
    })
  })

  describe("sin licencia o clase insuficiente para el cargo", () => {
    it("avisa una sola vez por trabajador y cargo, aunque el cron corra todos los días", async () => {
      const workerId = await seedWorker({ positionId: POS_CHOFER })

      const first = await runDeadlineReminders(NOW)
      expect(first.driverLicenses).toBe(1)
      await runDeadlineReminders(NOW)
      await runDeadlineReminders(new Date(NOW.getTime() + 86_400_000))

      const avisos = await notifications()
      expect(avisos).toHaveLength(1)
      expect(avisos[0]).toMatchObject({
        userId: LICENCIAS,
        type: "driver_license_missing",
        title: "Licencia de Juan Pérez: sin registrar",
        body: "Juan Pérez es conductor de camión, que exige licencia A4 o A5, y no tiene una registrada.",
        entityType: "worker",
        entityId: workerId,
        entityHref: `/flota/conductores?editar=${workerId}`,
      })
    })

    it("si cambia el cargo, la exigencia es otra y vuelve a avisar", async () => {
      const workerId = await seedWorker({ positionId: POS_CHOFER })
      await runDeadlineReminders(NOW)
      expect(await notifications()).toHaveLength(1)

      await testDb.update(schema.workers)
        .set({ positionId: POS_SUPERVISOR }).where(eq(schema.workers.id, workerId))
      await runDeadlineReminders(NOW)

      const avisos = await notifications()
      expect(avisos).toHaveLength(2)
      expect(avisos.map((aviso) => aviso.body).sort()).toEqual([
        "Juan Pérez es conductor de camión, que exige licencia A4 o A5, y no tiene una registrada.",
        "Juan Pérez es supervisor, que exige licencia B, y no tiene una registrada.",
      ])
    })

    it("la licencia no incluye la clase que exige el cargo", async () => {
      await seedWorker({ positionId: POS_CHOFER, license: { classes: ["B"], expiresInDays: 200 } })
      await runDeadlineReminders(NOW)
      const [aviso] = await notifications()
      expect(aviso).toMatchObject({
        type: "driver_license_missing",
        title: "Licencia de Juan Pérez: clase insuficiente",
        body: "Juan Pérez es conductor de camión, que exige licencia A4 o A5, y su licencia no incluye esa clase.",
      })
    })

    it("si basta con tener licencia (el cargo no fija clase) lo dice así", async () => {
      await testDb.update(schema.workerPositions)
        .set({ requiredLicenseClasses: [] }).where(eq(schema.workerPositions.id, POS_SUPERVISOR))
      try {
        await seedWorker({ positionId: POS_SUPERVISOR })
        await runDeadlineReminders(NOW)
        expect((await notifications())[0]?.body)
          .toBe("Juan Pérez es supervisor, que exige licencia de conducir, y no tiene una registrada.")
      } finally {
        await testDb.update(schema.workerPositions)
          .set({ requiredLicenseClasses: ["B"] }).where(eq(schema.workerPositions.id, POS_SUPERVISOR))
      }
    })

    it("pasar de sin licencia a clase insuficiente es otro motivo y avisa de nuevo", async () => {
      const workerId = await seedWorker({ positionId: POS_CHOFER })
      await runDeadlineReminders(NOW)
      await testDb.insert(schema.workerDriverLicenses).values({
        workerId, classes: ["B"], expiresAt: plainDate(200),
      })
      await runDeadlineReminders(NOW)
      expect((await notifications()).map((aviso) => aviso.title).sort()).toEqual([
        "Licencia de Juan Pérez: clase insuficiente",
        "Licencia de Juan Pérez: sin registrar",
      ])
    })

    it("un cargo que no conduce no pide licencia", async () => {
      await seedWorker({ positionId: POS_SOLDADOR })
      await seedWorker({ positionId: null })
      const result = await runDeadlineReminders(NOW)
      expect(result.driverLicenses).toBe(0)
      expect(await notifications()).toEqual([])
    })

    it("una excepción individual `exclude` saca al trabajador de la exigencia del cargo", async () => {
      const workerId = await seedWorker({ positionId: POS_CHOFER })
      await testDb.insert(schema.workerCapabilityOverrides).values({
        id: nanoid(), workerId, capabilityId: drivesCapabilityId, mode: "exclude", reason: "Temporalmente no conduce",
      })
      expect((await runDeadlineReminders(NOW)).driverLicenses).toBe(0)
    })

    it("una excepción `include` lo mete aunque su cargo no conduzca", async () => {
      const workerId = await seedWorker({ positionId: POS_SOLDADOR })
      await testDb.insert(schema.workerCapabilityOverrides).values({
        id: nanoid(), workerId, capabilityId: drivesCapabilityId, mode: "include", reason: "Conduce la camioneta de faena",
      })
      await runDeadlineReminders(NOW)
      const [aviso] = await notifications()
      expect(aviso).toMatchObject({
        type: "driver_license_missing",
        body: "Juan Pérez es soldador, que exige licencia de conducir, y no tiene una registrada.",
      })
    })

    it("llega a quien gestiona licencias en la faena del trabajador y a nadie más", async () => {
      await seedWorker({ positionId: POS_CHOFER, worksiteId: WS_OTRA })
      await runDeadlineReminders(NOW)
      expect(await recipientsOf()).toEqual([LICENCIAS_OTRA])
    })

    it("el trabajador con licencia al día y la clase correcta no avisa", async () => {
      await seedWorker({ positionId: POS_CHOFER, license: { classes: ["A5", "B"], expiresInDays: 200 } })
      const result = await runDeadlineReminders(NOW)
      expect(result.driverLicenses).toBe(0)
      expect(await notifications()).toEqual([])
    })
  })
})
