/**
 * lib/__tests__/prevention-cgrd.test.ts
 *
 * CGRD del DS 44 (G15): comité propio del DS 44 (distinto del CPHS), matriz
 * GRD simplificada (borrador → publicada, con evidencia real) y actas que sí
 * acreditan (a diferencia del CPHS, que no acredita su reunión mensual por
 * la D5).
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import { chileDateParts } from "@/lib/utils"
import type { WorksiteScope } from "@/lib/auth/scope"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const {
  constituteGrdCommittee, dissolveGrdCommittee, addGrdMember, removeGrdMember,
  createGrdMatrixDraft, addGrdThreat, removeGrdThreat, publishGrdMatrix,
  recordGrdMeeting, listGrdAgreements,
  designateGrdCoordinator, endGrdCoordinator, getGrdStructureStatus,
} = await import("@/lib/services/prevention-cgrd")

const { year: PROGRAM_YEAR } = chileDateParts()
const PROGRAM_ID = "pdtp-cgrd-v1"
const WS_A = "ws-cgrd-a"
const WS_B = "ws-cgrd-b"
const USER_MANAGER = "user-cgrd-manager"
const USER_PUBLISHER = "user-cgrd-publisher"
const WORKER_A = "worker-cgrd-a"
const WORKER_B = "worker-cgrd-b"

const scopeA = { mode: "some", ids: [WS_A] } as WorksiteScope
const scopeB = { mode: "some", ids: [WS_B] } as WorksiteScope
const scopeAll = { mode: "all", ids: [] } as WorksiteScope

/** PRF: edita en terreno (comité, matriz, actas), pero no publica la matriz —
 *  el reparto real del manifiesto no le da `matrix:publish`. */
const MANAGER = { userId: USER_MANAGER, scope: scopeA, permissions: [
  "prevention:cgrd:view", "prevention:cgrd:committee:manage", "prevention:cgrd:matrix:edit", "prevention:cgrd:meeting:manage",
] }
/** Jefatura/administrador: publica la matriz, sin editarla. */
const PUBLISHER = { userId: USER_PUBLISHER, scope: scopeAll, permissions: ["prevention:cgrd:view", "prevention:cgrd:matrix:publish"] }
const OUTSIDER = { userId: "user-cgrd-outsider", scope: scopeB, permissions: [
  "prevention:cgrd:view", "prevention:cgrd:committee:manage", "prevention:cgrd:matrix:edit", "prevention:cgrd:meeting:manage",
] }

const EVIDENCE = "https://drive.chome.cl/cgrd-evidencia"

async function seedPdtpActivity(n: 79 | 80 | 81) {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: `${PROGRAM_ID}-a-${n}`, programId: PROGRAM_ID, n,
    activity: `Actividad CGRD N°${n}`, program: "Prevención PDTP",
    responsibleSlugs: ["prf"], responsibleDisplay: "PRF", scheduleMode: "scheduled",
    scheduleClassificationStatus: "confirmed", mechanism: "enganche",
    sourceSheetRow: 1, createdAt: now, updatedAt: now,
  })
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.preventionGovernanceHistory)
  await inMemoryDb.delete(schema.preventionGrdAgreements)
  await inMemoryDb.delete(schema.preventionCapaActions)
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.preventionGrdThreats)
  await inMemoryDb.delete(schema.preventionGrdMeetings)
  await inMemoryDb.delete(schema.preventionGrdMatrices)
  await inMemoryDb.delete(schema.preventionGrdMembers)
  await inMemoryDb.delete(schema.preventionGrdCoordinators)
  await inMemoryDb.delete(schema.preventionGrdCommittees)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values([
    { id: USER_MANAGER, name: "Gestor CGRD", email: "cgrd-manager@example.test", hashedPassword: "x" },
    { id: USER_PUBLISHER, name: "Publicador CGRD", email: "cgrd-publisher@example.test", hashedPassword: "x" },
    { id: "user-cgrd-outsider", name: "Ajeno", email: "cgrd-outsider@example.test", hashedPassword: "x" },
  ])
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena A", code: "FCA", isActive: true },
    { id: WS_B, name: "Faena B", code: "FCB", isActive: true },
  ])
  await inMemoryDb.insert(schema.workers).values([
    { id: WORKER_A, firstName: "Ana", lastName: "Pérez", worksiteId: WS_A, isActive: true },
    { id: WORKER_B, firstName: "Bruno", lastName: "Soto", worksiteId: WS_B, isActive: true },
  ])
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: PROGRAM_YEAR, title: `PDTP ${PROGRAM_YEAR} CGRD`,
    status: "active", elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  })
  await Promise.all([seedPdtpActivity(79), seedPdtpActivity(80), seedPdtpActivity(81)])
})

