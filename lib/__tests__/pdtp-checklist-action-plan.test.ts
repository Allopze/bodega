import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

import { vi } from "vitest"
vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const NOW = () => new Date().toISOString()

async function seedBaseFixtures() {
  await inMemoryDb.insert(schema.users).values({
    id: "u1", name: "Prevencionista", email: "prev@test.local", hashedPassword: "x", isActive: true,
  })
  await inMemoryDb.insert(schema.worksites).values({
    id: "w1", name: "Faena A", code: "FA", isActive: true,
  })
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: "prog-1", year: 2026, version: 1, status: "active", title: "T",
    elaboratedByName: "X", elaboratedByTitle: "Y",
    createdAt: NOW(), updatedAt: NOW(),
  })
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: "act-1", programId: "prog-1", n: 1, objectiveOrder: 1, objective: "O",
    activity: "Charla de seguridad", program: "P", responsibleSlugs: [], responsibleDisplay: "R",
    sourceSheetRow: 1,
    createdAt: NOW(), updatedAt: NOW(),
  })
  await inMemoryDb.insert(schema.pdtpExecutions).values({
    id: "exec-1", activityId: "act-1", worksiteId: "w1",
    year: 2026, month: 1, week: 1, executedQuantity: 1, status: "submitted",
    createdAt: NOW(), updatedAt: NOW(),
  })
}

async function completeActionForVerification(actionPlanItemId: string) {
  const { addFollowup } = await import("@/lib/services/pdtp/followups")
  await addFollowup({
    actionPlanItemId,
    estadoNuevo: "completado",
    observacion: "Control implementado con evidencia",
    evidenciaPhotos: ["storage/pdtp-evidence/capa_test_photo.jpg"],
  }, "u1")
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpActionPlanFollowups)
  await inMemoryDb.delete(schema.pdtpActionPlan)
  await inMemoryDb.delete(schema.preventionCapaEvidence)
  await inMemoryDb.delete(schema.preventionCapaFollowups)
  await inMemoryDb.delete(schema.preventionCapaTransitions)
  await inMemoryDb.delete(schema.preventionCapaActions)
  await inMemoryDb.delete(schema.pdtpExecutionChecklistResponses)
  await inMemoryDb.delete(schema.pdtpExecutionChecklists)
  await inMemoryDb.delete(schema.pdtpActivityChecklists)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)
  await seedBaseFixtures()
})

describe("pdtp checklist templates", () => {
  it("crea una plantilla por defecto y la recupera como activa", async () => {
    const { ensureDefaultChecklist, getActivePdtpActivityChecklist } = await import("@/lib/services/pdtp/checklists")
    const created = await ensureDefaultChecklist("act-1", "Charla de seguridad")
    expect(created.isActive).toBe(true)
    expect(created.definition.sections.length).toBeGreaterThan(0)

    const active = await getActivePdtpActivityChecklist("act-1")
    expect(active?.id).toBe(created.id)
  })

  it("savePdtpActivityChecklist desactiva la versión anterior al crear una nueva", async () => {
    const { savePdtpActivityChecklist, listPdtpActivityChecklists } = await import("@/lib/services/pdtp/checklists")
    const def = {
      code: "c1", version: "01", revisionDate: "2026-01-01", title: "T1", tipo: "nuevo" as const,
      legalFramework: [], applicableTo: "",
      sections: [{ id: "s1", title: "S1", items: [{ id: "i1", label: "I1", kind: "cumple_nocumple_obs" as const }] }],
      closingAct: { title: "Cierre", resultOptions: [], signatureRoles: [] },
    }
    const v1 = await savePdtpActivityChecklist({ activityId: "act-1", label: "L1", definition: def })
    const v2 = await savePdtpActivityChecklist({ activityId: "act-1", label: "L2", definition: def })

    const all = await listPdtpActivityChecklists("act-1")
    const row1 = all.find((c) => c.id === v1.id)!
    const row2 = all.find((c) => c.id === v2.id)!
    expect(row1.isActive).toBe(false)
    expect(row2.isActive).toBe(true)
  })

  it("no permite dos plantillas activas para la misma actividad a nivel de DB (constraint restaurado)", async () => {
    await inMemoryDb.insert(schema.pdtpActivityChecklists).values({
      id: "cl-1", activityId: "act-1", programId: "prog-1", version: "01", label: "L1",
      definitionJson: {}, isActive: true, createdAt: NOW(), updatedAt: NOW(),
    })
    await expect(
      inMemoryDb.insert(schema.pdtpActivityChecklists).values({
        id: "cl-2", activityId: "act-1", programId: "prog-1", version: "02", label: "L2",
        definitionJson: {}, isActive: true, createdAt: NOW(), updatedAt: NOW(),
      }),
    ).rejects.toThrow()
  })
})

