/**
 * Permiso de trabajo: las puertas que el flujo no cerraba (FX-C).
 *
 * #18 — `suspendExpiredPermits` pasaba a `suspended` también los permisos
 * `approved` vencidos, una transición que `PERMIT_TRANSITIONS.approved` no
 * admite: la máquina de estados se saltaba por la puerta de servicio.
 *
 * #21 — `supervisorUserId` y `riskEntryId` se guardaban sin validar. El
 * supervisor es quien verifica los controles en terreno: tiene que poder
 * hacerlo en ESA faena. El peligro MIPER tiene que ser de la matriz vigente de
 * la misma faena, igual que exige el marcador del mapa de riesgos.
 *
 * #63 — Enviar a aprobación, aprobar y suspender no avisaban a nadie: el
 * aprobador tenía que descubrir el permiso abriendo la bandeja, y una
 * suspensión (detener el trabajo) no le llegaba al supervisor.
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
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
// El correo no es lo que se prueba y no hay SMTP en la suite.
vi.mock("@/lib/email/smtp", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  sendBatchEmails: vi.fn().mockResolvedValue(undefined),
  getAppBaseUrl: () => "http://localhost",
}))

const service = await import("@/lib/services/prevention-permits")

const WS = "ws-pwg"
const WS_OTRA = "ws-pwg-otra"
const SCOPE = { mode: "some", ids: [WS, WS_OTRA] } as WorksiteScope
const TODOS = [
  "prevention:permits:view", "prevention:permits:manage", "prevention:permits:request",
  "prevention:permits:verify", "prevention:permits:approve", "prevention:permits:activate",
  "prevention:permits:suspend", "prevention:permits:close",
]
const SOLICITANTE = { userId: "pwg-solicitante", scope: SCOPE, permissions: TODOS.filter((p) => p !== "prevention:permits:approve") }
/** Supervisor y aprobador de la faena WS. */
const APROBADOR = { userId: "pwg-aprobador", scope: SCOPE, permissions: TODOS }
/** Tiene `verify`, pero sólo en la otra faena. */
const SUP_OTRA = "pwg-sup-otra"
/** Usuario activo sin `verify` en ninguna parte. */
const SIN_PERMISO = "pwg-sin-permiso"

let tipoId = ""

