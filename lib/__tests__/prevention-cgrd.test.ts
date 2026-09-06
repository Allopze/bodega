/**
 * lib/__tests__/prevention-cgrd.test.ts
 *
 * CGRD del DS 44 (G15): comité propio del DS 44 (distinto del CPHS), matriz
 * GRD con la máquina de estados de la MIPER (tres firmas segregadas, hash de
 * lo publicado, una sola publicada por faena) y actas que sí acreditan
 * (a diferencia del CPHS, que no acredita su reunión mensual por la D5).
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
  createGrdMatrixDraft, addGrdThreat, removeGrdThreat, transitionGrdMatrix,
  scheduleGrdMeeting, closeGrdMeeting, cancelGrdMeeting, listGrdAgreements,
  designateGrdCoordinator, endGrdCoordinator, getGrdStructureStatus,
} = await import("@/lib/services/prevention-cgrd")

const { year: PROGRAM_YEAR } = chileDateParts()
const PROGRAM_ID = "pdtp-cgrd-v1"
const WS_A = "ws-cgrd-a"
const WS_B = "ws-cgrd-b"
const USER_MANAGER = "user-cgrd-manager"
const USER_REVIEWER = "user-cgrd-reviewer"
const USER_APPROVER = "user-cgrd-approver"
const USER_PUBLISHER = "user-cgrd-publisher"
/* La jefatura técnica del área: única que puede firmar lo suyo. */
const USER_HEAD = "user-cgrd-head"
const WORKER_A = "worker-cgrd-a"
const WORKER_B = "worker-cgrd-b"

const scopeA = { mode: "some", ids: [WS_A] } as WorksiteScope
const scopeB = { mode: "some", ids: [WS_B] } as WorksiteScope
const scopeAll = { mode: "all", ids: [] } as WorksiteScope

const MANAGER = { userId: USER_MANAGER, scope: scopeA, permissions: [
  "prevention:cgrd:view", "prevention:cgrd:committee:manage", "prevention:cgrd:matrix:edit", "prevention:cgrd:meeting:manage",
] }
const REVIEWER = { userId: USER_REVIEWER, scope: scopeAll, permissions: ["prevention:cgrd:view", "prevention:cgrd:matrix:review"] }
const APPROVER = { userId: USER_APPROVER, scope: scopeAll, permissions: ["prevention:cgrd:view", "prevention:cgrd:matrix:approve", "prevention:cgrd:matrix:publish"] }
const PUBLISHER = { userId: USER_PUBLISHER, scope: scopeAll, permissions: ["prevention:cgrd:view", "prevention:cgrd:matrix:publish"] }
const HEAD = { userId: USER_HEAD, scope: scopeAll, permissions: [
  "prevention:cgrd:view", "prevention:cgrd:matrix:edit", "prevention:cgrd:matrix:approve",
  "prevention:cgrd:matrix:publish", "prevention:sign_own_work",
] }
const OUTSIDER = { userId: "user-cgrd-outsider", scope: scopeB, permissions: [
  "prevention:cgrd:view", "prevention:cgrd:committee:manage", "prevention:cgrd:matrix:edit", "prevention:cgrd:meeting:manage",
] }

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
    { id: USER_REVIEWER, name: "Revisor CGRD", email: "cgrd-reviewer@example.test", hashedPassword: "x" },
    { id: USER_APPROVER, name: "Aprobador CGRD", email: "cgrd-approver@example.test", hashedPassword: "x" },
    { id: USER_PUBLISHER, name: "Publicador CGRD", email: "cgrd-publisher@example.test", hashedPassword: "x" },
    { id: USER_HEAD, name: "Jefatura de Prevención", email: "cgrd-head@example.test", hashedPassword: "x" },
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
    const committee = await constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD Faena A", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01" }, MANAGER)
    expect(committee.status).toBe("active")

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, `${PROGRAM_ID}-a-79`))
    expect(executions).toHaveLength(1)
  })

  it("no admite dos comités activos en la misma faena", async () => {
    await constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD Faena A", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01" }, MANAGER)
    await expect(constituteGrdCommittee({ worksiteId: WS_A, name: "Otro CGRD", constitutedOn: "2026-03-02", mandateEndsOn: "2028-03-02" }, MANAGER))
      .rejects.toThrow(/ya tiene un Comité/)
  })

  it("deniega constituir fuera del alcance de faena", async () => {
    await expect(constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD ajeno", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01" }, OUTSIDER))
      .rejects.toThrow(/no encontrado o fuera de alcance/)
  })

  it("disuelve el comité con lock optimista", async () => {
    const committee = await constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD Faena A", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01" }, MANAGER)
    await expect(dissolveGrdCommittee({ committeeId: committee.id, expectedVersion: 99, reason: "Motivo de prueba suficiente" }, MANAGER))
      .rejects.toThrow(/cambió mientras/)
    const dissolved = await dissolveGrdCommittee({ committeeId: committee.id, expectedVersion: committee.version, reason: "Motivo de prueba suficiente" }, MANAGER)
    expect(dissolved.status).toBe("dissolved")
  })
})

