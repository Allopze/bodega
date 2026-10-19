/**
 * Servidor de captura de una inspección (auditoría UI/UX 2026-10-19, línea 1C).
 *
 * Lo que se vigila aquí es lo que el cliente necesita para no perder trabajo:
 *
 * - P1-4: un rechazo permanente llega con un código (`data.code`) y el MISMO
 *   mensaje de siempre. Sin el código, el autoguardado no distinguía un conflicto
 *   de versión de un error que reintentar no arregla y reenviaba cada ~1,2 s.
 * - P1-1: una fila heredada que ya no cumple una regla nueva (un «No cumple» sin
 *   motivo, anterior a I-05) no bloquea cada guardado cuando se reenvía sin
 *   cambios. Las filas que sí cambian se siguen validando igual.
 * - P1-6: se puede quitar una fotografía, con su historial, y recién entonces el
 *   ítem puede quedar «Sin responder».
 * - P2-19: guardar informa si cambió la etapa de trabajo y la faena, para no
 *   invalidar el centro operacional en cada autoguardado.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { nanoid } from "@/lib/id"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const service = await import("@/lib/services/prevention-inspections")

const EXEC_ID = "user-cap-ejecutor"
const OTRO_ID = "user-cap-otro"
const WS = "ws-cap-1"
const WS_AJENA = "ws-cap-2"

const EXEC = {
  userId: EXEC_ID,
  scope: { mode: "some", ids: [WS] } as WorksiteScope,
  permissions: ["prevention:inspections:view", "prevention:inspections:execute"],
}
const FUERA_DE_ALCANCE = { ...EXEC, scope: { mode: "some", ids: [WS_AJENA] } as WorksiteScope }
const SOLO_LECTURA = { ...EXEC, permissions: ["prevention:inspections:view"] }

const TPL = "tpl-cap-general"
const TPL_ANEXO_08 = "tpl-cap-anexo-08"
const TPL_ANEXO_7 = "tpl-cap-anexo-7"

const definition = {
  sections: [{
    id: "s1",
    title: "Equipo",
    countsForCompliance: true,
    items: [
      { id: "p1", label: "Sello de seguridad", kind: "cumple_nocumple_na_obs" },
      { id: "p2", label: "Manómetro en zona verde", kind: "cumple_nocumple_na_obs" },
      { id: "p3", label: "Número de serie", kind: "text" },
    ],
  }],
}

async function seedTemplate(id: string, sourceDefinitionCode: string | null) {
  const now = new Date().toISOString()
  await testDb.insert(schema.preventionInspectionTemplates).values({
    id,
    code: id,
    versionLabel: "01",
    name: `Plantilla ${id}`,
    kind: "inspection",
    sourceDefinitionCode,
    definitionSnapshot: definition,
    contentHash: id.padEnd(64, "0").slice(0, 64),
    status: "approved",
    authorUserId: EXEC_ID,
    approvedByUserId: EXEC_ID,
    approvedAt: now,
  })
}

/** Ejecución recién creada: `planned`, versión 1. */
async function newRun(templateId = TPL) {
  const { run } = await service.createInspectionRun({ templateId, worksiteId: WS, subjectLabel: "Extintor QA_" }, EXEC)
  return run
}

/** Ejecución en el estado que se pida, sin pasar por el servicio. */
async function seedRunWithStatus(status: "in_progress" | "completed", executedBy: string = EXEC_ID) {
  const id = `insrun-${nanoid()}`
  await testDb.insert(schema.preventionInspectionRuns).values({
    id,
    code: `INSP-CAP-${nanoid(6).toUpperCase()}`,
    templateId: TPL,
    worksiteId: WS,
    status,
    createdByUserId: EXEC_ID,
    ...(status === "completed" ? { executedByUserId: executedBy, executedAt: new Date().toISOString() } : {}),
  })
  return id
}

async function seedAnswer(runId: string, itemId: string, row: { result: string; comment?: string | null; value?: string | null }) {
  const id = `insans-${nanoid()}`
  await testDb.insert(schema.preventionInspectionAnswers).values({
    id,
    runId,
    sectionId: "s1",
    itemId,
    itemLabel: definition.sections[0]!.items.find((item) => item.id === itemId)?.label ?? itemId,
    result: row.result,
    comment: row.comment ?? null,
    value: row.value ?? null,
  })
  return id
}