describe("pdtp execution checklist → plan de acción handoff", () => {
  it("submitExecutionChecklist completa el checklist y genera acciones para ítems no_cumple", async () => {
    const { savePdtpActivityChecklist } = await import("@/lib/services/pdtp/checklists")
    const { getOrCreateExecutionChecklist, upsertChecklistResponses, getExecutionChecklist } = await import("@/lib/services/pdtp/execution-checklists")
    const { submitExecutionChecklist } = await import("@/lib/services/pdtp/action-plan")

    await savePdtpActivityChecklist({
      activityId: "act-1",
      label: "L1",
      definition: {
        code: "c1", version: "01", revisionDate: "2026-01-01", title: "T1", tipo: "nuevo",
        legalFramework: [], applicableTo: "",
        sections: [{
          id: "s1", title: "Sección 1",
          items: [
            { id: "i1", label: "Ítem 1", kind: "cumple_nocumple_obs" },
            { id: "i2", label: "Ítem 2", kind: "cumple_nocumple_obs" },
          ],
        }],
        closingAct: { title: "Cierre", resultOptions: [], signatureRoles: [] },
      },
    })

    const instance = await getOrCreateExecutionChecklist("exec-1", "u1")
    await upsertChecklistResponses(instance.id, [
      { seccionId: "s1", itemId: "i1", estado: "cumple" },
      { seccionId: "s1", itemId: "i2", estado: "no_cumple", observacion: "Falta EPP" },
    ], "u1")

    const result = await submitExecutionChecklist(instance.id, "u1")
    expect(result.porcentajeCumplimiento).toBe(50)
    expect(result.generadas).toBe(1)
    expect(result.existentes).toBe(0)

    const completed = await getExecutionChecklist("exec-1")
    expect(completed?.overallStatus).toBe("completado")

    const { listActionPlanItems } = await import("@/lib/services/pdtp/action-plan")
    const items = await listActionPlanItems("exec-1")
    expect(items).toHaveLength(1)
    expect(items[0]!.hallazgo).toBe("Falta EPP")
    expect(items[0]!.origen).toBe("checklist_item")
    expect(items[0]!.estado).toBe("pendiente")

    // No duplica acciones si se vuelve a invocar (idempotencia del generador).
    const { generateActionPlanFromChecklist } = await import("@/lib/services/pdtp/action-plan")
    const second = await generateActionPlanFromChecklist(instance.id, "u1")
    expect(second.generadas).toBe(0)
    expect(second.existentes).toBe(1)
  })

  it("deriva prioridad/plazo del danoPotencial del ítem; sin ese campo usa el default 'media'", async () => {
    const { savePdtpActivityChecklist } = await import("@/lib/services/pdtp/checklists")
    const { getOrCreateExecutionChecklist, upsertChecklistResponses } = await import("@/lib/services/pdtp/execution-checklists")
    const { submitExecutionChecklist, listActionPlanItems } = await import("@/lib/services/pdtp/action-plan")

    await savePdtpActivityChecklist({
      activityId: "act-1",
      label: "L1",
      definition: {
        code: "c1", version: "01", revisionDate: "2026-01-01", title: "T1", tipo: "nuevo",
        legalFramework: [], applicableTo: "",
        sections: [{
          id: "s1", title: "Sección 1",
          items: [
            { id: "i1", label: "Sin daño potencial", kind: "cumple_nocumple_obs" },
            { id: "i2", label: "Riesgo grave", kind: "cumple_nocumple_obs", danoPotencial: "grave" },
          ],
        }],
        closingAct: { title: "Cierre", resultOptions: [], signatureRoles: [] },
      },
    })

    const instance = await getOrCreateExecutionChecklist("exec-1", "u1")
    await upsertChecklistResponses(instance.id, [
      { seccionId: "s1", itemId: "i1", estado: "no_cumple", observacion: "Falla menor" },
      { seccionId: "s1", itemId: "i2", estado: "no_cumple", observacion: "Falla grave" },
    ], "u1")

    await submitExecutionChecklist(instance.id, "u1")

    const items = await listActionPlanItems("exec-1")
    const sinDano = items.find((i) => i.itemId === "i1")!
    const conDano = items.find((i) => i.itemId === "i2")!

    expect(sinDano.prioridad).toBe("media")
    expect(conDano.prioridad).toBe("alta")
    // "alta" derivado de daño potencial "grave" = plazo +2 días (vs +7 de "media").
    expect(new Date(conDano.plazo).getTime()).toBeLessThan(new Date(sinDano.plazo).getTime())
  })
})