describe("constituteGrdCommittee", () => {
  it("constituye el comité y acredita la N°79", async () => {
    const committee = await constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD Faena A", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01", evidenceUrl: EVIDENCE }, MANAGER)
    expect(committee.status).toBe("active")
    expect(committee.evidenceUrl).toBe(EVIDENCE)

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, `${PROGRAM_ID}-a-79`))
    expect(executions).toHaveLength(1)
    expect(executions[0]?.evidenceText).toBe(EVIDENCE)
  })

  it("exige evidencia de la constitución", async () => {
    await expect(constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD Faena A", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01", evidenceUrl: "" }, MANAGER))
      .rejects.toThrow()
  })

  it("no admite dos comités activos en la misma faena", async () => {
    await constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD Faena A", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01", evidenceUrl: EVIDENCE }, MANAGER)
    await expect(constituteGrdCommittee({ worksiteId: WS_A, name: "Otro CGRD", constitutedOn: "2026-03-02", mandateEndsOn: "2028-03-02", evidenceUrl: EVIDENCE }, MANAGER))
      .rejects.toThrow(/ya tiene un Comité/)
  })

  it("deniega constituir fuera del alcance de faena", async () => {
    await expect(constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD ajeno", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01", evidenceUrl: EVIDENCE }, OUTSIDER))
      .rejects.toThrow(/no encontrado o fuera de alcance/)
  })

  it("disuelve el comité con lock optimista", async () => {
    const committee = await constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD Faena A", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01", evidenceUrl: EVIDENCE }, MANAGER)
    await expect(dissolveGrdCommittee({ committeeId: committee.id, expectedVersion: 99, reason: "Motivo de prueba suficiente" }, MANAGER))
      .rejects.toThrow(/cambió mientras/)
    const dissolved = await dissolveGrdCommittee({ committeeId: committee.id, expectedVersion: committee.version, reason: "Motivo de prueba suficiente" }, MANAGER)
    expect(dissolved.status).toBe("dissolved")
  })
})

describe("integrantes", () => {
  it("agrega y retira un integrante, rechaza a quien no pertenece a la faena", async () => {
    const committee = await constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD Faena A", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01", evidenceUrl: EVIDENCE }, MANAGER)
    await expect(addGrdMember({ committeeId: committee.id, workerId: WORKER_B, role: "integrante" }, MANAGER))
      .rejects.toThrow(/no admite integrantes de otra faena/)
    const member = await addGrdMember({ committeeId: committee.id, workerId: WORKER_A, role: "presidente" }, MANAGER)
    expect(member.role).toBe("presidente")
    const removed = await removeGrdMember({ memberId: member.id, reason: "Motivo de prueba suficiente" }, MANAGER)
    expect(removed.status).toBe("resigned")
  })
})

