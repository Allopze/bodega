/**
 * lib/__tests__/pdtp-revocations.test.ts
 *
 * Seis operaciones deshacen un hecho que acreditó una actividad PDTP, y el
 * programa anual no puede seguir contándolo: disolver un comité paritario
 * (N°11), disolver el comité GRD y terminar la designación del coordinador
 * (N°79), anular un acta CGRD (N°81), cancelar un simulacro (N°84) y borrar un
 * acta SST (N°15, 17, 18, 19, 23, 52, 63).
 *
 * Dos de los cuatro (simulacro, acta SST) tienen una máquina de estados que
 * en la práctica de hoy nunca deja llegar a la revocación con una
 * acreditación viva: `cancelEmergencyDrill` sólo acepta un registro todavía
 * "scheduled" — el mismo estado que excluye el cierre que acredita — y
 * `deleteEvaluation` rechaza borrar un acta "cerrado", que es justamente la
 * que acredita. Se revoca de todas formas, en defensa de profundidad: si ese
 * guard cambia mañana, o una vía administrativa revierte el estado por otro
 * camino, la acreditación huérfana no debe sobrevivir. Esos dos casos
 * manipulan el estado directo en la base para poder ejercitar esa rama —
 * algo que ningún flujo de la aplicación puede producir hoy — y lo anotan en
 * el propio test.
 *
 * El acta CGRD (N°81) cambió de vía con la simplificación (2026-09-14): antes
 * se cancelaba una sesión convocada —cuando todavía no había nada acreditado
 * que revocar— y ahora se anula el acta ya registrada, que sí acreditó. El
 * registro no se borra: es lo que explica por qué el programa contó y después
 * descontó esa sesión.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { and, eq } from "drizzle-orm"
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
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const { constituteCommittee, dissolveCommittee, expireLapsedCommittees } = await import("@/lib/services/prevention-cphs")
const {
  constituteGrdCommittee, dissolveGrdCommittee,
  designateGrdCoordinator, endGrdCoordinator,
  recordGrdMeeting, annulGrdMeeting,
} = await import("@/lib/services/prevention-cgrd")
const {
  createEmergencyPlan, addEmergencyScenario, addEmergencyRole, approveEmergencyPlan,
  setEmergencyPlanPdtpActivities, scheduleEmergencyDrill, completeEmergencyDrill, cancelEmergencyDrill,
} = await import("@/lib/services/prevention-emergency")
const { closeEvaluation, deleteEvaluation } = await import("@/lib/services/sst-module/evaluations")

const PROGRAM_YEAR = chileDateParts().year
const PROGRAM_ID = "pdtp-revok-v1"
const WS_ID = "ws-revok-1"
const USER_ID = "user-revok-1"
const USER_APPROVER_ID = "user-revok-approver"
const WORKER_ID = "wk-revok-1"

const activityId = (n: number) => `${PROGRAM_ID}-a-${String(n).padStart(3, "0")}`

const scopeAll = { mode: "all", ids: [] } as WorksiteScope
const CPHS_ACCESS = { userId: USER_ID, scope: scopeAll, permissions: ["prevention:cphs:manage"] }
const CGRD_ACCESS = {
  userId: USER_ID, scope: scopeAll,
  permissions: ["prevention:cgrd:committee:manage", "prevention:cgrd:meeting:manage"],
}
const EMERGENCY_MANAGER = {
  userId: USER_ID, scope: scopeAll,
  permissions: ["prevention:emergency:manage", "prevention:emergency:drill_execute"],
}
const EMERGENCY_APPROVER = { userId: USER_APPROVER_ID, scope: scopeAll, permissions: ["prevention:emergency:approve"] }

async function revocationEventFor(sourceId: string) {
  const rows = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
    .where(and(eq(schema.pdtpFulfillmentEvents.eventType, "revoked"), eq(schema.pdtpFulfillmentEvents.sourceId, sourceId)))
  return rows[0]
}

async function executionsFor(n: number) {
  return inMemoryDb.select().from(schema.pdtpExecutions).where(eq(schema.pdtpExecutions.activityId, activityId(n)))
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.preventionCapaActions)
  await inMemoryDb.delete(schema.preventionGovernanceHistory)
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpObligations)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)

  await inMemoryDb.delete(schema.preventionCommittees)

  await inMemoryDb.delete(schema.preventionGrdAgreements)
  await inMemoryDb.delete(schema.preventionGrdMeetings)
  await inMemoryDb.delete(schema.preventionGrdCoordinators)
  await inMemoryDb.delete(schema.preventionGrdCommittees)

  await inMemoryDb.delete(schema.preventionEmergencyDrillParticipants)
  await inMemoryDb.delete(schema.preventionEmergencyDrills)
  await inMemoryDb.delete(schema.preventionEmergencyRoles)
  await inMemoryDb.delete(schema.preventionEmergencyScenarios)
  await inMemoryDb.delete(schema.preventionEmergencyPlans)

  await inMemoryDb.delete(schema.sstResponses)
  await inMemoryDb.delete(schema.sstScheduledFollowups)
  await inMemoryDb.delete(schema.sstEvaluations)

  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values([
    { id: USER_ID, name: "Prevencionista", email: "prev-revok@example.test", hashedPassword: "x" },
    { id: USER_APPROVER_ID, name: "Aprobador", email: "aprob-revok@example.test", hashedPassword: "x" },
  ])
  await inMemoryDb.insert(schema.worksites).values({ id: WS_ID, name: "Faena Revocaciones", code: "FR", isActive: true })
  await inMemoryDb.insert(schema.workers).values({
    id: WORKER_ID, rut: "16111222-3", firstName: "Ana", lastName: "Soto", worksiteId: WS_ID, isActive: true, createdAt: now,
  })
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: PROGRAM_YEAR, title: `PDTP ${PROGRAM_YEAR} revocaciones`,
    status: "active", elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivities).values([11, 79, 81, 84, 18].map((n) => ({
    id: activityId(n), programId: PROGRAM_ID, n,
    activity: `Actividad N°${n}`, program: "Prevención PDTP",
    responsibleSlugs: ["prevencionista_faena"], responsibleDisplay: "PRF",
    scheduleMode: "on_demand", scheduleClassificationStatus: "confirmed",
    mechanism: "enganche", sourceSheetRow: n, createdAt: now, updatedAt: now,
  })))
})

describe("dissolveCommittee revoca la N°11", () => {
  it("un comité disuelto ya no sostiene la constitución que acreditó al crearse", async () => {
    const committee = await constituteCommittee({
      worksiteId: WS_ID, name: "CPHS Faena Revocaciones", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01",
    }, CPHS_ACCESS)
    expect(await executionsFor(11)).toHaveLength(1)

    await dissolveCommittee({
      committeeId: committee.id, expectedVersion: committee.version, reason: "Fusión de faenas, motivo de prueba",
    }, CPHS_ACCESS)

    const revocacion = await revocationEventFor(committee.id)
    expect(revocacion?.status).toBe("revoked")
    const [ejecucion] = await executionsFor(11)
    expect(ejecucion!.status).toBe("draft")
  })
})

describe("expireLapsedCommittees revoca la N°11 de cada comité vencido", () => {
  it("recorre el barrido y revoca uno por uno después del commit", async () => {
    // El motor sólo acredita dentro del año del programa activo: la
    // constitución tiene que caer en `PROGRAM_YEAR`, y el vencimiento antes de
    // hoy para que el barrido la encuentre.
    // Ni el 1 de enero: `constitutedOn` viaja tal cual como `occurredAt`, sin
    // ancla de mediodía, y a medianoche UTC el 1 de enero cae en Chile todavía
    // en el 31 de diciembre del año anterior — fuera del programa.
    const committee = await constituteCommittee({
      worksiteId: WS_ID, name: "CPHS Vencido", constitutedOn: `${PROGRAM_YEAR}-01-15`, mandateEndsOn: `${PROGRAM_YEAR}-01-16`,
    }, CPHS_ACCESS)
    expect(await executionsFor(11)).toHaveLength(1)

    const result = await expireLapsedCommittees()
    expect(result.expired).toBe(1)

    const revocacion = await revocationEventFor(committee.id)
    expect(revocacion?.status).toBe("revoked")
    const [ejecucion] = await executionsFor(11)
    expect(ejecucion!.status).toBe("draft")
  })
})

describe("dissolveGrdCommittee revoca la N°79", () => {
  it("el sourceId lleva el mismo prefijo que onGrdStructureEstablished usó al constituirlo", async () => {
    const committee = await constituteGrdCommittee({
      worksiteId: WS_ID, name: "CGRD Faena Revocaciones", constitutedOn: "2026-03-01", mandateEndsOn: "2028-03-01",
      evidenceUrl: "https://drive.chome.cl/cgrd-evidencia",
    }, CGRD_ACCESS)
    expect(await executionsFor(79)).toHaveLength(1)

    await dissolveGrdCommittee({
      committeeId: committee.id, expectedVersion: committee.version, reason: "Motivo de prueba suficiente",
    }, CGRD_ACCESS)

    const revocacion = await revocationEventFor(`cgrd-committee:${committee.id}`)
    expect(revocacion?.status).toBe("revoked")
    const [ejecucion] = await executionsFor(79)
    expect(ejecucion!.status).toBe("draft")
  })
})

/* Faltaba: la rama del comité revocaba y la del coordinador no, así que una
 * faena chica quedaba con la N°79 acreditada sobre una designación terminada.
 * El órgano que acreditó ya no existe; el programa no puede seguir contándolo. */