describe("pdtp action plan lifecycle", () => {
  async function createManualAction(overrides: Partial<Record<string, unknown>> = {}) {
    const { createActionPlanItem } = await import("@/lib/services/pdtp/action-plan")
    return createActionPlanItem({
      executionId: "exec-1",
      hallazgo: "Hallazgo manual",
      accion: "Corregir",
      responsableRole: "prevencionista_faena",
      responsable: "Juan Pérez",
      plazo: "2026-01-01",
      prioridad: "media",
      ...overrides,
    } as never, "u1")
  }

  it("verifyActionPlanItem cierra la acción y registra un followup automático", async () => {
    const { verifyActionPlanItem } = await import("@/lib/services/pdtp/action-plan")
    const { listFollowups } = await import("@/lib/services/pdtp/followups")
    const item = await createManualAction()

    await completeActionForVerification(item.id)
    const verified = await verifyActionPlanItem(item.id, "u1", "Todo conforme", "Inspección en terreno satisfactoria")
    expect(verified.estado).toBe("verificado")
    expect(verified.verifiedByUserId).toBe("u1")

    const followups = await listFollowups(item.id)
    expect(followups).toHaveLength(2)
    expect(followups[0]!.estadoNuevo).toBe("verificado")
  })

  it("reopenActionPlanItem exige un motivo y solo reabre acciones verificadas", async () => {
    const { verifyActionPlanItem, reopenActionPlanItem } = await import("@/lib/services/pdtp/action-plan")
    const item = await createManualAction()

    await expect(reopenActionPlanItem(item.id, "u1", "")).rejects.toThrow()
    await expect(reopenActionPlanItem(item.id, "u1", "motivo válido")).rejects.toThrow(/verificadas/)

    await completeActionForVerification(item.id)
    await verifyActionPlanItem(item.id, "u1", undefined, "Control implementado y observado en terreno")
    const reopened = await reopenActionPlanItem(item.id, "u1", "La acción no fue efectiva")
    expect(reopened.estado).toBe("reabierto")
    expect(reopened.verifiedByUserId).toBeNull()
  })

  it("listVencidas incluye acciones en_proceso vencidas y respeta el filtro por programId (regresión)", async () => {
    const { listVencidas, addFollowup } = await import("@/lib/services/pdtp/followups")
    const pastDue = await createManualAction({ plazo: "2000-01-01" })
    await addFollowup({ actionPlanItemId: pastDue.id, estadoNuevo: "en_proceso", observacion: "Iniciada" }, "u1")

    const notDue = await createManualAction({ plazo: "2099-01-01" })
    void notDue

    const vencidas = await listVencidas()
    expect(vencidas.map((v) => v.id)).toContain(pastDue.id)
    expect(vencidas.every((v) => v.estado !== "completado" && v.estado !== "verificado")).toBe(true)

    // Filtrado por programId: prog-1 es el único programa, debe seguir apareciendo;
    // un programId inexistente no debe traer nada (antes el filtro era un no-op).
    const scoped = await listVencidas("prog-1")
    expect(scoped.map((v) => v.id)).toContain(pastDue.id)
    const scopedOther = await listVencidas("prog-inexistente")
    expect(scopedOther).toHaveLength(0)
  })
})