describe("matriz GRD — borrador → publicada, N°80", () => {
  async function publishedMatrix(worksiteId: string, title = "Matriz GRD v1") {
    const matrix = await createGrdMatrixDraft({ worksiteId, title, revisionReason: "Primera versión de la matriz" }, MANAGER)
    await addGrdThreat({ matrixId: matrix.id, name: "Incendio forestal", origin: "obligatoria", historicalAnalysis: "Antecedentes históricos suficientes", legalRequirement: "Requisito legal aplicable", workPlan: "Plan de trabajo definido" }, MANAGER)
    const published = await publishGrdMatrix({ matrixId: matrix.id, expectedVersion: matrix.version, evidenceUrl: EVIDENCE }, PUBLISHER)
    return { matrix, published }
  }

  it("no publica una matriz sin amenazas", async () => {
    const matrix = await createGrdMatrixDraft({ worksiteId: WS_A, title: "Matriz vacía", revisionReason: "Motivo de prueba suficiente" }, MANAGER)
    await expect(publishGrdMatrix({ matrixId: matrix.id, expectedVersion: matrix.version, evidenceUrl: EVIDENCE }, PUBLISHER))
      .rejects.toThrow(/sin amenazas/)
  })

  it("exige evidencia para publicar", async () => {
    const matrix = await createGrdMatrixDraft({ worksiteId: WS_A, title: "Matriz", revisionReason: "Motivo de prueba suficiente" }, MANAGER)
    await addGrdThreat({ matrixId: matrix.id, name: "Sismo", origin: "detectada", historicalAnalysis: "Antecedentes suficientes", legalRequirement: "Requisito legal", workPlan: "Plan de trabajo" }, MANAGER)
    await expect(publishGrdMatrix({ matrixId: matrix.id, expectedVersion: matrix.version, evidenceUrl: "" }, PUBLISHER))
      .rejects.toThrow()
  })

  /* La segregación queda en el permiso, no en una comparación de usuarios: el
   * PRF que edita la matriz no tiene `matrix:publish`. */
  it("quien edita la matriz no tiene permiso para publicarla", async () => {
    const matrix = await createGrdMatrixDraft({ worksiteId: WS_A, title: "Matriz", revisionReason: "Motivo de prueba suficiente" }, MANAGER)
    await addGrdThreat({ matrixId: matrix.id, name: "Sismo", origin: "detectada", historicalAnalysis: "Antecedentes suficientes", legalRequirement: "Requisito legal", workPlan: "Plan de trabajo" }, MANAGER)
    await expect(publishGrdMatrix({ matrixId: matrix.id, expectedVersion: matrix.version, evidenceUrl: EVIDENCE }, MANAGER))
      .rejects.toThrow(/no encontrado o fuera de alcance/)
  })

  it("publica, acredita la N°80 con la evidencia real y bloquea sus amenazas", async () => {
    const { matrix, published } = await publishedMatrix(WS_A)
    expect(published.status).toBe("published")
    expect(published.evidenceUrl).toBe(EVIDENCE)
    expect(published.publishedByUserId).toBe(USER_PUBLISHER)

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, `${PROGRAM_ID}-a-80`))
    expect(executions).toHaveLength(1)
    expect(executions[0]?.evidenceText).toBe(EVIDENCE)

    const threatId = (await inMemoryDb.select().from(schema.preventionGrdThreats).where(eq(schema.preventionGrdThreats.matrixId, matrix.id)))[0]!.id
    await expect(removeGrdThreat({ threatId }, MANAGER)).rejects.toThrow(/versión en borrador/)
  })

  it("una nueva versión publicada reemplaza (supersede) a la anterior — una sola publicada por faena", async () => {
    const { matrix: first } = await publishedMatrix(WS_A)

    const second = await createGrdMatrixDraft({ worksiteId: WS_A, title: "Matriz GRD v2", revisionReason: "Segunda versión de prueba" }, MANAGER)
    await addGrdThreat({ matrixId: second.id, name: "Inundación", origin: "detectada", historicalAnalysis: "Antecedentes suficientes", legalRequirement: "Requisito legal", workPlan: "Plan de trabajo" }, MANAGER)
    await publishGrdMatrix({ matrixId: second.id, expectedVersion: second.version, evidenceUrl: EVIDENCE }, PUBLISHER)

    const [firstAfter] = await inMemoryDb.select().from(schema.preventionGrdMatrices).where(eq(schema.preventionGrdMatrices.id, first.id))
    expect(firstAfter?.status).toBe("superseded")

    const published = await inMemoryDb.select().from(schema.preventionGrdMatrices).where(eq(schema.preventionGrdMatrices.worksiteId, WS_A))
    expect(published.filter((row) => row.status === "published")).toHaveLength(1)
  })
})

describe("actas de reunión — N°81", () => {
  it("registra el acta ya realizada y acredita la N°81", async () => {
    const committee = await constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01", evidenceUrl: EVIDENCE }, MANAGER)
    const meeting = await recordGrdMeeting({
      committeeId: committee.id, heldOn: "2026-04-01T15:00:00.000Z", agenda: "Revisión de amenazas del período",
      minutes: "Acta de la sesión con el detalle suficiente de lo tratado", quorumReached: true, evidenceUrl: EVIDENCE,
    }, MANAGER)
    expect(meeting.evidenceUrl).toBe(EVIDENCE)

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, `${PROGRAM_ID}-a-81`))
    expect(executions).toHaveLength(1)
  })

  it("exige evidencia del acta", async () => {
    const committee = await constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01", evidenceUrl: EVIDENCE }, MANAGER)
    await expect(recordGrdMeeting({
      committeeId: committee.id, heldOn: "2026-04-01T15:00:00.000Z", agenda: "Revisión de amenazas del período",
      minutes: "Acta de la sesión con el detalle suficiente de lo tratado", quorumReached: true, evidenceUrl: "",
    }, MANAGER)).rejects.toThrow()
  })

  it("un comité disuelto no puede registrar sesiones", async () => {
    const committee = await constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01", evidenceUrl: EVIDENCE }, MANAGER)
    await dissolveGrdCommittee({ committeeId: committee.id, expectedVersion: committee.version, reason: "Motivo de prueba suficiente" }, MANAGER)
    await expect(recordGrdMeeting({
      committeeId: committee.id, heldOn: "2026-04-01T15:00:00.000Z", agenda: "Revisión de amenazas del período",
      minutes: "Acta de la sesión con el detalle suficiente de lo tratado", quorumReached: true, evidenceUrl: EVIDENCE,
    }, MANAGER)).rejects.toThrow(/disuelto o vencido/)
  })
})