describe("endGrdCoordinator revoca la N°79", () => {
  it("terminar la designación revierte lo que acreditó designarla", async () => {
    const coordinator = await designateGrdCoordinator({
      worksiteId: WS_ID, workerId: WORKER_ID, designatedOn: `${PROGRAM_YEAR}-03-10`,
      evidenceUrl: "https://drive.chome.cl/cgrd-designacion",
    }, CGRD_ACCESS)
    expect(await executionsFor(79)).toHaveLength(1)

    await endGrdCoordinator({
      coordinatorId: coordinator.id, expectedVersion: coordinator.version,
      reason: "La persona dejó la faena, motivo de prueba",
    }, CGRD_ACCESS)

    const revocacion = await revocationEventFor(`cgrd-coordinator:${coordinator.id}`)
    expect(revocacion?.status).toBe("revoked")
    const [ejecucion] = await executionsFor(79)
    expect(ejecucion!.status).toBe("draft")
  })
})

/* El acta se registra en un solo acto y acredita al instante, así que la única
 * forma de deshacer una mal cargada es anularla. Antes no había ninguna: la
 * cancelación del modelo anterior sólo servía antes de cerrar, cuando todavía
 * no había nada acreditado que revocar. */
describe("annulGrdMeeting revoca la N°81", () => {
  it("anular el acta revierte la acreditación y conserva la fila", async () => {
    const committee = await constituteGrdCommittee({
      worksiteId: WS_ID, name: "CGRD Faena Revocaciones", constitutedOn: `${PROGRAM_YEAR}-03-01`, mandateEndsOn: `${PROGRAM_YEAR + 2}-03-01`,
      evidenceUrl: "https://drive.chome.cl/cgrd-evidencia",
    }, CGRD_ACCESS)
    const meeting = await recordGrdMeeting({
      committeeId: committee.id, heldOn: `${PROGRAM_YEAR}-04-01T15:00:00.000Z`,
      agenda: "Agenda de prueba con largo suficiente",
      minutes: "Acta de la sesión de prueba, con contenido suficiente.",
      quorumReached: true, evidenceUrl: "https://drive.chome.cl/cgrd-acta",
    }, CGRD_ACCESS)
    expect(await executionsFor(81)).toHaveLength(1)

    const annulled = await annulGrdMeeting({
      meetingId: meeting.id, reason: "Se transcribió la sesión equivocada",
    }, CGRD_ACCESS)

    expect(annulled.annulledAt).toBeTruthy()
    expect(annulled.annulledReason).toMatch(/sesión equivocada/)

    const revocacion = await revocationEventFor(`cgrd-meeting:${meeting.id}`)
    expect(revocacion?.status).toBe("revoked")
    const [ejecucion] = await executionsFor(81)
    expect(ejecucion!.status).toBe("draft")

    // La fila sobrevive: es lo que explica por qué el programa contó y descontó.
    const rows = await inMemoryDb.select().from(schema.preventionGrdMeetings)
      .where(eq(schema.preventionGrdMeetings.id, meeting.id))
    expect(rows).toHaveLength(1)
  })

  it("no se anula dos veces", async () => {
    const committee = await constituteGrdCommittee({
      worksiteId: WS_ID, name: "CGRD doble anulación", constitutedOn: `${PROGRAM_YEAR}-03-01`, mandateEndsOn: `${PROGRAM_YEAR + 2}-03-01`,
      evidenceUrl: "https://drive.chome.cl/cgrd-evidencia",
    }, CGRD_ACCESS)
    const meeting = await recordGrdMeeting({
      committeeId: committee.id, heldOn: `${PROGRAM_YEAR}-04-02T15:00:00.000Z`,
      agenda: "Agenda de prueba con largo suficiente",
      minutes: "Acta de la sesión de prueba, con contenido suficiente.",
      quorumReached: true, evidenceUrl: "https://drive.chome.cl/cgrd-acta",
    }, CGRD_ACCESS)

    await annulGrdMeeting({ meetingId: meeting.id, reason: "Motivo de prueba suficiente" }, CGRD_ACCESS)
    await expect(annulGrdMeeting({ meetingId: meeting.id, reason: "Otro motivo suficiente" }, CGRD_ACCESS))
      .rejects.toThrow(/ya está anulada/)
  })
})