describe("pdtp checklist and action-plan scope", () => {
  it("rejects execution, checklist and action access outside the assigned worksite", async () => {
    const { assertPdtpActionPlanItemAccess, assertPdtpChecklistInstanceAccess, assertPdtpExecutionAccess } = await import("@/lib/services/prevention-pdtp")
    const { getOrCreateExecutionChecklist } = await import("@/lib/services/pdtp/execution-checklists")
    const { createActionPlanItem, listActionsByProgram } = await import("@/lib/services/pdtp/action-plan")

    const instance = await getOrCreateExecutionChecklist("exec-1", "u1")
    const action = await createActionPlanItem({
      executionId: "exec-1",
      hallazgo: "Hallazgo",
      accion: "Corregir",
      responsableRole: "prevencionista_faena",
      responsable: "Responsable",
      plazo: "2026-01-01",
      prioridad: "media",
    }, "u1")

    await expect(assertPdtpExecutionAccess("exec-1", ["w2"])).rejects.toThrow(/sin acceso/i)
    await expect(assertPdtpChecklistInstanceAccess(instance.id, ["w2"])).rejects.toThrow(/sin acceso/i)
    await expect(assertPdtpActionPlanItemAccess(action.id, ["w2"])).rejects.toThrow(/sin acceso/i)
    await expect(listActionsByProgram("prog-1", { scope: ["w2"] })).resolves.toEqual([])
  })
})

describe("pdtp checklist multi-sujeto", () => {
  it("una ejecución sostiene N instancias por sujeto, cada una con su plan de acción prefijado", async () => {
    const { savePdtpActivityChecklist } = await import("@/lib/services/pdtp/checklists")
    const {
      getOrCreateExecutionChecklist, listExecutionChecklists, recalcExecutionQuantityFromInstances,
    } = await import("@/lib/services/pdtp/execution-checklists")
    const { submitExecutionChecklist, listActionPlanItems } = await import("@/lib/services/pdtp/action-plan")

    // Misma definición para ambos extintores (patrón C: un def, N sujetos).
    await savePdtpActivityChecklist({
      activityId: "act-1",
      label: "Extintores",
      definition: {
        code: "ext", version: "01", revisionDate: "2026-01-01", title: "Extintores", tipo: "nuevo",
        legalFramework: [], applicableTo: "",
        sections: [{
          id: "s1", title: "Estado",
          items: [{ id: "i1", label: "Manómetro en zona verde", kind: "cumple_nocumple_obs" }],
        }],
        closingAct: { title: "Cierre", resultOptions: [], signatureRoles: [] },
      },
    })

    // Dos sujetos distintos para la MISMA ejecución.
    const ext7 = await getOrCreateExecutionChecklist("exec-1", "u1", {
      subjectType: "extintor", subjectId: "ext-7", subjectLabel: "Extintor #7",
    })
    const ext12 = await getOrCreateExecutionChecklist("exec-1", "u1", {
      subjectType: "extintor", subjectId: "ext-12", subjectLabel: "Extintor #12",
    })
    expect(ext7.id).not.toBe(ext12.id)
    expect(ext7.subjectId).toBe("ext-7")
    expect(ext12.subjectId).toBe("ext-12")

    // Cada instancia con su propia respuesta (mismo seccionId/itemId, distinto sujeto).
    const { upsertChecklistResponses } = await import("@/lib/services/pdtp/execution-checklists")
    await upsertChecklistResponses(ext7.id, [{ seccionId: "s1", itemId: "i1", estado: "no_cumple", observacion: "Aguja en rojo" }], "u1")
    await upsertChecklistResponses(ext12.id, [{ seccionId: "s1", itemId: "i1", estado: "no_cumple", observacion: "Sello roto" }], "u1")

    // Idempotencia por sujeto: recuperar el mismo sujeto devuelve la misma instancia.
    const ext7Again = await getOrCreateExecutionChecklist("exec-1", "u1", {
      subjectType: "extintor", subjectId: "ext-7", subjectLabel: "Extintor #7",
    })
    expect(ext7Again.id).toBe(ext7.id)

    // listExecutionChecklists trae ambas.
    const all = await listExecutionChecklists("exec-1")
    expect(all).toHaveLength(2)

    // Enviar ambas → cada una genera su acción con prefijo de sujeto.
    await submitExecutionChecklist(ext7.id, "u1")
    await submitExecutionChecklist(ext12.id, "u1")

    const items = await listActionPlanItems("exec-1")
    expect(items).toHaveLength(2)
    const hallazgos = items.map((i) => i.hallazgo).sort()
    expect(hallazgos).toEqual([
      "[Extintor #12] Sello roto",
      "[Extintor #7] Aguja en rojo",
    ])

    // Rollup condicional: con 2 instancias completadas, executedQuantity = 2.
    const updated = await recalcExecutionQuantityFromInstances("exec-1")
    expect(updated).toBe(2)
  })

  it("getOrCreateExecutionChecklist sin sujeto crea la instancia de faena única (backward-compat)", async () => {
    const { savePdtpActivityChecklist } = await import("@/lib/services/pdtp/checklists")
    const { getOrCreateExecutionChecklist, recalcExecutionQuantityFromInstances } = await import("@/lib/services/pdtp/execution-checklists")

    await savePdtpActivityChecklist({
      activityId: "act-1", label: "Taller",
      definition: {
        code: "t", version: "01", revisionDate: "2026-01-01", title: "T", tipo: "nuevo",
        legalFramework: [], applicableTo: "",
        sections: [{ id: "s1", title: "S1", items: [{ id: "i1", label: "I1", kind: "cumple_nocumple_obs" }] }],
        closingAct: { title: "Cierre", resultOptions: [], signatureRoles: [] },
      },
    })

    // Sin subject → faena única (subjectId='').
    const inst = await getOrCreateExecutionChecklist("exec-1", "u1")
    expect(inst.subjectId).toBe("")
    expect(inst.subjectType).toBeNull()
    expect(inst.subjectLabel).toBeNull()

    // Rollup con ≤1 instancia: NO toca executedQuantity (preserva el valor manual).
    const result = await recalcExecutionQuantityFromInstances("exec-1")
    expect(result).toBeNull()
  })
})