describe("integrantes", () => {
  it("agrega y retira un integrante, rechaza a quien no pertenece a la faena", async () => {
    const committee = await constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD Faena A", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01" }, MANAGER)
    await expect(addGrdMember({ committeeId: committee.id, workerId: WORKER_B, role: "integrante" }, MANAGER))
      .rejects.toThrow(/no admite integrantes de otra faena/)
    const member = await addGrdMember({ committeeId: committee.id, workerId: WORKER_A, role: "presidente" }, MANAGER)
    expect(member.role).toBe("presidente")
    const removed = await removeGrdMember({ memberId: member.id, reason: "Motivo de prueba suficiente" }, MANAGER)
    expect(removed.status).toBe("resigned")
  })
})

describe("matriz GRD — máquina de estados y N°80", () => {
  async function publishFullCycle(worksiteId: string) {
    const committee = await constituteGrdCommittee({ worksiteId, name: "CGRD", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01" }, MANAGER)
    const matrix = await createGrdMatrixDraft({ worksiteId, title: "Matriz GRD v1", revisionReason: "Primera versión de la matriz" }, MANAGER)
    await addGrdThreat({ matrixId: matrix.id, name: "Incendio forestal", origin: "obligatoria", historicalAnalysis: "Antecedentes históricos suficientes", legalRequirement: "Requisito legal aplicable", workPlan: "Plan de trabajo definido" }, MANAGER)
    const inReview = await transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: matrix.version, toStatus: "in_review", reason: "Envío a revisión de prueba" }, MANAGER)
    const reviewed = await transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: inReview.version, toStatus: "reviewed", reason: "Revisión técnica de prueba" }, REVIEWER)
    const approved = await transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: reviewed.version, toStatus: "approved", reason: "Aprobación de prueba" }, APPROVER)
    const published = await transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: approved.version, toStatus: "published", reason: "Publicación de prueba" }, PUBLISHER)
    return { committee, matrix, published }
  }

  it("no envía a revisión una matriz sin amenazas", async () => {
    const matrix = await createGrdMatrixDraft({ worksiteId: WS_A, title: "Matriz vacía", revisionReason: "Motivo de prueba suficiente" }, MANAGER)
    await expect(transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: matrix.version, toStatus: "in_review", reason: "Envío a revisión de prueba" }, MANAGER))
      .rejects.toThrow(/sin amenazas/)
  })

  /* La cuarta firma. Hasta ahora publicar no comprobaba nada: la separación
   * entre quien aprueba y quien publica la daba sólo el reparto de permisos, y
   * eso se cae en cuanto un rol tiene los dos. */
  it("segrega la publicación de la aprobación, y exime a la jefatura técnica", async () => {
    const matrix = await createGrdMatrixDraft({ worksiteId: WS_A, title: "Matriz publicación", revisionReason: "Motivo de prueba suficiente" }, MANAGER)
    await addGrdThreat({ matrixId: matrix.id, name: "Sismo", origin: "detectada", historicalAnalysis: "Antecedentes suficientes", legalRequirement: "Requisito legal", workPlan: "Plan de trabajo" }, MANAGER)
    const inReview = await transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: matrix.version, toStatus: "in_review", reason: "Envío a revisión de prueba" }, MANAGER)
    const reviewed = await transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: inReview.version, toStatus: "reviewed", reason: "Revisión técnica" }, REVIEWER)
    const approved = await transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: reviewed.version, toStatus: "approved", reason: "Aprobación de prueba" }, APPROVER)

    await expect(transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: approved.version, toStatus: "published", reason: "Publicación de prueba" }, APPROVER))
      .rejects.toThrow(/no puede publicarla/)

    const published = await transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: approved.version, toStatus: "published", reason: "Publicación de prueba" }, PUBLISHER)
    expect(published.status).toBe("published")
  })

  it("la jefatura técnica publica lo que ella misma aprobó", async () => {
    const matrix = await createGrdMatrixDraft({ worksiteId: WS_A, title: "Matriz de la jefatura", revisionReason: "Motivo de prueba suficiente" }, MANAGER)
    await addGrdThreat({ matrixId: matrix.id, name: "Incendio", origin: "detectada", historicalAnalysis: "Antecedentes suficientes", legalRequirement: "Requisito legal", workPlan: "Plan de trabajo" }, MANAGER)
    const inReview = await transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: matrix.version, toStatus: "in_review", reason: "Envío a revisión de prueba" }, MANAGER)
    const reviewed = await transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: inReview.version, toStatus: "reviewed", reason: "Revisión técnica" }, REVIEWER)
    const approved = await transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: reviewed.version, toStatus: "approved", reason: "Aprobación" }, HEAD)

    // El mismo actor que aprobó, publicando: es la excepción, y funciona.
    const published = await transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: approved.version, toStatus: "published", reason: "Publicación" }, HEAD)
    expect(published.status).toBe("published")
    expect(published.approvedByUserId).toBe(USER_HEAD)
    expect(published.publishedByUserId).toBe(USER_HEAD)
  })

  /* La exención levanta el último eslabón, no los anteriores: aprobar sigue
   * exigiendo no haber creado ni revisado, también para la jefatura. */
  it("la exención no alcanza a la aprobación de lo que la jefatura creó", async () => {
    const matrix = await createGrdMatrixDraft({ worksiteId: WS_A, title: "Matriz propia", revisionReason: "Motivo de prueba suficiente" }, HEAD)
    await addGrdThreat({ matrixId: matrix.id, name: "Tsunami", origin: "detectada", historicalAnalysis: "Antecedentes suficientes", legalRequirement: "Requisito legal", workPlan: "Plan de trabajo" }, HEAD)
    const inReview = await transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: matrix.version, toStatus: "in_review", reason: "Envío a revisión de prueba" }, HEAD)
    const reviewed = await transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: inReview.version, toStatus: "reviewed", reason: "Revisión técnica" }, REVIEWER)

    await expect(transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: reviewed.version, toStatus: "approved", reason: "Aprobación" }, HEAD))
      .rejects.toThrow(/segregada de creación y revisión/)
  })

  it("segrega creación de revisión y de aprobación", async () => {
    const matrix = await createGrdMatrixDraft({ worksiteId: WS_A, title: "Matriz", revisionReason: "Motivo de prueba suficiente" }, MANAGER)
    await addGrdThreat({ matrixId: matrix.id, name: "Aluvión", origin: "detectada", historicalAnalysis: "Antecedentes suficientes", legalRequirement: "Requisito legal", workPlan: "Plan de trabajo" }, MANAGER)
    const inReview = await transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: matrix.version, toStatus: "in_review", reason: "Envío a revisión de prueba" }, MANAGER)
    // El creador (MANAGER, con permiso de revisión también) no puede revisar su propia versión.
    const managerAsReviewer = { ...MANAGER, permissions: [...MANAGER.permissions, "prevention:cgrd:matrix:review"] }
    await expect(transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: inReview.version, toStatus: "reviewed", reason: "Revisión de prueba" }, managerAsReviewer))
      .rejects.toThrow(/no puede revisarla/)
    const reviewed = await transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: inReview.version, toStatus: "reviewed", reason: "Revisión de prueba" }, REVIEWER)
    const reviewerAsApprover = { ...REVIEWER, permissions: [...REVIEWER.permissions, "prevention:cgrd:matrix:approve"] }
    await expect(transitionGrdMatrix({ matrixId: matrix.id, expectedVersion: reviewed.version, toStatus: "approved", reason: "Aprobación de prueba" }, reviewerAsApprover))
      .rejects.toThrow(/segregada/)
  })

  it("publica, acredita la N°80 y deja el hash", async () => {
    const { matrix, published } = await publishFullCycle(WS_A)
    expect(published.status).toBe("published")
    expect(published.publishedHashSha256).toBeTruthy()

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, `${PROGRAM_ID}-a-80`))
    expect(executions).toHaveLength(1)

    const threatId = (await inMemoryDb.select().from(schema.preventionGrdThreats).where(eq(schema.preventionGrdThreats.matrixId, matrix.id)))[0]!.id
    await expect(removeGrdThreat({ threatId }, MANAGER)).rejects.toThrow(/versión en borrador/)
  })

  it("una nueva versión publicada reemplaza (supersede) a la anterior — una sola publicada por faena", async () => {
    const { matrix: first } = await publishFullCycle(WS_A)

    const second = await createGrdMatrixDraft({ worksiteId: WS_A, title: "Matriz GRD v2", revisionReason: "Segunda versión de prueba" }, MANAGER)
    await addGrdThreat({ matrixId: second.id, name: "Inundación", origin: "detectada", historicalAnalysis: "Antecedentes suficientes", legalRequirement: "Requisito legal", workPlan: "Plan de trabajo" }, MANAGER)
    const inReview = await transitionGrdMatrix({ matrixId: second.id, expectedVersion: second.version, toStatus: "in_review", reason: "Envío a revisión de prueba" }, MANAGER)
    const reviewed = await transitionGrdMatrix({ matrixId: second.id, expectedVersion: inReview.version, toStatus: "reviewed", reason: "Revisión de prueba" }, REVIEWER)
    const approved = await transitionGrdMatrix({ matrixId: second.id, expectedVersion: reviewed.version, toStatus: "approved", reason: "Aprobación de prueba" }, APPROVER)
    await transitionGrdMatrix({ matrixId: second.id, expectedVersion: approved.version, toStatus: "published", reason: "Publicación de prueba" }, PUBLISHER)

    const [firstAfter] = await inMemoryDb.select().from(schema.preventionGrdMatrices).where(eq(schema.preventionGrdMatrices.id, first.id))
    expect(firstAfter?.status).toBe("superseded")

    const published = await inMemoryDb.select().from(schema.preventionGrdMatrices).where(eq(schema.preventionGrdMatrices.worksiteId, WS_A))
    expect(published.filter((row) => row.status === "published")).toHaveLength(1)
  })
})

