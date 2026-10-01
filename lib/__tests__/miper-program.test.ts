/**
 * Servicio del Programa de Trabajo (F2, Task 3): encabezado RE-04.1,
 * actividades con correlativo y versión, retiro y vínculo N:M con las medidas.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { createMiper } = await import("@/lib/services/miper/matrices")
const entries = await import("@/lib/services/miper/entries")
const program = await import("@/lib/services/miper/program")

const WS = "ws-prog"
const scope = { mode: "some" as const, ids: [WS] }
const editor = { userId: "u-edit", scope, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
const outsider = { userId: "u-out", scope, permissions: ["prevention:risk:view"] }

let matrixId = ""

const programRows = () => testDb.select().from(schema.preventionRiskPrograms).where(eq(schema.preventionRiskPrograms.matrixId, matrixId))
const actionRows = (programId: string) => testDb.select().from(schema.preventionRiskProgramActions).where(eq(schema.preventionRiskProgramActions.programId, programId))
const occurrenceRows = (actionId: string) => testDb.select().from(schema.preventionRiskProgramOccurrences).where(eq(schema.preventionRiskProgramOccurrences.actionId, actionId))
const linksOf = (actionId: string) => testDb.select().from(schema.preventionRiskProgramActionControls).where(eq(schema.preventionRiskProgramActionControls.actionId, actionId))

const headerInput = (expectedVersion: number) => ({
  matrixId, expectedVersion, elaboratedOn: "2030-01-15",
  companyName: "Chome S.A.", companyRut: "76.111.111-1", companyAddress: "Lagart 175", companyCommune: "Cabrero",
  economicActivity: "Transporte", adherentNumber: null, worksiteName: "Faena Programa",
  siteRepresentativeUserId: null, siteRepresentativeName: "Juan Pérez", programManagerUserId: null,
  headcountTotal: 0, headcountMale: 0, headcountFemale: 0, headcountOther: 0,
})

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena Programa", code: "PROG" })
  await testDb.insert(schema.users).values([
    { id: "u-edit", name: "Prevencionista", email: "edit@prog.cl", hashedPassword: "x", isActive: true },
    { id: "u-out", name: "Otra persona", email: "out@prog.cl", hashedPassword: "x", isActive: true },
  ])
  matrixId = (await createMiper({ worksiteId: WS, period: 2030, revisionReason: "Período para probar el programa." }, editor)).id
}, 60_000)

describe("servicio del Programa de Trabajo", () => {
  it("ensureProgram es idempotente y prellena el encabezado desde la matriz y la faena", async () => {
    const [matrix] = await testDb.select().from(schema.preventionRiskMatrices).where(eq(schema.preventionRiskMatrices.id, matrixId))
    const first = await program.ensureProgram(testDb, matrix!)
    const second = await program.ensureProgram(testDb, matrix!)
    expect(second.id).toBe(first.id)
    expect(await programRows()).toHaveLength(1)
    expect(first).toMatchObject({ matrixId, worksiteId: WS, period: 2030, version: 1, worksiteName: "Faena Programa" })
    expect(first.elaboratedOn).not.toBeNull()
  })

  it("edita el encabezado con versión optimista y mensaje de recarga", async () => {
    const [current] = await programRows()
    const { version } = await program.updateProgramHeader(headerInput(current!.version), editor)
    expect(version).toBe(current!.version + 1)
    const [updated] = await programRows()
    expect(updated).toMatchObject({ companyName: "Chome S.A.", siteRepresentativeName: "Juan Pérez" })
    await expect(program.updateProgramHeader(headerInput(1), editor)).rejects.toThrow(/Recarga antes de continuar/)
  })

  it("una actividad exige fecha programada y el correlativo no se repite ni al retirar", async () => {
    // Sin fecha no hay agenda: el campo es obligatorio y la fecha debe ser civil.
    await expect(program.saveProgramAction({ matrixId, description: "Inspeccionar extintores", scheduleKind: "monthly" }, editor))
      .rejects.toThrow(/startsOn/)
    await expect(program.saveProgramAction({ matrixId, description: "Inspeccionar extintores", scheduleKind: "monthly", startsOn: "" }, editor))
      .rejects.toThrow(/fecha programada de la actividad/)

    const first = await program.saveProgramAction({ matrixId, description: "Inspección mensual de extintores", scheduleKind: "monthly", startsOn: "2030-03-01" }, editor)
    const second = await program.saveProgramAction({ matrixId, description: "Capacitación en izaje", scheduleKind: "quarterly", startsOn: "2030-04-01" }, editor)
    expect([first.actionNumber, second.actionNumber]).toEqual([1, 2])

    // Retirar exige motivo.
    await expect(program.retireProgramAction({ actionId: second.id, expectedVersion: second.version, reason: "corto" }, editor))
      .rejects.toThrow(/al menos 10/)
    await program.retireProgramAction({ actionId: second.id, expectedVersion: second.version, reason: "Ya no aplica a este período." }, editor)

    const third = await program.saveProgramAction({ matrixId, description: "Charla semanal de seguridad", scheduleKind: "once", startsOn: "2030-05-01" }, editor)
    expect(third.actionNumber).toBe(3)
  })

  it("editar con versión vieja devuelve el mensaje de recarga", async () => {
    const [programRow] = await programRows()
    const [first] = await actionRows(programRow!.id)
    await expect(program.saveProgramAction({
      matrixId, actionId: first!.id, expectedVersion: 99, description: "Otra descripción", scheduleKind: "monthly", startsOn: "2030-03-01",
    }, editor)).rejects.toThrow(/Recarga el programa/)
  })

  it("retirar no toca las ocurrencias registradas y supersede las pendientes", async () => {
    const [programRow] = await programRows()
    const [first] = await actionRows(programRow!.id)
    await testDb.insert(schema.preventionRiskProgramOccurrences).values([
      { id: "occ-registrada", actionId: first!.id, dueOn: "2030-03-31", outcome: "pending" },
      { id: "occ-pendiente", actionId: first!.id, dueOn: "2030-04-30", outcome: "pending" },
    ])
    await testDb.insert(schema.preventionRiskProgramOccurrenceRecords).values({
      id: "rec-registrado", occurrenceId: "occ-registrada", outcome: "done", effectiveOn: "2030-03-28", recordedByUserId: "u-edit",
    })
    await testDb.update(schema.preventionRiskProgramOccurrences)
      .set({ outcome: "done", currentRecordId: "rec-registrado" })
      .where(eq(schema.preventionRiskProgramOccurrences.id, "occ-registrada"))

    await program.retireProgramAction({ actionId: first!.id, expectedVersion: first!.version, reason: "Se reemplaza por la actividad 3." }, editor)

    const occurrences = await occurrenceRows(first!.id)
    expect(occurrences.find((row) => row.id === "occ-registrada")).toMatchObject({ outcome: "done", currentRecordId: "rec-registrado" })
    expect(occurrences.find((row) => row.id === "occ-pendiente")?.outcome).toBe("superseded")
    const records = await testDb.select().from(schema.preventionRiskProgramOccurrenceRecords)
      .where(eq(schema.preventionRiskProgramOccurrenceRecords.occurrenceId, "occ-registrada"))
    expect(records).toHaveLength(1)
    expect(records[0]!.voidedAt).toBeNull()
  })

  it("vincular y desvincular medidas es idempotente y sólo con permiso de edición", async () => {
    const [programRow] = await programRows()
    const actions = await actionRows(programRow!.id)
    const target = actions.find((row) => row.actionNumber === 3)!
    const entry = await entries.saveMiperEntry({ matrixId, values: { hazard: "Extintores vencidos" } }, editor)
    const control = await entries.saveMiperControl({
      matrixId, entryId: entry.id, values: { hierarchy: "administrative", description: "Inspeccionar extintores", responsibleName: "Supervisor", dueDate: "2030-06-30" },
    }, editor)

    await expect(program.linkActionControls({ programId: programRow!.id, actionId: target.id, controlIds: [control.id], link: true }, outsider))
      .rejects.toThrow(/fuera de alcance/)

    expect(await program.linkActionControls({ programId: programRow!.id, actionId: target.id, controlIds: [control.id], link: true }, editor)).toEqual({ linked: 1 })
    await program.linkActionControls({ programId: programRow!.id, actionId: target.id, controlIds: [control.id], link: true }, editor)
    expect(await linksOf(target.id)).toHaveLength(1)

    await program.unlinkActionControl({ actionId: target.id, controlId: control.id }, editor)
    expect(await linksOf(target.id)).toHaveLength(0)
  })

  it("sin prevention:risk:edit sobre la faena ninguna mutación pasa", async () => {
    const [programRow] = await programRows()
    const actions = await actionRows(programRow!.id)
    const target = actions[0]!
    await expect(program.updateProgramHeader(headerInput(999), outsider)).rejects.toThrow(/fuera de alcance/)
    await expect(program.saveProgramAction({ matrixId, description: "Sin permiso", scheduleKind: "once", startsOn: "2030-06-01" }, outsider))
      .rejects.toThrow(/fuera de alcance/)
    await expect(program.retireProgramAction({ actionId: target.id, expectedVersion: target.version, reason: "Motivo con largo suficiente." }, outsider))
      .rejects.toThrow(/fuera de alcance/)
    await expect(program.proposeProgramActions({ matrixId }, outsider)).rejects.toThrow(/fuera de alcance/)
    // El programa no cambió con ninguno de los intentos.
    const [after] = await programRows()
    expect(await actionRows(programRow!.id)).toHaveLength(3)
    expect(after!.version).toBe(programRow!.version)
  })

  it("una matriz reemplazada no admite cambios del programa", async () => {
    // `superseded` conserva la evidencia de publicación de la matriz.
    await testDb.update(schema.preventionRiskMatrices)
      .set({ status: "superseded", reviewedByUserId: "u-edit", approvedByUserId: "u-edit" })
      .where(eq(schema.preventionRiskMatrices.id, matrixId))
    await expect(program.saveProgramAction({ matrixId, description: "Tarde", scheduleKind: "once", startsOn: "2030-06-01" }, editor))
      .rejects.toThrow(/reemplazada por la de otro período/)
    await testDb.update(schema.preventionRiskMatrices).set({ status: "draft" }).where(eq(schema.preventionRiskMatrices.id, matrixId))
    await expect(program.saveProgramAction({ matrixId, description: "Ahora sí", scheduleKind: "once", startsOn: "2030-06-01" }, editor))
      .resolves.toMatchObject({ actionNumber: 4 })
  })
})