/**
 * EMG-001 (auditoría 2026-09-14), patrón P4: el cierre de un simulacro
 * registraba participantes, duración, evacuación, observaciones y resultado, y
 * abría una CAPA si hacía falta — pero **no tenía dónde adjuntar el respaldo
 * del propio simulacro**, y el conector PDTP acreditaba con el rótulo sintético
 * «Simulacro completado: <id>». El acta es la prueba que se exhibe en una
 * fiscalización.
 */
describe("EMG-001 — el acta del simulacro", () => {
  async function planConSimulacro(titulo: string) {
    const plan = await createEmergencyPlan({ worksiteId: WS_ID, title: titulo }, EMERGENCY_MANAGER)
    await addEmergencyScenario({
      planId: plan.id, type: "incendio_estructural", title: "Incendio de prueba",
      responseProcedure: "Activar alarma y evacuar por la ruta señalizada del sector.",
    }, EMERGENCY_MANAGER)
    await addEmergencyRole({
      planId: plan.id, roleName: "Jefe de emergencia", assigneeWorkerId: WORKER_ID,
    }, EMERGENCY_MANAGER)
    const approved = await approveEmergencyPlan({ planId: plan.id, expectedVersion: plan.version }, EMERGENCY_APPROVER)
    await setEmergencyPlanPdtpActivities({
      planId: plan.id, expectedVersion: approved.version, pdtpActivityNumbers: [84],
    }, EMERGENCY_MANAGER)
    return scheduleEmergencyDrill({
      planId: plan.id, scenarioType: "incendio_estructural",
      scheduledFor: new Date(Date.now() - 60_000).toISOString(),
    }, EMERGENCY_MANAGER)
  }

  const cerrar = (drill: { id: string; version: number }, extra: Record<string, unknown> = {}) =>
    completeEmergencyDrill({
      drillId: drill.id, expectedVersion: drill.version, executedAt: new Date().toISOString(),
      outcome: "satisfactory", participants: [{ workerId: WORKER_ID, present: true }], ...extra,
    }, EMERGENCY_MANAGER)

  it("se puede cerrar sin acta: hay simulacros cuyo respaldo es el registro de participantes", async () => {
    const drill = await planConSimulacro("Plan sin acta")
    const cerrado = await cerrar(drill)
    expect(cerrado.status).toBe("completed")
    expect(cerrado.evidencePath).toBeNull()
  })

  it("pero ahora existe el lugar, y el acta queda con su checksum", async () => {
    const drill = await planConSimulacro("Plan con acta")
    const cerrado = await cerrar(drill, {
      evidencePath: "storage/pdtp-evidence/acta-simulacro.pdf",
      evidenceChecksumSha256: "d".repeat(64),
    })
    expect(cerrado.evidencePath).toBe("storage/pdtp-evidence/acta-simulacro.pdf")
    expect(cerrado.evidenceChecksumSha256).toBe("d".repeat(64))
  })

  it("un acta sin checksum no se acepta: un archivo sin huella no es evidencia verificable", async () => {
    const drill = await planConSimulacro("Plan acta sin huella")
    await expect(cerrar(drill, { evidencePath: "storage/pdtp-evidence/acta.pdf" })).rejects.toThrow()
  })

  it("ni una ruta inventada, aunque traiga checksum", async () => {
    const drill = await planConSimulacro("Plan ruta inventada")
    await expect(cerrar(drill, {
      evidencePath: "el acta está en la carpeta compartida",
      evidenceChecksumSha256: "e".repeat(64),
    })).rejects.toThrow()
  })

  it("con acta, la acreditación PDTP referencia el archivo y no el rótulo sintético", async () => {
    const drill = await planConSimulacro("Plan acreditación")
    await cerrar(drill, {
      evidencePath: "storage/pdtp-evidence/acta-acreditada.pdf",
      evidenceChecksumSha256: "f".repeat(64),
    })
    // `evidenceRef` vive en el evento de cumplimiento, que es lo que el
    // conector escribe; la ejecución es su consecuencia.
    const eventos = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
    expect(eventos.at(-1)?.evidenceRef).toBe("storage/pdtp-evidence/acta-acreditada.pdf")
  })
})