describe("pdtp cumplimiento integral", () => {
  it("calcula los 3 ejes y el ponderado a partir de checklist + plan de acción", async () => {
    const { savePdtpActivityChecklist } = await import("@/lib/services/pdtp/checklists")
    const { getOrCreateExecutionChecklist, upsertChecklistResponses } = await import("@/lib/services/pdtp/execution-checklists")
    const { submitExecutionChecklist, verifyActionPlanItem, listActionPlanItems } = await import("@/lib/services/pdtp/action-plan")
    const { approvePdtpExecution } = await import("@/lib/services/pdtp/executions")
    const { getPdtpIntegralCompliance } = await import("@/lib/services/pdtp/compliance")

    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: "sched-1", activityId: "act-1", year: 2026, month: 1, week: 1,
      plannedQuantity: 1, sourceColumn: "S1",
    })

    await savePdtpActivityChecklist({
      activityId: "act-1", label: "L1",
      definition: {
        code: "c1", version: "01", revisionDate: "2026-01-01", title: "T1", tipo: "nuevo",
        legalFramework: [], applicableTo: "",
        sections: [{ id: "s1", title: "S1", items: [{ id: "i1", label: "I1", kind: "cumple_nocumple_obs" }] }],
        closingAct: { title: "Cierre", resultOptions: [], signatureRoles: [] },
      },
    })
    const instance = await getOrCreateExecutionChecklist("exec-1", "u1")
    await upsertChecklistResponses(instance.id, [{ seccionId: "s1", itemId: "i1", estado: "no_cumple", observacion: "Falla" }], "u1")
    await submitExecutionChecklist(instance.id, "u1")
    await approvePdtpExecution("exec-1", "u1", ["w1"])

    const items = await listActionPlanItems("exec-1")
    await completeActionForVerification(items[0]!.id)
    await verifyActionPlanItem(items[0]!.id, "u1", undefined, "Control implementado y observado en terreno")

    // getPdtpIntegralCompliance reutiliza loadProgramScheduleAndExecutions, que solo
    // agrega executionRows cuando se pasa worksiteId (mismo contrato que
    // getPdtpComplianceIndicators) — sin faena, los 3 ejes quedan en null.
    const integral = await getPdtpIntegralCompliance("prog-1", "w1")
    expect(integral).not.toBeNull()
    expect(integral!.verificacion).toBe(0)
    expect(integral!.cierre).toBe(100)
    expect(integral!.integral).not.toBeNull()
    expect(integral!.pesos).toEqual({ ejecucion: 0.5, verificacion: 0.3, cierre: 0.2 })
  })
})

