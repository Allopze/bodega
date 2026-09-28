/**
 * FX-B (incidentes) — huecos del flujo del expediente que el recorrido de
 * Prevención dejó confirmados en código. Cada bloque fija un defecto concreto:
 *
 * - B1: un incidente que nace fatal/grave y el triage lo baja dejaba los carriles
 *   DT/SEREMI/reinicio pendientes para siempre, y el cierre nunca pasaba.
 * - B2: `transitionPreventionIncident` podía mover reported → triage sin los
 *   campos ni los carriles que exige el triage.
 * - B3: clasificar a una persona para indicadores y confirmar una difusión
 *   escribían sobre un expediente cerrado.
 * - B4: desmarcar "investigación completa" con el incidente ya en CAPA borraba
 *   la compuerta que lo dejó pasar.
 * - B5: el plazo del disparador MIPER se calculaba en UTC.
 * - B7: los datos reservados de la persona sólo podían escribirse al reportar.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { IncidentAccess } from "@/lib/services/prevention-incidents"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite compatibility
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const previousKey = process.env.PREVENTION_DATA_ENCRYPTION_KEY
const previousKeyVersion = process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION
process.env.PREVENTION_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 41).toString("base64")
process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = "incident-gaps-test-v1"

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  if (previousKey === undefined) delete process.env.PREVENTION_DATA_ENCRYPTION_KEY
  else process.env.PREVENTION_DATA_ENCRYPTION_KEY = previousKey
  if (previousKeyVersion === undefined) delete process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION
  else process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = previousKeyVersion
  await pg.close()
})

const USER_ID = "u-gaps-1"
const OTHER_USER_ID = "u-gaps-2"
const WS_ID = "ws-gaps-1"
const FOREIGN_WS_ID = "ws-gaps-foreign"

const ALL_PERMISSIONS = [
  "prevention:incidents:view", "prevention:incidents:report", "prevention:incidents:triage",
  "prevention:incidents:investigate", "prevention:incidents:notify", "prevention:incidents:close",
  "prevention:incidents:diffuse", "prevention:capa:manage",
]

function access(permissions: string[] = ALL_PERMISSIONS, userId = USER_ID, ids = [WS_ID]): IncidentAccess {
  return { ctx: { userId }, scope: { mode: "some", ids }, permissions }
}

const OCCURRED_AT = new Date(Date.now() - 60 * 60_000).toISOString()
const KNOWN_AT = new Date(Date.now() - 50 * 60_000).toISOString()

beforeEach(async () => {
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.preventionSensitiveAccessAudit)
  await inMemoryDb.delete(schema.preventionRiskReviewTriggers)
  await inMemoryDb.delete(schema.preventionIncidentShiftDiffusions)
  await inMemoryDb.delete(schema.preventionIncidentInvestigations)
  await inMemoryDb.delete(schema.preventionIncidentNotifications)
  await inMemoryDb.delete(schema.preventionIncidentPeople)
  await inMemoryDb.delete(schema.preventionIncidents)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)
  await inMemoryDb.insert(schema.users).values([
    { id: USER_ID, name: "Prevencionista", email: "gaps-1@example.test", hashedPassword: "x" },
    { id: OTHER_USER_ID, name: "Jefe de terreno", email: "gaps-2@example.test", hashedPassword: "x" },
  ])
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_ID, name: "Faena Brechas", code: "FGAP", isActive: true },
    { id: FOREIGN_WS_ID, name: "Faena Ajena", code: "FGAPX", isActive: true },
  ])
})

afterEach(() => {
  vi.useRealTimers()
})

let submission = 0
async function report(overrides: Record<string, unknown> = {}) {
  const { reportPreventionIncident } = await import("@/lib/services/prevention-incidents")
  submission += 1
  const { incident } = await reportPreventionIncident({
    access: access(),
    input: {
      clientSubmissionId: `sub-gaps-${submission}-${Math.random().toString(36).slice(2)}`,
      worksiteId: WS_ID,
      companyName: "Empresa Test",
      eventType: "work_accident",
      occurredAt: OCCURRED_AT,
      knownAt: KNOWN_AT,
      location: "Planta Principal",
      initialNarrative: "Evento de prueba para los huecos del flujo del expediente.",
      people: [],
      ...overrides,
    },
  })
  return incident
}

async function closeDirectly(incidentId: string) {
  await inMemoryDb.update(schema.preventionIncidents)
    .set({ status: "closed", closedAt: new Date().toISOString(), closedByUserId: USER_ID })
    .where(eq(schema.preventionIncidents.id, incidentId))
}

describe("B1 — el triage que baja un fatal/grave libera sus carriles", () => {
  it("deja DT, SEREMI y reinicio en 'no requerido' y lo registra en el historial", async () => {
    const { triagePreventionIncident } = await import("@/lib/services/prevention-incidents")
    const incident = await report({
      actualSeverity: "serious",
      potentialSeverity: "critical",
      isFatalOrSerious: true,
      operationsSuspended: true,
      immediateMeasures: "Operación detenida, área aislada y atención de emergencia activada.",
    })
    const before = await inMemoryDb.select().from(schema.preventionIncidentNotifications)
      .where(eq(schema.preventionIncidentNotifications.incidentId, incident.id))
    expect(before.map((lane) => lane.notificationType).sort()).toEqual(["diat", "fatal_dt", "fatal_seremi", "restart_authorization"])

    await triagePreventionIncident({
      access: access(),
      input: {
        incidentId: incident.id,
        expectedVersion: incident.version,
        actualSeverity: "lost_time",
        potentialSeverity: "high",
        isFatalOrSerious: false,
        operationsSuspended: false,
        evacuated: false,
        immediateMeasures: "Atención en mutualidad; no hubo lesión grave según el informe médico.",
        reason: "El informe médico descarta la calificación de grave.",
      },
    })

    const lanes = await inMemoryDb.select().from(schema.preventionIncidentNotifications)
      .where(eq(schema.preventionIncidentNotifications.incidentId, incident.id))
    const byType = Object.fromEntries(lanes.map((lane) => [lane.notificationType, lane.status]))
    expect(byType).toEqual({
      diat: "pending",
      fatal_dt: "not_required",
      fatal_seremi: "not_required",
      restart_authorization: "not_required",
    })
    const [triage] = await inMemoryDb.select().from(schema.preventionIncidentHistory)
      .where(and(
        eq(schema.preventionIncidentHistory.incidentId, incident.id),
        eq(schema.preventionIncidentHistory.changeType, "triage"),
      ))
    expect(triage!.changeSet).toMatchObject({
      releasedNotificationLanes: expect.arrayContaining(["fatal_dt", "fatal_seremi", "restart_authorization"]),
    })
  })
})

describe("B2 — sólo el triage saca al incidente de 'reportado'", () => {
  it("rechaza la transición genérica reported → triage", async () => {
    const { transitionPreventionIncident } = await import("@/lib/services/prevention-incidents")
    const incident = await report()
    await expect(transitionPreventionIncident({
      access: access(),
      input: { incidentId: incident.id, expectedVersion: incident.version, toStatus: "triage", reason: "Salto sin triage" },
    })).rejects.toThrow(/Transición de incidente inválida/)
    const [after] = await inMemoryDb.select().from(schema.preventionIncidents)
      .where(eq(schema.preventionIncidents.id, incident.id))
    expect(after!.status).toBe("reported")
  })
})

describe("B3 — un expediente cerrado no se reclasifica ni se difunde", () => {
  it("rechaza clasificar a una persona para indicadores con el incidente cerrado", async () => {
    const { classifyIncidentPersonForIndicators } = await import("@/lib/services/prevention-incidents")
    const incident = await report({
      people: [{ displayLabel: "Persona involucrada 1", employerName: "Empresa Test", relationshipType: "employee" }],
    })
    const [person] = await inMemoryDb.select().from(schema.preventionIncidentPeople)
      .where(eq(schema.preventionIncidentPeople.incidentId, incident.id))
    await closeDirectly(incident.id)

    await expect(classifyIncidentPersonForIndicators({
      access: access(),
      input: {
        incidentId: incident.id,
        personId: person!.id,
        expectedIncidentVersion: incident.version,
        expectedPersonVersion: person!.version,
        absenceAtLeastNormalShift: true,
        absenceDays: 3,
        chargeDays: 0,
        inclusionStatus: "included",
        reason: "Reclasificación posterior al cierre del expediente.",
      },
    })).rejects.toThrow(/cerrado/i)
    const [unchanged] = await inMemoryDb.select().from(schema.preventionIncidentPeople)
      .where(eq(schema.preventionIncidentPeople.id, person!.id))
    expect(unchanged!.indicatorInclusionStatus).toBe("pending")
  })

  it("rechaza confirmar una difusión con el incidente cerrado", async () => {
    const { confirmIncidentDiffusion, markIncidentDiffusion } = await import("@/lib/services/prevention-incidents")
    const incident = await report()
    const diffusion = await markIncidentDiffusion({
      incidentId: incident.id,
      kind: "shift",
      summary: "Se difundió el incidente al turno entrante.",
      access: access(),
    })
    await closeDirectly(incident.id)

    await expect(confirmIncidentDiffusion({
      diffusionId: diffusion.id,
      access: access(["prevention:incidents:view", "prevention:incidents:diffuse"], OTHER_USER_ID),
    })).rejects.toThrow(/cerrado/i)
    const [unchanged] = await inMemoryDb.select().from(schema.preventionIncidentShiftDiffusions)
      .where(eq(schema.preventionIncidentShiftDiffusions.id, diffusion.id))
    expect(unchanged!.status).toBe("pending_confirmation")
  })
})

const INVESTIGATION_INPUT = {
  methodology: "Árbol de causas",
  team: [{ userId: USER_ID, role: "Investigador" }],
  immediateCauses: ["Contacto con zona de riesgo"],
  basicCauses: ["Control físico insuficiente"],
  organizationalCauses: [],
  failedControls: ["Barrera de ingeniería"],
  conclusions: "La barrera no evitó la exposición y requiere corrección verificable.",
}

describe("B4 — con el incidente en CAPA la investigación no vuelve a 'en curso'", () => {
  it("rechaza desmarcar la investigación completa y conserva su cierre", async () => {
    const { savePreventionIncidentInvestigation } = await import("@/lib/services/prevention-incidents")
    const incident = await report()
    const completedAt = new Date(Date.now() - 10 * 60_000).toISOString()
    await inMemoryDb.update(schema.preventionIncidents).set({ status: "pending_capa" })
      .where(eq(schema.preventionIncidents.id, incident.id))
    await inMemoryDb.insert(schema.preventionIncidentInvestigations).values({
      id: `inci-${incident.id}`,
      incidentId: incident.id,
      status: "completed",
      methodology: "Árbol de causas",
      team: [{ userId: USER_ID, role: "Investigador" }],
      conclusions: INVESTIGATION_INPUT.conclusions,
      startedByUserId: USER_ID,
      startedAt: completedAt,
      completedByUserId: USER_ID,
      completedAt,
      updatedAt: completedAt,
    })

    await expect(savePreventionIncidentInvestigation({
      access: access(),
      input: {
        ...INVESTIGATION_INPUT,
        incidentId: incident.id,
        expectedIncidentVersion: incident.version,
        complete: false,
        reason: "Se desmarca la investigación completa por error",
      },
    })).rejects.toThrow(/investigación ya está completa/i)
    const [investigation] = await inMemoryDb.select().from(schema.preventionIncidentInvestigations)
      .where(eq(schema.preventionIncidentInvestigations.incidentId, incident.id))
    expect(investigation).toMatchObject({ status: "completed", completedByUserId: USER_ID })
    expect(new Date(investigation!.completedAt!).toISOString()).toBe(completedAt)
  })
})

describe("B5 — el plazo del disparador MIPER se mide en el día chileno", () => {
  it("a las 23:00 de Chile el plazo cuenta 10 días desde hoy, no desde mañana UTC", async () => {
    const { savePreventionIncidentInvestigation } = await import("@/lib/services/prevention-incidents")
    const incident = await report()
    await inMemoryDb.update(schema.preventionIncidents).set({ status: "under_investigation" })
      .where(eq(schema.preventionIncidents.id, incident.id))
    // 2026-09-10T02:00Z es el 9 de septiembre a las 23:00 en Chile (UTC-3).
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-09-10T02:00:00.000Z"))

    await savePreventionIncidentInvestigation({
      access: access(),
      input: {
        ...INVESTIGATION_INPUT,
        incidentId: incident.id,
        expectedIncidentVersion: incident.version,
        miperUpdateRequired: true,
        complete: false,
        reason: "Investigación abierta; se crea el disparador MIPER",
      },
    })
    const [trigger] = await inMemoryDb.select().from(schema.preventionRiskReviewTriggers)
      .where(eq(schema.preventionRiskReviewTriggers.idempotencyKey, `incident:miper:${incident.id}`))
    expect(trigger!.dueAt).toBe("2026-09-19")
  })
})

describe("B7 — los datos reservados de la persona se completan después del reporte", () => {
  const SENSITIVE_ACCESS = ["prevention:incidents:view", "prevention:incidents:view_sensitive"]

  async function reportWithPerson() {
    const incident = await report({
      people: [{ displayLabel: "Persona involucrada 1", employerName: "Empresa Test", relationshipType: "employee" }],
    })
    const [person] = await inMemoryDb.select().from(schema.preventionIncidentPeople)
      .where(eq(schema.preventionIncidentPeople.incidentId, incident.id))
    return { incident, person: person! }
  }

  it("guarda cifrado, se lee en la vista reservada y deja auditoría de creación y actualización", async () => {
    const { getPreventionIncidentDetail, savePreventionIncidentPersonSensitive } = await import("@/lib/services/prevention-incidents")
    const { incident, person } = await reportWithPerson()

    await savePreventionIncidentPersonSensitive({
      access: access(SENSITIVE_ACCESS),
      input: {
        incidentId: incident.id,
        personId: person.id,
        purpose: "Completar la ficha reservada de la investigación",
        sensitive: { fullName: "Nombre Reservado", injuryDescription: "Contusión en antebrazo" },
      },
    })
    const [stored] = await inMemoryDb.select().from(schema.preventionIncidentPersonSensitivePayloads)
      .where(eq(schema.preventionIncidentPersonSensitivePayloads.personId, person.id))
    expect(stored!.encryptedPayload).not.toContain("Nombre Reservado")

    await savePreventionIncidentPersonSensitive({
      access: access(SENSITIVE_ACCESS),
      input: {
        incidentId: incident.id,
        personId: person.id,
        purpose: "Corregir la ficha reservada",
        sensitive: { fullName: "Nombre Reservado", injuryDescription: "Fractura de radio distal" },
      },
    })
    const rows = await inMemoryDb.select().from(schema.preventionIncidentPersonSensitivePayloads)
      .where(eq(schema.preventionIncidentPersonSensitivePayloads.personId, person.id))
    expect(rows).toHaveLength(1)

    const reserved = await getPreventionIncidentDetail({
      incidentId: incident.id,
      includeSensitive: true,
      purpose: "Revisión de la ficha",
      access: access(SENSITIVE_ACCESS),
    })
    expect(reserved!.sensitivePeople[0]!.payload).toMatchObject({ injuryDescription: "Fractura de radio distal" })

    const audits = await inMemoryDb.select().from(schema.preventionSensitiveAccessAudit)
      .where(eq(schema.preventionSensitiveAccessAudit.entityId, incident.id))
    expect(audits.map((row) => `${row.action}:${row.outcome}`).sort()).toEqual([
      "create:granted", "read_incident_sensitive:granted", "update:granted",
    ])
    const history = await inMemoryDb.select().from(schema.preventionIncidentHistory)
      .where(and(
        eq(schema.preventionIncidentHistory.incidentId, incident.id),
        eq(schema.preventionIncidentHistory.changeType, "person"),
      ))
    expect(history).toHaveLength(2)
    // El historial es de lectura general: dice qué campos cambiaron, no su valor.
    expect(JSON.stringify(history)).not.toContain("Fractura")
  })

  it("rechaza sin permiso reservado o fuera de alcance, y lo audita como denegado", async () => {
    const { savePreventionIncidentPersonSensitive } = await import("@/lib/services/prevention-incidents")
    const { incident, person } = await reportWithPerson()
    const input = {
      incidentId: incident.id,
      personId: person.id,
      purpose: "Intento sin permiso reservado",
      sensitive: { fullName: "Nombre Reservado" },
    }
    await expect(savePreventionIncidentPersonSensitive({ access: access(["prevention:incidents:view", "prevention:incidents:investigate"]), input }))
      .rejects.toThrow(/no encontrado o fuera de alcance/i)
    await expect(savePreventionIncidentPersonSensitive({ access: access(SENSITIVE_ACCESS, USER_ID, [FOREIGN_WS_ID]), input }))
      .rejects.toThrow(/no encontrado o fuera de alcance/i)
    expect(await inMemoryDb.select().from(schema.preventionIncidentPersonSensitivePayloads)
      .where(eq(schema.preventionIncidentPersonSensitivePayloads.personId, person.id))).toHaveLength(0)
    const audits = await inMemoryDb.select().from(schema.preventionSensitiveAccessAudit)
      .where(eq(schema.preventionSensitiveAccessAudit.entityId, incident.id))
    expect(audits.map((row) => row.outcome)).toEqual(["denied", "denied"])
  })

  it("rechaza escribir la ficha reservada de un expediente cerrado", async () => {
    const { savePreventionIncidentPersonSensitive } = await import("@/lib/services/prevention-incidents")
    const { incident, person } = await reportWithPerson()
    await closeDirectly(incident.id)
    await expect(savePreventionIncidentPersonSensitive({
      access: access(SENSITIVE_ACCESS),
      input: { incidentId: incident.id, personId: person.id, purpose: "Después del cierre", sensitive: { fullName: "Nombre Reservado" } },
    })).rejects.toThrow(/cerrado/i)
  })
})