describe("cancelEmergencyDrill revoca la N°84", () => {
  it("defensa en profundidad: hoy sólo un simulacro 'scheduled' se cancela, el mismo estado que completeEmergencyDrill excluye", async () => {
    const plan = await createEmergencyPlan({ worksiteId: WS_ID, title: "Plan de emergencia de prueba" }, EMERGENCY_MANAGER)
    await addEmergencyScenario({
      planId: plan.id, type: "incendio_estructural", title: "Incendio de prueba",
      responseProcedure: "Activar alarma y evacuar por la ruta señalizada del sector.",
    }, EMERGENCY_MANAGER)
    await addEmergencyRole({
      planId: plan.id, roleName: "Jefe de emergencia", assigneeWorkerId: WORKER_ID,
    }, EMERGENCY_MANAGER)
    const approved = await approveEmergencyPlan({ planId: plan.id, expectedVersion: plan.version }, EMERGENCY_APPROVER)
    const withActivities = await setEmergencyPlanPdtpActivities({
      planId: plan.id, expectedVersion: approved.version, pdtpActivityNumbers: [84],
    }, EMERGENCY_MANAGER)

    const drill = await scheduleEmergencyDrill({
      planId: plan.id, scenarioType: "incendio_estructural", scheduledFor: new Date(Date.now() - 60_000).toISOString(),
    }, EMERGENCY_MANAGER)
    const completed = await completeEmergencyDrill({
      drillId: drill.id, expectedVersion: drill.version, executedAt: new Date().toISOString(),
      outcome: "satisfactory", participants: [{ workerId: WORKER_ID, present: true }],
    }, EMERGENCY_MANAGER)
    expect(withActivities.pdtpActivityNumbers).toEqual([84])
    expect(await executionsFor(84)).toHaveLength(1)

    // `cancelEmergencyDrill` exige status "scheduled", que `completeEmergencyDrill`
    // ya dejó atrás. Se fuerza el estado de vuelta a mano por la misma razón que
    // en el acta CGRD: probar el cableado de la revocación para cuando esa vía
    // exista, no un caso que el guard actual permita hoy.
    await inMemoryDb.update(schema.preventionEmergencyDrills)
      .set({ status: "scheduled" })
      .where(eq(schema.preventionEmergencyDrills.id, drill.id))

    await cancelEmergencyDrill({
      drillId: drill.id, expectedVersion: completed.version, reason: "Se reprograma por lluvia",
    }, EMERGENCY_MANAGER)

    const revocacion = await revocationEventFor(drill.id)
    expect(revocacion?.status).toBe("revoked")
    const [ejecucion] = await executionsFor(84)
    expect(ejecucion!.status).toBe("draft")
  })
})