describe("acuerdos del acta — derivados a CAPA", () => {
  async function committeeFixture() {
    return constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01", evidenceUrl: EVIDENCE }, MANAGER)
  }

  it("cada acuerdo abre una CAPA con su plazo y prioridad, y el acuerdo la referencia", async () => {
    const committee = await committeeFixture()
    const meeting = await recordGrdMeeting({
      committeeId: committee.id, heldOn: "2026-04-01T15:00:00.000Z", agenda: "Revisión de amenazas del período",
      minutes: "Acta de la sesión con el detalle suficiente de lo tratado", quorumReached: true, evidenceUrl: EVIDENCE,
      agreements: [
        { description: "Señalizar la zona de acopio inundable", actionDescription: "Instalar señalética y demarcar el perímetro", priority: "high", targetDate: "2026-05-15" },
        { description: "Capacitar en evacuación por aluvión", actionDescription: "Programar la charla con la mutual", priority: "medium", targetDate: "2026-06-30" },
      ],
    }, MANAGER)

    const capas = await inMemoryDb.select().from(schema.preventionCapaActions)
    expect(capas).toHaveLength(2)
    expect(capas.every((capa) => capa.sourceType === "cgrd")).toBe(true)
    expect(capas.every((capa) => capa.sourceId === meeting.id)).toBe(true)
    expect(capas.every((capa) => capa.worksiteId === WS_A)).toBe(true)
    expect(capas.map((capa) => capa.priority).sort()).toEqual(["high", "medium"])
    expect(capas.every((capa) => capa.status === "pending")).toBe(true)

    // El acuerdo referencia su CAPA y no espeja su estado: no tiene columna `status`.
    const agreements = await listGrdAgreements(committee.id, MANAGER)
    expect(agreements).toHaveLength(2)
    expect(agreements.every((agreement) => agreement.capaActionId !== null)).toBe(true)
    expect(agreements.every((agreement) => agreement.capaStatus === "pending")).toBe(true)
    expect(agreements.find((agreement) => agreement.description.startsWith("Señalizar"))?.capaTargetDate).toBe("2026-05-15")
  })

  it("un acta sin acuerdos sigue registrándose: no toda acta produce compromisos", async () => {
    const committee = await committeeFixture()
    const meeting = await recordGrdMeeting({
      committeeId: committee.id, heldOn: "2026-04-01T15:00:00.000Z", agenda: "Revisión de amenazas del período",
      minutes: "Acta de la sesión con el detalle suficiente de lo tratado", quorumReached: true, evidenceUrl: EVIDENCE,
    }, MANAGER)
    expect(meeting.id).toBeTruthy()
    expect(await inMemoryDb.select().from(schema.preventionCapaActions)).toHaveLength(0)
    expect(await listGrdAgreements(committee.id, MANAGER)).toHaveLength(0)
  })

  it("si un acuerdo es inválido, el acta NO queda registrada a medias: revierte todo", async () => {
    const committee = await committeeFixture()
    await expect(recordGrdMeeting({
      committeeId: committee.id, heldOn: "2026-04-01T15:00:00.000Z", agenda: "Revisión de amenazas del período",
      minutes: "Acta de la sesión con el detalle suficiente de lo tratado", quorumReached: true, evidenceUrl: EVIDENCE,
      agreements: [
        { description: "Acuerdo válido con descripción", actionDescription: "Acción comprometida", priority: "medium", targetDate: "2026-05-15" },
        // Responsable inexistente: `createCapaActionWithClient` lo rechaza.
        { description: "Acuerdo con responsable fantasma", actionDescription: "Acción comprometida", responsibleUserId: "user-que-no-existe", priority: "medium", targetDate: "2026-05-20" },
      ],
    }, MANAGER)).rejects.toThrow()

    expect(await inMemoryDb.select().from(schema.preventionGrdMeetings)).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.preventionCapaActions)).toHaveLength(0)
    expect(await listGrdAgreements(committee.id, MANAGER)).toHaveLength(0)
    // Y por lo tanto tampoco se acreditó la N°81.
    expect(await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, `${PROGRAM_ID}-a-81`))).toHaveLength(0)
  })
})