describe("pdtp conteos por ejecución (badges de la hoja)", () => {
  it("countNoCumpleByExecution y countActionsByExecution agregan en batch sin N+1", async () => {
    const { savePdtpActivityChecklist } = await import("@/lib/services/pdtp/checklists")
    const { getOrCreateExecutionChecklist, upsertChecklistResponses, countNoCumpleByExecution } = await import("@/lib/services/pdtp/execution-checklists")
    const { submitExecutionChecklist, listActionPlanItems, verifyActionPlanItem, countActionsByExecution } = await import("@/lib/services/pdtp/action-plan")

    await savePdtpActivityChecklist({
      activityId: "act-1", label: "L1",
      definition: {
        code: "c1", version: "01", revisionDate: "2026-01-01", title: "T1", tipo: "nuevo",
        legalFramework: [], applicableTo: "",
        sections: [{
          id: "s1", title: "S1",
          items: [
            { id: "i1", label: "I1", kind: "cumple_nocumple_obs" },
            { id: "i2", label: "I2", kind: "cumple_nocumple_obs" },
          ],
        }],
        closingAct: { title: "Cierre", resultOptions: [], signatureRoles: [] },
      },
    })
    const instance = await getOrCreateExecutionChecklist("exec-1", "u1")
    await upsertChecklistResponses(instance.id, [
      { seccionId: "s1", itemId: "i1", estado: "no_cumple", observacion: "Falla 1" },
      { seccionId: "s1", itemId: "i2", estado: "no_cumple", observacion: "Falla 2" },
    ], "u1")
    await submitExecutionChecklist(instance.id, "u1")

    const noCumple = await countNoCumpleByExecution(["exec-1"])
    expect(noCumple.get("exec-1")).toBe(2)

    const items = await listActionPlanItems("exec-1")
    expect(items).toHaveLength(2)

    const countsBeforeVerify = await countActionsByExecution(["exec-1"])
    expect(countsBeforeVerify.get("exec-1")).toEqual({ pending: 2, overdue: 0 })

    await completeActionForVerification(items[0]!.id)
    await verifyActionPlanItem(items[0]!.id, "u1", undefined, "Control implementado y observado en terreno")
    const countsAfterVerify = await countActionsByExecution(["exec-1"])
    expect(countsAfterVerify.get("exec-1")).toEqual({ pending: 1, overdue: 0 })

    // Ejecución sin datos → no aparece en el mapa (fallback ?? 0 en el consumidor).
    expect((await countNoCumpleByExecution(["exec-inexistente"])).get("exec-inexistente")).toBeUndefined()
  })
})

describe("detención inmediata frente al plazo administrativo", () => {
  it("un daño fatal exige detener la tarea", async () => {
    const { requiereDetencionInmediata } = await import("@/lib/services/pdtp/checklist-domain")
    expect(requiereDetencionInmediata("fatal")).toBe(true)
    for (const dano of ["grave", "moderado", "leve"] as const) {
      expect(requiereDetencionInmediata(dano)).toBe(false)
    }
    expect(requiereDetencionInmediata(null)).toBe(false)
  })

  it("un daño fatal ya no produce un plazo de hoy", async () => {
    const { plazoFromDañoPotencial } = await import("@/lib/services/pdtp/checklist-domain")
    const from = new Date("2026-07-19T12:00:00.000Z")
    const hoy = from.toISOString().slice(0, 10)
    // Antes fatal devolvía hoy, lo que creaba la acción ya vencida.
    expect(plazoFromDañoPotencial("fatal", from)).not.toBe(hoy)
    // Comparte el plazo más corto con grave; la urgencia va por la bandera.
    expect(plazoFromDañoPotencial("fatal", from)).toBe(plazoFromDañoPotencial("grave", from))
  })

  it("el plazo se alarga a medida que baja el daño potencial", async () => {
    const { plazoFromDañoPotencial } = await import("@/lib/services/pdtp/checklist-domain")
    const from = new Date("2026-07-19T12:00:00.000Z")
    const plazos = (["fatal", "grave", "moderado", "leve"] as const).map((d) => plazoFromDañoPotencial(d, from))
    expect(plazos).toEqual([...plazos].sort())
  })
})