describe("actas de reunión — N°81", () => {
  it("convoca, cierra y acredita la N°81; una cancelada no puede cerrarse", async () => {
    const committee = await constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01" }, MANAGER)
    const meeting = await scheduleGrdMeeting({ committeeId: committee.id, scheduledFor: "2026-04-01T15:00:00.000Z", agenda: "Revisión de amenazas del período" }, MANAGER)
    const closed = await closeGrdMeeting({ meetingId: meeting.id, expectedVersion: meeting.version, minutes: "Acta de la sesión con el detalle suficiente de lo tratado", quorumReached: true }, MANAGER)
    expect(closed.status).toBe("closed")

    const executions = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, `${PROGRAM_ID}-a-81`))
    expect(executions).toHaveLength(1)

    const other = await scheduleGrdMeeting({ committeeId: committee.id, scheduledFor: "2026-05-01T15:00:00.000Z", agenda: "Segunda sesión de prueba" }, MANAGER)
    await cancelGrdMeeting({ meetingId: other.id, expectedVersion: other.version, reason: "Motivo de cancelación suficiente" }, MANAGER)
    await expect(closeGrdMeeting({ meetingId: other.id, expectedVersion: other.version + 1, minutes: "Acta con detalle suficiente de la sesión", quorumReached: true }, MANAGER))
      .rejects.toThrow(/cancelada no puede cerrarse/)
  })
})