describe("umbral del DS 44 — coordinador hasta 25, comité desde 26", () => {
  /** WS_A parte con un solo trabajador (WORKER_A) en el fixture. */
  async function growWorksiteTo(count: number) {
    const now = new Date().toISOString()
    const existing = await inMemoryDb.select().from(schema.workers).where(eq(schema.workers.worksiteId, WS_A))
    const extra = Array.from({ length: Math.max(0, count - existing.length) }, (_, index) => ({
      id: `worker-cgrd-fill-${index}`, firstName: `Persona${index}`, lastName: "Relleno",
      worksiteId: WS_A, isActive: true, createdAt: now,
    }))
    if (extra.length > 0) await inMemoryDb.insert(schema.workers).values(extra)
  }

  it("designa coordinador en faena chica y acredita la N°79 con esa figura", async () => {
    const coordinator = await designateGrdCoordinator({ worksiteId: WS_A, workerId: WORKER_A, designatedOn: "2026-03-01", evidenceUrl: EVIDENCE }, MANAGER)
    expect(coordinator.status).toBe("active")
    expect(coordinator.evidenceUrl).toBe(EVIDENCE)

    // La N°79 se cumple con el órgano que corresponde, no sólo con el comité.
    const executions = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, `${PROGRAM_ID}-a-79`))
    expect(executions).toHaveLength(1)

    const status = await getGrdStructureStatus(WS_A, MANAGER)
    expect(status).toMatchObject({ required: "coordinator", existing: "coordinator", satisfied: true })
  })

  it("desde 26 personas rechaza designar coordinador: la norma exige comité", async () => {
    await growWorksiteTo(26)
    await expect(designateGrdCoordinator({ worksiteId: WS_A, workerId: WORKER_A, designatedOn: "2026-03-01", evidenceUrl: EVIDENCE }, MANAGER))
      .rejects.toThrow(/corresponde constituir el CGRD/)
  })

  it("un coordinador designado deja de bastar si la faena crece: la brecha queda visible", async () => {
    await designateGrdCoordinator({ worksiteId: WS_A, workerId: WORKER_A, designatedOn: "2026-03-01", evidenceUrl: EVIDENCE }, MANAGER)
    await growWorksiteTo(30)
    const status = await getGrdStructureStatus(WS_A, MANAGER)
    expect(status).toMatchObject({ required: "committee", existing: "coordinator", satisfied: false })
    expect(status.headcount).toBe(30)
  })

  it("constituir el comité reemplaza al coordinador: la norma pide un órgano, no dos", async () => {
    const coordinator = await designateGrdCoordinator({ worksiteId: WS_A, workerId: WORKER_A, designatedOn: "2026-03-01", evidenceUrl: EVIDENCE }, MANAGER)
    await constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD Faena A", constitutedOn: "2026-04-01", mandateEndsOn: "2028-04-01", evidenceUrl: EVIDENCE }, MANAGER)

    const [after] = await inMemoryDb.select().from(schema.preventionGrdCoordinators).where(eq(schema.preventionGrdCoordinators.id, coordinator.id))
    expect(after?.status).toBe("ended")
    expect(after?.endedReason).toMatch(/Reemplazado por el CGRD/)

    const status = await getGrdStructureStatus(WS_A, MANAGER)
    expect(status).toMatchObject({ existing: "committee", satisfied: true })
  })

  it("un comité en faena chica es válido: la norma fija un mínimo, no un techo", async () => {
    await constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD Faena A", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01", evidenceUrl: EVIDENCE }, MANAGER)
    const status = await getGrdStructureStatus(WS_A, MANAGER)
    expect(status).toMatchObject({ required: "coordinator", existing: "committee", satisfied: true })
  })

  it("rechaza un coordinador de otra faena y termina la designación con motivo", async () => {
    await expect(designateGrdCoordinator({ worksiteId: WS_A, workerId: WORKER_B, designatedOn: "2026-03-01", evidenceUrl: EVIDENCE }, MANAGER))
      .rejects.toThrow(/debe pertenecer al centro de trabajo/)

    const coordinator = await designateGrdCoordinator({ worksiteId: WS_A, workerId: WORKER_A, designatedOn: "2026-03-01", evidenceUrl: EVIDENCE }, MANAGER)
    await expect(designateGrdCoordinator({ worksiteId: WS_A, workerId: WORKER_A, designatedOn: "2026-03-02", evidenceUrl: EVIDENCE }, MANAGER))
      .rejects.toThrow(/ya tiene un coordinador/)

    const ended = await endGrdCoordinator({ coordinatorId: coordinator.id, expectedVersion: coordinator.version, reason: "Motivo de término suficiente" }, MANAGER)
    expect(ended.status).toBe("ended")
  })
})