async function seedEvidence(answerId: string, count = 1) {
  const ids: string[] = []
  for (let index = 0; index < count; index += 1) {
    const id = `insev-${nanoid()}`
    ids.push(id)
    await testDb.insert(schema.preventionInspectionAnswerEvidence).values({
      id,
      answerId,
      path: `storage/inspection-evidence/${id}.png`,
      uploadedByUserId: EXEC_ID,
    })
  }
  return ids
}

const runRow = async (runId: string) =>
  (await testDb.select().from(schema.preventionInspectionRuns)
    .where(eq(schema.preventionInspectionRuns.id, runId)))[0]!

const storedAnswers = (runId: string) =>
  testDb.select().from(schema.preventionInspectionAnswers)
    .where(eq(schema.preventionInspectionAnswers.runId, runId))

const evidenceOf = (answerId: string) =>
  testDb.select().from(schema.preventionInspectionAnswerEvidence)
    .where(eq(schema.preventionInspectionAnswerEvidence.answerId, answerId))

/** El rechazo de una promesa, o falla si resolvió. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    return error as Error
  }
  throw new Error("Se esperaba un rechazo y la operación terminó bien.")
}

function expectCoded(error: Error, code: string, message: RegExp) {
  expect(error).toBeInstanceOf(service.InspectionRunError)
  expect(service.inspectionErrorCodeOf(error)).toBe(code)
  expect(error.message).toMatch(message)
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values([
    { id: EXEC_ID, name: "Ejecutor", email: "ejecutor@cap.cl", hashedPassword: "x", isActive: true },
    { id: OTRO_ID, name: "Otra persona", email: "otro@cap.cl", hashedPassword: "x", isActive: true },
  ])
  await testDb.insert(schema.worksites).values([
    { id: WS, name: "Faena Captura", code: "CAP1", isActive: true },
    { id: WS_AJENA, name: "Faena Ajena", code: "CAP2", isActive: true },
  ])
  await seedTemplate(TPL, null)
  await seedTemplate(TPL_ANEXO_08, "inspeccion_no_planeada")
  await seedTemplate(TPL_ANEXO_7, "observacion_planeada")
})

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

describe("rechazos con código (P1-4)", () => {
  it("un conflicto de versión al guardar trae `version_conflict` y el mismo mensaje", async () => {
    const run = await newRun()
    const error = await rejection(service.saveInspectionAnswers({
      runId: run.id,
      expectedVersion: run.version + 5,
      answers: [{ sectionId: "s1", itemId: "p1", result: "conforming" }],
    }, EXEC))
    expectCoded(error, "version_conflict", /cambió en otra sesión/)
  })

  it("un ítem que no existe trae `invalid_row`", async () => {
    const run = await newRun()
    const error = await rejection(service.saveInspectionAnswers({
      runId: run.id,
      expectedVersion: run.version,
      answers: [{ sectionId: "s9", itemId: "fantasma", result: "conforming" }],
    }, EXEC))
    expectCoded(error, "invalid_row", /no corresponde a ningún ítem/)
  })

  it("una fila nueva sin motivo trae `invalid_row`", async () => {
    const run = await newRun()
    const error = await rejection(service.saveInspectionAnswers({
      runId: run.id,
      expectedVersion: run.version,
      answers: [{ sectionId: "s1", itemId: "p1", result: "non_conforming", comment: "" }],
    }, EXEC))
    expectCoded(error, "invalid_row", /exige indicar el motivo/)
  })

  it("dejar sin responder un ítem con fotos trae `evidence_guard`", async () => {
    const runId = await seedRunWithStatus("in_progress")
    const answerId = await seedAnswer(runId, "p1", { result: "conforming" })
    await seedEvidence(answerId)

    const error = await rejection(service.saveInspectionAnswers({
      runId,
      expectedVersion: (await runRow(runId)).version,
      answers: [{ sectionId: "s1", itemId: "p2", result: "conforming" }],
    }, EXEC))
    expectCoded(error, "evidence_guard", /se perdería la evidencia adjunta/)
  })

  it("guardar sobre una inspección ya ejecutada trae `not_editable`", async () => {
    const runId = await seedRunWithStatus("completed")
    const error = await rejection(service.saveInspectionAnswers({
      runId,
      expectedVersion: (await runRow(runId)).version,
      answers: [{ sectionId: "s1", itemId: "p1", result: "conforming" }],
    }, EXEC))
    expectCoded(error, "not_editable", /completada, cerrada o cancelada/)
  })

  it("declarar ejecutada con obligatorios sin responder trae `not_ready`", async () => {
    const run = await newRun()
    const error = await rejection(service.completeInspectionRun({ runId: run.id, expectedVersion: run.version }, EXEC))
    expectCoded(error, "not_ready", /No se puede declarar ejecutada/)
  })

  it("declarar ejecutada el Anexo 08 sin participantes trae `not_ready`", async () => {
    const run = await newRun(TPL_ANEXO_08)
    const error = await rejection(service.completeInspectionRun({ runId: run.id, expectedVersion: run.version }, EXEC))
    expectCoded(error, "not_ready", /al menos una persona participante/)
  })

  it("declarar ejecutada con una versión vieja trae `version_conflict`", async () => {
    const run = await newRun()
    const error = await rejection(service.completeInspectionRun({ runId: run.id, expectedVersion: run.version + 7 }, EXEC))
    expectCoded(error, "version_conflict", /cambió mientras la editabas/)
  })

  it("declarar ejecutada algo que otra persona ya ejecutó trae `not_editable`", async () => {
    const runId = await seedRunWithStatus("completed", OTRO_ID)
    const error = await rejection(service.completeInspectionRun({
      runId,
      expectedVersion: (await runRow(runId)).version,
    }, EXEC))
    expectCoded(error, "not_editable", /ya fue ejecutada/)
  })
})

describe("guardar informa la etapa y la faena (P2-19)", () => {
  it("el primer guardado cambia la etapa; el siguiente no", async () => {
    const run = await newRun()
    expect(run.status).toBe("planned")

    const first = await service.saveInspectionAnswers({
      runId: run.id,
      expectedVersion: run.version,
      answers: [{ sectionId: "s1", itemId: "p1", result: "conforming" }],
    }, EXEC)
    expect(first).toMatchObject({ statusChanged: true, worksiteId: WS, version: run.version + 1, saved: 1 })
    expect((await runRow(run.id)).status).toBe("in_progress")

    const second = await service.saveInspectionAnswers({
      runId: run.id,
      expectedVersion: first.version,
      answers: [{ sectionId: "s1", itemId: "p1", result: "conforming" }, { sectionId: "s1", itemId: "p2", result: "conforming" }],
    }, EXEC)
    expect(second).toMatchObject({ statusChanged: false, worksiteId: WS, version: first.version + 1, saved: 2 })
  })
})

describe("la versión que sube registrar en terreno (P1-4)", () => {
  it("registrar una desviación en una planificada informa la versión nueva", async () => {
    const run = await newRun()
    const result = await service.registerDeviation({
      runId: run.id,
      description: "Cable expuesto en la cabina",
      danoPotencial: "moderado",
    }, EXEC)

    const after = await runRow(run.id)
    expect(after.status).toBe("in_progress")
    expect(after.version).toBe(run.version + 1)
    expect(result.runVersion).toBe(after.version)
    // El resto del hallazgo sigue llegando como antes.
    expect(result).toMatchObject({ runId: run.id, origin: "deviation", criticality: "medium" })
  })

  it("si no la subió, no informa una versión que taparía un conflicto", async () => {
    const run = await newRun()
    await service.registerDeviation({ runId: run.id, description: "Primera desviación", danoPotencial: "leve" }, EXEC)
    const versionBefore = (await runRow(run.id)).version

    const second = await service.registerDeviation({ runId: run.id, description: "Segunda desviación", danoPotencial: "leve" }, EXEC)
    expect(second.runVersion).toBeUndefined()
    expect((await runRow(run.id)).version).toBe(versionBefore)
  })

  it("registrar una acción preventiva del Anexo 7 informa la versión nueva", async () => {
    const run = await newRun(TPL_ANEXO_7)
    const result = await service.registerInspectionPreventiveAction({
      runId: run.id,
      actionDescription: "Reponer la señalética de la zona de carga",
      responsibleUserId: EXEC_ID,
      targetDate: "2026-12-15",
    }, EXEC)

    const after = await runRow(run.id)
    expect(after.status).toBe("in_progress")
    expect(result.runVersion).toBe(after.version)
    expect(after.version).toBe(run.version + 1)
  })
})

describe("filas heredadas que se reenvían sin cambios (P1-1)", () => {
  it("una fila idéntica a la guardada no se revalida, y el resto sí se guarda", async () => {
    const runId = await seedRunWithStatus("in_progress")
    // «No cumple» sin motivo: lo que se podía guardar antes de I-05.
    await seedAnswer(runId, "p1", { result: "non_conforming", comment: null })
    const version = (await runRow(runId)).version

    // El cliente normaliza vacío → sin texto y reenvía la fila tal cual.
    const result = await service.saveInspectionAnswers({
      runId,
      expectedVersion: version,
      answers: [
        { sectionId: "s1", itemId: "p1", result: "non_conforming", comment: "   " },
        { sectionId: "s1", itemId: "p2", result: "conforming" },
      ],
    }, EXEC)

    expect(result.saved).toBe(2)
    const stored = await storedAnswers(runId)
    expect(stored.map((row) => `${row.itemId}:${row.result}`).sort()).toEqual(["p1:non_conforming", "p2:conforming"])
  })

  it("la fila heredada que SÍ cambió se valida con el mismo rigor", async () => {
    const runId = await seedRunWithStatus("in_progress")
    await seedAnswer(runId, "p1", { result: "non_conforming", comment: null })

    // Cambia de resultado sin explicarlo: ya no es la fila guardada.
    const error = await rejection(service.saveInspectionAnswers({
      runId,
      expectedVersion: (await runRow(runId)).version,
      answers: [{ sectionId: "s1", itemId: "p1", result: "not_applicable", comment: "" }],
    }, EXEC))
    expectCoded(error, "invalid_row", /exige indicar el motivo/)
  })

  it("una fila sana que pasa a «No cumple» sin motivo sigue rechazándose", async () => {
    const runId = await seedRunWithStatus("in_progress")
    await seedAnswer(runId, "p1", { result: "conforming" })

    const error = await rejection(service.saveInspectionAnswers({
      runId,
      expectedVersion: (await runRow(runId)).version,
      answers: [{ sectionId: "s1", itemId: "p1", result: "non_conforming", comment: "" }],
    }, EXEC))
    expectCoded(error, "invalid_row", /exige indicar el motivo/)
  })

  it("ser idéntica a la guardada no exime de corresponder a un ítem", async () => {
    const runId = await seedRunWithStatus("in_progress")
    // Una fila guardada de un ítem que la plantilla ya no tiene.
    await testDb.insert(schema.preventionInspectionAnswers).values({
      id: `insans-${nanoid()}`,
      runId,
      sectionId: "s1",
      itemId: "ya-no-existe",
      itemLabel: "Ítem retirado",
      result: "conforming",
    })

    const error = await rejection(service.saveInspectionAnswers({
      runId,
      expectedVersion: (await runRow(runId)).version,
      answers: [{ sectionId: "s1", itemId: "ya-no-existe", result: "conforming" }],
    }, EXEC))
    expectCoded(error, "invalid_row", /no corresponde a ningún ítem/)
  })

  it("declarar ejecutada sigue frenado por una fila heredada que ya no cumple", async () => {
    const runId = await seedRunWithStatus("in_progress")
    await seedAnswer(runId, "p1", { result: "non_conforming", comment: null })
    await seedAnswer(runId, "p2", { result: "conforming" })
    await seedAnswer(runId, "p3", { result: "recorded", value: "SN-001" })

    const error = await rejection(service.completeInspectionRun({
      runId,
      expectedVersion: (await runRow(runId)).version,
      // Mismo conjunto que ya está guardado: el cierre lo revalida completo.
      answers: [
        { sectionId: "s1", itemId: "p1", result: "non_conforming" },
        { sectionId: "s1", itemId: "p2", result: "conforming" },
        { sectionId: "s1", itemId: "p3", result: "recorded", value: "SN-001" },
      ],
    }, EXEC))
    expectCoded(error, "invalid_row", /exige indicar el motivo/)
    expect((await runRow(runId)).status).toBe("in_progress")
  })

  it("lo que no viene en el conjunto se sigue borrando", async () => {
    const runId = await seedRunWithStatus("in_progress")
    await seedAnswer(runId, "p1", { result: "conforming" })
    await seedAnswer(runId, "p2", { result: "conforming" })

    const result = await service.saveInspectionAnswers({
      runId,
      expectedVersion: (await runRow(runId)).version,
      answers: [{ sectionId: "s1", itemId: "p1", result: "conforming" }],
    }, EXEC)

    expect(result).toMatchObject({ saved: 1, removed: 1 })
    expect((await storedAnswers(runId)).map((row) => row.itemId)).toEqual(["p1"])
  })
})

describe("quitar una fotografía (P1-6)", () => {
  async function runWithPhotos(photos = 2) {
    const runId = await seedRunWithStatus("in_progress")
    const answerId = await seedAnswer(runId, "p1", { result: "conforming" })
    const evidenceIds = await seedEvidence(answerId, photos)
    return { runId, answerId, evidenceIds }
  }

  const removalHistory = async (answerId: string) => {
    const rows = await testDb.select().from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, "inspection:answer"), eq(schema.auditLog.entityId, answerId)))
    return rows.filter((row) => (JSON.parse(row.newState ?? "{}") as { changeType?: string }).changeType === "evidence_removed")
  }

  it("quita la foto, informa cuántas quedan y deja el historial", async () => {
    const { answerId, evidenceIds } = await runWithPhotos(2)

    const result = await service.deleteAnswerEvidence({ evidenceId: evidenceIds[0] }, EXEC)

    expect(result).toEqual({ deleted: 1, answerId, remaining: 1 })
    expect((await evidenceOf(answerId)).map((row) => row.id)).toEqual([evidenceIds[1]])
    const history = await removalHistory(answerId)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ userId: EXEC_ID, worksiteId: WS })
    expect(history[0]!.reason).toMatch(/Sello de seguridad/)
  })

  it("con la última foto quitada, el ítem ya puede quedar sin responder", async () => {
    const { runId, evidenceIds } = await runWithPhotos(1)

    // Mientras la foto exista, la guarda lo impide.
    const blocked = await rejection(service.saveInspectionAnswers({
      runId,
      expectedVersion: (await runRow(runId)).version,
      answers: [{ sectionId: "s1", itemId: "p2", result: "conforming" }],
    }, EXEC))
    expectCoded(blocked, "evidence_guard", /Quita las fotografías primero/)

    const removed = await service.deleteAnswerEvidence({ evidenceId: evidenceIds[0] }, EXEC)
    expect(removed.remaining).toBe(0)

    const saved = await service.saveInspectionAnswers({
      runId,
      expectedVersion: (await runRow(runId)).version,
      answers: [{ sectionId: "s1", itemId: "p2", result: "conforming" }],
    }, EXEC)
    expect(saved).toMatchObject({ saved: 1, removed: 1 })
    expect((await storedAnswers(runId)).map((row) => row.itemId)).toEqual(["p2"])
  })

  it("en una inspección ya ejecutada trae `not_editable` y la foto sigue ahí", async () => {
    const runId = await seedRunWithStatus("completed")
    const answerId = await seedAnswer(runId, "p1", { result: "conforming" })
    const [evidenceId] = await seedEvidence(answerId)

    const error = await rejection(service.deleteAnswerEvidence({ evidenceId }, EXEC))
    expectCoded(error, "not_editable", /evidencia de una inspección ya ejecutada/)
    expect(await evidenceOf(answerId)).toHaveLength(1)
    expect(await removalHistory(answerId)).toHaveLength(0)
  })

  it("fuera de la faena de la persona, responde como si no existiera", async () => {
    const { answerId, evidenceIds } = await runWithPhotos(1)

    const error = await rejection(service.deleteAnswerEvidence({ evidenceId: evidenceIds[0] }, FUERA_DE_ALCANCE))
    expect(error.message).toBe("Inspección no encontrada o fuera de alcance.")
    expect(service.inspectionErrorCodeOf(error)).toBeNull()
    expect(await evidenceOf(answerId)).toHaveLength(1)
    expect(await removalHistory(answerId)).toHaveLength(0)
  })

  it("sin permiso de ejecución tampoco quita nada", async () => {
    const { answerId, evidenceIds } = await runWithPhotos(1)

    const error = await rejection(service.deleteAnswerEvidence({ evidenceId: evidenceIds[0] }, SOLO_LECTURA))
    expect(error.message).toBe("Inspección no encontrada o fuera de alcance.")
    expect(await evidenceOf(answerId)).toHaveLength(1)
  })

  it("una foto que no existe y una entrada inválida se rechazan", async () => {
    const missing = await rejection(service.deleteAnswerEvidence({ evidenceId: "insev-no-existe" }, EXEC))
    expect(missing.message).toBe("Inspección no encontrada o fuera de alcance.")

    await expect(service.deleteAnswerEvidence({}, EXEC)).rejects.toThrow()
    await expect(service.deleteAnswerEvidence(null, EXEC)).rejects.toThrow()
  })
})