describe("acuerdos del acta — derivados a CAPA", () => {
  async function scheduledMeeting() {
    const committee = await constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01" }, MANAGER)
    const meeting = await scheduleGrdMeeting({ committeeId: committee.id, scheduledFor: "2026-04-01T15:00:00.000Z", agenda: "Revisión de amenazas del período" }, MANAGER)
    return { committee, meeting }
  }

  it("cada acuerdo abre una CAPA con su plazo y prioridad, y el acuerdo la referencia", async () => {
    const { committee, meeting } = await scheduledMeeting()
    await closeGrdMeeting({
      meetingId: meeting.id, expectedVersion: meeting.version,
      minutes: "Acta de la sesión con el detalle suficiente de lo tratado", quorumReached: true,
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

  it("un acta sin acuerdos sigue cerrando: no todo acta produce compromisos", async () => {
    const { committee, meeting } = await scheduledMeeting()
    const closed = await closeGrdMeeting({
      meetingId: meeting.id, expectedVersion: meeting.version,
      minutes: "Acta de la sesión con el detalle suficiente de lo tratado", quorumReached: true,
    }, MANAGER)
    expect(closed.status).toBe("closed")
    expect(await inMemoryDb.select().from(schema.preventionCapaActions)).toHaveLength(0)
    expect(await listGrdAgreements(committee.id, MANAGER)).toHaveLength(0)
  })

  it("si un acuerdo es inválido, el acta NO queda cerrada a medias: revierte todo", async () => {
    const { committee, meeting } = await scheduledMeeting()
    await expect(closeGrdMeeting({
      meetingId: meeting.id, expectedVersion: meeting.version,
      minutes: "Acta de la sesión con el detalle suficiente de lo tratado", quorumReached: true,
      agreements: [
        { description: "Acuerdo válido con descripción", actionDescription: "Acción comprometida", priority: "medium", targetDate: "2026-05-15" },
        // Responsable inexistente: `createCapaActionWithClient` lo rechaza.
        { description: "Acuerdo con responsable fantasma", actionDescription: "Acción comprometida", responsibleUserId: "user-que-no-existe", priority: "medium", targetDate: "2026-05-20" },
      ],
    }, MANAGER)).rejects.toThrow()

    const [meetingAfter] = await inMemoryDb.select().from(schema.preventionGrdMeetings).where(eq(schema.preventionGrdMeetings.id, meeting.id))
    expect(meetingAfter?.status).toBe("scheduled")
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
    const coordinator = await designateGrdCoordinator({ worksiteId: WS_A, workerId: WORKER_A, designatedOn: "2026-03-01" }, MANAGER)
    expect(coordinator.status).toBe("active")

    // La N°79 se cumple con el órgano que corresponde, no sólo con el comité.
    const executions = await inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, `${PROGRAM_ID}-a-79`))
    expect(executions).toHaveLength(1)

    const status = await getGrdStructureStatus(WS_A, MANAGER)
    expect(status).toMatchObject({ required: "coordinator", existing: "coordinator", satisfied: true })
  })

  it("desde 26 personas rechaza designar coordinador: la norma exige comité", async () => {
    await growWorksiteTo(26)
    await expect(designateGrdCoordinator({ worksiteId: WS_A, workerId: WORKER_A, designatedOn: "2026-03-01" }, MANAGER))
      .rejects.toThrow(/corresponde constituir el CGRD/)
  })

  it("un coordinador designado deja de bastar si la faena crece: la brecha queda visible", async () => {
    await designateGrdCoordinator({ worksiteId: WS_A, workerId: WORKER_A, designatedOn: "2026-03-01" }, MANAGER)
    await growWorksiteTo(30)
    const status = await getGrdStructureStatus(WS_A, MANAGER)
    expect(status).toMatchObject({ required: "committee", existing: "coordinator", satisfied: false })
    expect(status.headcount).toBe(30)
  })

  it("constituir el comité reemplaza al coordinador: la norma pide un órgano, no dos", async () => {
    const coordinator = await designateGrdCoordinator({ worksiteId: WS_A, workerId: WORKER_A, designatedOn: "2026-03-01" }, MANAGER)
    await constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD Faena A", constitutedOn: "2026-04-01", mandateEndsOn: "2028-04-01" }, MANAGER)

    const [after] = await inMemoryDb.select().from(schema.preventionGrdCoordinators).where(eq(schema.preventionGrdCoordinators.id, coordinator.id))
    expect(after?.status).toBe("ended")
    expect(after?.endedReason).toMatch(/Reemplazado por el CGRD/)

    const status = await getGrdStructureStatus(WS_A, MANAGER)
    expect(status).toMatchObject({ existing: "committee", satisfied: true })
  })

  it("un comité en faena chica es válido: la norma fija un mínimo, no un techo", async () => {
    await constituteGrdCommittee({ worksiteId: WS_A, name: "CGRD Faena A", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01" }, MANAGER)
    const status = await getGrdStructureStatus(WS_A, MANAGER)
    expect(status).toMatchObject({ required: "coordinator", existing: "committee", satisfied: true })
  })

  it("rechaza un coordinador de otra faena y termina la designación con motivo", async () => {
    await expect(designateGrdCoordinator({ worksiteId: WS_A, workerId: WORKER_B, designatedOn: "2026-03-01" }, MANAGER))
      .rejects.toThrow(/debe pertenecer al centro de trabajo/)

    const coordinator = await designateGrdCoordinator({ worksiteId: WS_A, workerId: WORKER_A, designatedOn: "2026-03-01" }, MANAGER)
    await expect(designateGrdCoordinator({ worksiteId: WS_A, workerId: WORKER_A, designatedOn: "2026-03-02" }, MANAGER))
      .rejects.toThrow(/ya tiene un coordinador/)

    const ended = await endGrdCoordinator({ coordinatorId: coordinator.id, expectedVersion: coordinator.version, reason: "Motivo de término suficiente" }, MANAGER)
    expect(ended.status).toBe("ended")
  })
})