describe("deleteEvaluation revoca la N°18 del acta de trabajador nuevo", () => {
  it("defensa en profundidad: `deleteEvaluation` se niega a borrar un acta 'cerrado', que es justamente la que acredita", async () => {
    const EVAL_ID = "sstev-revok-1"
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.sstEvaluations).values({
      id: EVAL_ID, worksiteId: WS_ID, workerId: WORKER_ID, createdBy: USER_ID,
      definicionCode: "trabajador_nuevo", definicionVersion: "01", tipo: "nuevo",
      fechaEvaluacion: `${PROGRAM_YEAR}-04-01`, estado: "borrador",
      createdAt: now, updatedAt: now,
    })
    // Sólo el ítem del RIOHS, para cerrar exclusivamente la N°18 (la única
    // actividad sembrada en este test) sin arrastrar la N°19 ni la N°52.
    await inMemoryDb.insert(schema.sstResponses).values({
      id: "resp-revok-1", evaluationId: EVAL_ID, seccionId: "induccion_capacitacion",
      itemId: "riohs", estado: "entregado", observacion: null,
    })
    const { getDefinition } = await import("@/lib/sst/definitions")
    const { getEvaluationApplicableItems } = await import("@/lib/services/sst-module/helpers")
    const definition = getDefinition("trabajador_nuevo", "01")
    const items = getEvaluationApplicableItems(definition, [], null)
    // Responde el resto con lo que ya tenga (no conforme si no se declaró) para
    // que `closeEvaluation` no rechace el cierre por ítems sin contestar.
    const rest = items.filter(({ seccionId, item }) => `${seccionId}::${item.id}` !== "induccion_capacitacion::riohs")
    if (rest.length > 0) {
      await inMemoryDb.insert(schema.sstResponses).values(rest.map(({ seccionId, item }, index) => ({
        id: `resp-revok-rest-${index}`, evaluationId: EVAL_ID, seccionId, itemId: item.id,
        estado: "na", observacion: null,
      })))
    }

    await closeEvaluation(EVAL_ID, { evaluationId: EVAL_ID }, "all")
    expect(await executionsFor(18)).toHaveLength(1)

    // `deleteEvaluation` rechaza un acta "cerrado" (la única que acredita). Se
    // fuerza el estado de vuelta a mano para probar que la revocación queda
    // bien cableada si esa vía se habilita algún día — hoy es inalcanzable por
    // el flujo normal, y por eso el conector se llama "defensa en profundidad".
    await inMemoryDb.update(schema.sstEvaluations).set({ estado: "borrador" }).where(eq(schema.sstEvaluations.id, EVAL_ID))

    await deleteEvaluation(EVAL_ID, "all", USER_ID)

    const revocacion = await revocationEventFor(`habilitacion:${EVAL_ID}`)
    expect(revocacion?.status).toBe("revoked")
    const [ejecucion] = await executionsFor(18)
    expect(ejecucion!.status).toBe("draft")
  })
})