function ventana() {
  const inicio = new Date(Date.now() + 60 * 60 * 1000)
  return {
    plannedStartAt: inicio.toISOString(),
    plannedEndAt: new Date(inicio.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  }
}

function nuevoPermiso(over: { supervisorUserId?: string; riskEntryId?: string | null } = {}) {
  return service.createWorkPermit({
    permitTypeId: tipoId, worksiteId: WS,
    taskDescription: "Cambio de luminarias en estructura sobre los 1,8 m.",
    location: "Nave de mantención",
    supervisorUserId: over.supervisorUserId ?? APROBADOR.userId,
    riskEntryId: over.riskEntryId ?? null,
    ...ventana(), crew: [{ workerId: "wk-pwg", role: "executor" }], controls: [],
  }, SOLICITANTE)
}

async function seedRiskEntry(id: string, matrixId: string) {
  await testDb.insert(schema.preventionRiskEntries).values({
    id, matrixId, processId: "proc-pwg", taskId: "task-pwg", positionId: "pos-pwg",
    hazardCode: id, hazard: "Caída de altura", riskFactor: "Trabajo sobre 1,8 m",
    expectedEventOrDamage: "Fractura", exposedPeopleDescription: "Eléctricos", exposedPeopleCount: 2,
    genderConsiderations: "Sin diferencias declaradas.", sensitiveWorkerConsiderations: "Sin trabajadores sensibles.",
    inherentDimensions: {}, inherentLevel: "high", residualDimensions: {}, residualLevel: "medium",
    responsibleUserId: APROBADOR.userId, responsibleSnapshot: "Aprobador",
  })
}

async function seedMatrix(id: string, worksiteId: string, status: "published" | "draft", version: number) {
  await testDb.insert(schema.preventionRiskMatrices).values({
    id, worksiteId, matrixVersion: version, title: `MIPER ${id}`, status,
    methodologyId: "meth-pwg", methodologySnapshot: {},
    revisionReason: "Versión de la matriz para la prueba de permisos.",
    participationSummary: "Participación documentada del comité paritario.",
    consultationEvidenceReference: "acta-consulta-pwg",
    effectiveFrom: "2026-09-01", reviewDueAt: "2027-09-01",
    createdByUserId: APROBADOR.userId,
    ...(status === "published"
      ? {
          reviewedByUserId: SUP_OTRA, approvedByUserId: APROBADOR.userId,
          publishedByUserId: APROBADOR.userId, publishedAt: "2026-09-01T12:00:00.000Z",
          publishedHashSha256: "c".repeat(64),
        }
      : {}),
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values([
    { id: WS, name: "Faena Permisos", code: "PWG", isActive: true },
    { id: WS_OTRA, name: "Faena Otra", code: "PWG2", isActive: true },
  ])
  await testDb.insert(schema.workers).values({
    id: "wk-pwg", rut: "17777777-7", firstName: "Ana", lastName: "Pérez",
    position: "Eléctrica", worksiteId: WS,
  })
  await testDb.insert(schema.users).values([
    { id: SOLICITANTE.userId, name: "Solicitante", email: "solicitante@pwg.cl", hashedPassword: "x", isActive: true },
    { id: APROBADOR.userId, name: "Aprobador", email: "aprobador@pwg.cl", hashedPassword: "x", isActive: true },
    { id: SUP_OTRA, name: "Supervisor otra faena", email: "otra@pwg.cl", hashedPassword: "x", isActive: true },
    { id: SIN_PERMISO, name: "Sin permiso", email: "sin@pwg.cl", hashedPassword: "x", isActive: true },
  ])
  // RBAC real: el supervisor se valida contra los permisos efectivos por faena,
  // no contra lo que dice el formulario.
  await testDb.insert(schema.permissions).values(TODOS.map((name) => ({ id: `perm-${name}`, name, module: "prevention" })))
  await testDb.insert(schema.roles).values([
    { id: "role-pwg-sup", name: "pwg_supervisor", label: "Supervisor de permisos", isGlobal: false },
    { id: "role-pwg-sol", name: "pwg_solicitante", label: "Solicitante de permisos", isGlobal: false },
  ])
  await testDb.insert(schema.rolePermissions).values([
    ...TODOS.map((name) => ({ roleId: "role-pwg-sup", permissionId: `perm-${name}` })),
    { roleId: "role-pwg-sol", permissionId: "perm-prevention:permits:request" },
  ])
  await testDb.insert(schema.userRoles).values([
    { userId: APROBADOR.userId, roleId: "role-pwg-sup" },
    { userId: SUP_OTRA, roleId: "role-pwg-sup" },
    { userId: SOLICITANTE.userId, roleId: "role-pwg-sol" },
  ])
  await testDb.insert(schema.worksiteUsers).values([
    { userId: APROBADOR.userId, worksiteId: WS },
    { userId: SUP_OTRA, worksiteId: WS_OTRA },
    { userId: SOLICITANTE.userId, worksiteId: WS },
  ])

  await testDb.insert(schema.preventionRiskMethodologies).values({
    id: "meth-pwg", code: "ISP-PWG", name: "Matriz ISP", versionLabel: "v1", kind: "primary",
    authoritySource: "ISP", createdByUserId: APROBADOR.userId,
  })
  await testDb.insert(schema.preventionRiskProcesses).values({ id: "proc-pwg", worksiteId: WS, code: "P1", name: "Mantención" })
  await testDb.insert(schema.preventionRiskTasks).values({ id: "task-pwg", processId: "proc-pwg", code: "T1", name: "Iluminación" })
  await testDb.insert(schema.preventionRiskPositions).values({ id: "pos-pwg", taskId: "task-pwg", code: "C1", name: "Eléctrico" })
  await seedMatrix("mx-pwg-vigente", WS, "published", 1)
  await seedMatrix("mx-pwg-borrador", WS, "draft", 2)
  await seedMatrix("mx-pwg-otra", WS_OTRA, "published", 1)
  await seedRiskEntry("re-pwg-vigente", "mx-pwg-vigente")
  await seedRiskEntry("re-pwg-borrador", "mx-pwg-borrador")
  await seedRiskEntry("re-pwg-otra", "mx-pwg-otra")

  const tipo = await service.createPermitType({
    code: "ALT-PWG", name: "Trabajo en altura",
    requiresIsolation: false, requiresMeasurement: false, requiresJsa: false,
    requiresCrewAcknowledgement: false, maxDurationHours: 8,
    legalBasis: "DS 44/2024: tarea crítica en altura.",
  }, APROBADOR)
  tipoId = tipo.id
})

beforeEach(async () => {
  await testDb.delete(schema.notifications)
})

const avisosPara = async (userId: string) =>
  testDb.select().from(schema.notifications).where(eq(schema.notifications.userId, userId))

async function enviar(permit: { id: string; version: number }) {
  return service.transitionWorkPermit({
    permitId: permit.id, expectedVersion: permit.version, toStatus: "pending_approval",
    reason: "Permiso completo, se envía a aprobación.",
  }, SOLICITANTE)
}
async function aprobar(permit: { id: string; version: number }) {
  return service.transitionWorkPermit({
    permitId: permit.id, expectedVersion: permit.version, toStatus: "approved",
    reason: "Revisión documental conforme al estándar de altura.",
  }, APROBADOR)
}
async function activar(permit: { id: string; version: number }) {
  return service.transitionWorkPermit({
    permitId: permit.id, expectedVersion: permit.version, toStatus: "active",
    reason: "Controles verificados en terreno antes de iniciar.",
  }, APROBADOR)
}

describe("#21 — supervisor y peligro MIPER validados al crear", () => {
  it("rechaza un supervisor sin permiso de verificar", async () => {
    await expect(nuevoPermiso({ supervisorUserId: SIN_PERMISO })).rejects.toThrow(/supervisor/i)
  })

  it("rechaza un supervisor que sólo verifica en otra faena", async () => {
    await expect(nuevoPermiso({ supervisorUserId: SUP_OTRA })).rejects.toThrow(/supervisor/i)
  })

  it("rechaza un peligro de la matriz de otra faena", async () => {
    await expect(nuevoPermiso({ riskEntryId: "re-pwg-otra" })).rejects.toThrow(/MIPER vigente/)
  })

  it("rechaza un peligro de una matriz en borrador", async () => {
    await expect(nuevoPermiso({ riskEntryId: "re-pwg-borrador" })).rejects.toThrow(/MIPER vigente/)
  })

  it("acepta un supervisor de la faena y un peligro de su matriz vigente", async () => {
    const permit = await nuevoPermiso({ riskEntryId: "re-pwg-vigente" })
    expect(permit).toMatchObject({ supervisorUserId: APROBADOR.userId, riskEntryId: "re-pwg-vigente" })
  })
})

describe("#63 — avisos del flujo del permiso", () => {
  it("enviar a aprobación avisa a quien puede aprobar en la faena", async () => {
    const permit = await nuevoPermiso()
    await enviar(permit)
    const avisos = await avisosPara(APROBADOR.userId)
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toMatchObject({ entityType: "work_permit", entityId: permit.id })
    // Quien aprueba en otra faena no tiene nada que hacer con este permiso.
    expect(await avisosPara(SUP_OTRA)).toHaveLength(0)
  })

  it("aprobar avisa al solicitante", async () => {
    const permit = await nuevoPermiso()
    const enviado = await enviar(permit)
    await testDb.delete(schema.notifications)
    await aprobar(enviado)
    const avisos = await avisosPara(SOLICITANTE.userId)
    expect(avisos).toHaveLength(1)
    expect(avisos[0]!.title).toMatch(/aprobado/i)
  })

  it("suspender avisa al solicitante", async () => {
    const permit = await nuevoPermiso()
    const vigente = await activar(await aprobar(await enviar(permit)))
    await testDb.delete(schema.notifications)
    await service.transitionWorkPermit({
      permitId: permit.id, expectedVersion: vigente.version, toStatus: "suspended",
      reason: "Viento sobre el límite para trabajo en altura.",
    }, APROBADOR)
    const avisos = await avisosPara(SOLICITANTE.userId)
    expect(avisos).toHaveLength(1)
    expect(avisos[0]!.title).toMatch(/suspendido/i)
  })
})

describe("#18 — vencimiento automático respeta la máquina de estados", () => {
  async function vencer(permitId: string) {
    await testDb.update(schema.preventionWorkPermits)
      .set({ plannedStartAt: "2020-01-01T00:00:00.000Z", plannedEndAt: "2020-01-01T06:00:00.000Z" })
      .where(eq(schema.preventionWorkPermits.id, permitId))
  }
  const estado = async (permitId: string) =>
    (await testDb.select().from(schema.preventionWorkPermits).where(eq(schema.preventionWorkPermits.id, permitId)))[0]!

  it("un permiso vigente vencido pasa a suspendido y avisa al solicitante", async () => {
    const permit = await nuevoPermiso()
    await activar(await aprobar(await enviar(permit)))
    await vencer(permit.id)
    await testDb.delete(schema.notifications)

    await service.suspendExpiredPermits()
    const fila = await estado(permit.id)
    expect(fila.status).toBe("suspended")
    expect(fila.suspendedByUserId).toBeNull()
    expect(await avisosPara(SOLICITANTE.userId)).toHaveLength(1)
  })

  it("un permiso aprobado vencido NO pasa a suspendido: approved → suspended no existe", async () => {
    const permit = await nuevoPermiso()
    await aprobar(await enviar(permit))
    await vencer(permit.id)

    await service.suspendExpiredPermits()
    const fila = await estado(permit.id)
    expect(fila.status).not.toBe("suspended")
  })
})
