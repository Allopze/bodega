import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
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
  // `u2` existe porque la verificación de una acción CAPA exige una identidad distinta
  // de quien la creó, ejecutó o completó (`assertCapaTransition`). Verificar con `u1`
  // —que es quien crea las acciones en estas pruebas— es autoverificación y se rechaza.
  await inMemoryDb.insert(schema.users).values([
    { id: "u1", name: "Prevencionista", email: "prev@test.local", hashedPassword: "x", isActive: true },
    { id: "u2", name: "Verificador", email: "verif@test.local", hashedPassword: "x", isActive: true },
  ])
  await inMemoryDb.insert(schema.worksites).values({
    id: "w1", name: "Faena A", code: "FA", isActive: true,
  })
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: "prog-1", year: 2026, version: 1, status: "active", title: "T",
    elaboratedByName: "X", elaboratedByTitle: "Y",
    createdAt: NOW(), updatedAt: NOW(),
  })
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: "act-1", programId: "prog-1", n: 1, activity: "Charla de seguridad", program: "P", responsibleSlugs: [], responsibleDisplay: "R",
    sourceSheetRow: 1,
    createdAt: NOW(), updatedAt: NOW(),
  })
  await inMemoryDb.insert(schema.pdtpExecutions).values({
    id: "exec-1", activityId: "act-1", worksiteId: "w1",
    year: 2026, month: 1, week: 1, executedQuantity: 1, status: "submitted",
    createdAt: NOW(), updatedAt: NOW(),
  })
}

/**
 * Siembra una plantilla de checklist directo en la base (bypassa el servicio
 * guardado). `prog-1` se fija en `active` para los tests de operación real
 * (llenado de checklist, plan de acción); la plantilla se asume preexistente
 * desde antes de la activación, tal como exige el guard de contenido firmado.
 */
async function seedChecklistTemplate(
  activityId: string,
  label: string,
  definition: Record<string, unknown>,
): Promise<string> {
  const id = `cl-${activityId}-${Math.random().toString(36).slice(2, 10)}`
  await inMemoryDb.insert(schema.pdtpActivityChecklists).values({
    id, activityId, programId: "prog-1", version: "01", label,
    definitionJson: definition, isActive: true, createdAt: NOW(), updatedAt: NOW(),
  })
  return id
}

async function completeActionForVerification(actionPlanItemId: string) {
  const { addFollowup } = await import("@/lib/services/pdtp/followups")
  await addFollowup({
    actionPlanItemId,
    estadoNuevo: "completado",
    observacion: "Control implementado con evidencia",
    evidenciaPhotos: ["storage/pdtp-evidence/capa_test_photo.jpg"],
    // P4: la subida calcula el checksum sobre el mismo buffer que escribe y lo
    // devuelve; sin él la evidencia no cumple el contrato del repositorio.
    evidenciaChecksums: { "storage/pdtp-evidence/capa_test_photo.jpg": "c".repeat(64) },
  }, "u1")
}

beforeEach(async () => {
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
  await inMemoryDb.delete(schema.preventionEmergencyResourceAssignments)
  await inMemoryDb.delete(schema.preventionEmergencyResourceEvents)
  await inMemoryDb.delete(schema.preventionEmergencyResourcePoints)
  await inMemoryDb.delete(schema.preventionEmergencyResources)
  await inMemoryDb.delete(schema.preventionEmergencyResourceTypes)
  await inMemoryDb.delete(schema.preventionContainers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)
  await seedBaseFixtures()
})

describe("pdtp checklist templates", () => {
  it("crea una plantilla por defecto y la recupera como activa", async () => {
    // La plantilla se autora en `draft`, antes de que el programa entre a revisión.
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "draft" }).where(eq(schema.pdtpPrograms.id, "prog-1"))
    const { ensureDefaultChecklist, getActivePdtpActivityChecklist } = await import("@/lib/services/pdtp/checklists")
    const created = await ensureDefaultChecklist("act-1", "Charla de seguridad")
    expect(created.isActive).toBe(true)
    expect(created.definition.sections.length).toBeGreaterThan(0)

    const active = await getActivePdtpActivityChecklist("act-1")
    expect(active?.id).toBe(created.id)
  })

  it("savePdtpActivityChecklist desactiva la versión anterior al crear una nueva", async () => {
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "draft" }).where(eq(schema.pdtpPrograms.id, "prog-1"))
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
  it("usa el extintor canónico, congela su etiqueta y siembra un snapshot editable", async () => {
    const { getOrCreateExecutionChecklist, getChecklistResponses } = await import("@/lib/services/pdtp/execution-checklists")
    await seedChecklistTemplate("act-1", "Inspección de extintores", {
      code: "ext", version: "01", revisionDate: "2026-01-01", title: "Extintores", tipo: "nuevo",
      legalFramework: [], applicableTo: "",
      sections: [{
        id: "inventario_extintor", title: "Inventario", countsForCompliance: false,
        items: [
          { id: "tipo_extintor", label: "Tipo", kind: "select", options: [{ value: "pqs", label: "PQS" }] },
          { id: "peso_kg", label: "Peso", kind: "text" },
          { id: "empresa_recarga", label: "Empresa", kind: "text" },
          { id: "fecha_recarga", label: "Fecha", kind: "date" },
        ],
      }],
      closingAct: { title: "Cierre", resultOptions: [], signatureRoles: [] },
    })
    await inMemoryDb.insert(schema.preventionEmergencyResourceTypes).values({
      id: "ert-pqs-6", resourceClass: "extinguisher", agent: "PQS", capacity: 6,
      capacityUnit: "kg", canonicalName: "Extintor PQS 6 kg",
    })
    await inMemoryDb.insert(schema.preventionEmergencyResources).values({
      id: "er-1", worksiteId: "w1", assetCode: "EXT-001", typeId: "ert-pqs-6",
      name: "Extintor EXT-001", kind: "Extintor", location: "Camioneta 01",
      lastMaintenanceAt: "2026-02-15", status: "operational",
    })

    const instance = await getOrCreateExecutionChecklist("exec-1", "u1", {
      subjectType: "extintor",
      subjectId: "texto-cliente-ignorado",
      subjectResourceId: "er-1",
      subjectLabel: "etiqueta-cliente-ignorada",
    })

    expect(instance.subjectId).toBe("er-1")
    expect(instance.subjectResourceId).toBe("er-1")
    expect(instance.subjectLabel).toBe("EXT-001 · Camioneta 01")
    const snapshot = await getChecklistResponses(instance.id)
    expect(Object.fromEntries(snapshot.map((row) => [row.itemId, row.observacion]))).toMatchObject({
      tipo_extintor: "pqs",
      peso_kg: "6",
      fecha_recarga: "2026-02-15",
    })

    await inMemoryDb.insert(schema.worksites).values({ id: "w2", name: "Faena B", code: "FB", isActive: true })
    await inMemoryDb.insert(schema.preventionEmergencyResources).values({
      id: "er-2", worksiteId: "w2", assetCode: "EXT-002", typeId: "ert-pqs-6",
      name: "Extintor EXT-002", kind: "Extintor", location: "Bodega", status: "operational",
    })
    await expect(getOrCreateExecutionChecklist("exec-1", "u1", {
      subjectType: "extintor", subjectResourceId: "er-2",
    })).rejects.toThrow("no pertenece a la faena")
  })

  it("usa el contenedor del catálogo y congela su etiqueta, en vez del slug del texto libre", async () => {
    const { getOrCreateExecutionChecklist } = await import("@/lib/services/pdtp/execution-checklists")
    await seedChecklistTemplate("act-1", "Inspección de contenedores", {
      code: "cont", version: "01", revisionDate: "2026-01-01", title: "Contenedores", tipo: "nuevo",
      legalFramework: [], applicableTo: "",
      sections: [{
        id: "estructura_contenedor", title: "Estructura",
        items: [{ id: "soportes_levante", label: "Soportes", kind: "cumple_nocumple_obs" }],
      }],
      closingAct: { title: "Cierre", resultOptions: [], signatureRoles: [] },
    })
    await inMemoryDb.insert(schema.worksites).values({ id: "w2", name: "Faena B", code: "FB", isActive: true })
    await inMemoryDb.insert(schema.preventionContainers).values([
      {
        id: "cont-1", worksiteId: "w1", code: "CT-014", location: "Acopio norte",
        status: "operational", isActive: true, version: 1, createdByUserId: "u1",
      },
      {
        id: "cont-otra", worksiteId: "w2", code: "CT-099", location: "Patio ajeno",
        status: "operational", isActive: true, version: 1, createdByUserId: "u1",
      },
    ])

    const instance = await getOrCreateExecutionChecklist("exec-1", "u1", {
      subjectType: "contenedor",
      subjectId: "contenedor-respel-n2",
      subjectContainerId: "cont-1",
      subjectLabel: "etiqueta-cliente-ignorada",
    })
    // El id canónico manda: si no, dos etiquetas del mismo contenedor abrirían
    // dos instancias en la misma ejecución.
    expect(instance.subjectId).toBe("cont-1")
    expect(instance.subjectContainerId).toBe("cont-1")
    expect(instance.subjectLabel).toBe("CT-014 · Acopio norte")

    await expect(getOrCreateExecutionChecklist("exec-1", "u1", {
      subjectType: "contenedor",
    })).rejects.toThrow(/contenedor del catálogo/i)

    await expect(getOrCreateExecutionChecklist("exec-1", "u1", {
      subjectType: "contenedor", subjectContainerId: "cont-otra",
    })).rejects.toThrow("no pertenece a la faena")

    // Retirado del catálogo: abrir un checklist es trabajo nuevo y no procede.
    await inMemoryDb.insert(schema.preventionContainers).values({
      id: "cont-retirado", worksiteId: "w1", code: "CT-OFF", location: "Bodega",
      status: "out_of_service", isActive: false, version: 1, createdByUserId: "u1",
    })
    await expect(getOrCreateExecutionChecklist("exec-1", "u1", {
      subjectType: "contenedor", subjectContainerId: "cont-retirado",
    })).rejects.toThrow(/retirado del catálogo/i)
  })

  it("submitExecutionChecklist completa el checklist y genera acciones para ítems no_cumple", async () => {
    const { getOrCreateExecutionChecklist, upsertChecklistResponses, getExecutionChecklist } = await import("@/lib/services/pdtp/execution-checklists")
    const { submitExecutionChecklist } = await import("@/lib/services/pdtp/action-plan")

    await seedChecklistTemplate("act-1", "L1", {
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
    const { getOrCreateExecutionChecklist, upsertChecklistResponses } = await import("@/lib/services/pdtp/execution-checklists")
    const { submitExecutionChecklist, listActionPlanItems } = await import("@/lib/services/pdtp/action-plan")

    await seedChecklistTemplate("act-1", "L1", {
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

  /**
   * A12 / D11: `seccion_id` e `item_id` eran los dos últimos campos que sólo
   * vivían en el espejo `pdtp_action_plan` y que impedían retirarlo. No
   * merecen columnas propias en CAPA —son procedencia, no estado—, así que
   * viajan en el `source_ref` de la CAPA.
   * `origen` no se persiste: es derivable de la presencia de `seccionId`.
   */
  it("la CAPA guarda de qué ítem del checklist nació, sin columnas nuevas", async () => {
    const { getOrCreateExecutionChecklist, upsertChecklistResponses } = await import("@/lib/services/pdtp/execution-checklists")
    const { submitExecutionChecklist } = await import("@/lib/services/pdtp/action-plan")

    await seedChecklistTemplate("act-1", "L1", {
      code: "c1", version: "01", revisionDate: "2026-01-01", title: "T1", tipo: "nuevo",
      legalFramework: [], applicableTo: "",
      sections: [{
        id: "s-extintores", title: "Extintores",
        items: [{ id: "i-carga", label: "Carga vigente", kind: "cumple_nocumple_obs" }],
      }],
      closingAct: { title: "Cierre", resultOptions: [], signatureRoles: [] },
    })

    const instance = await getOrCreateExecutionChecklist("exec-1", "u1")
    await upsertChecklistResponses(instance.id, [
      { seccionId: "s-extintores", itemId: "i-carga", estado: "no_cumple", observacion: "Sin carga" },
    ], "u1")
    await submitExecutionChecklist(instance.id, "u1")

    const [capa] = await inMemoryDb.select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.sourceType, "pdtp"))
    expect(capa!.sourceRef).toEqual({
      checklistInstanceId: instance.id,
      seccionId: "s-extintores",
      itemId: "i-carga",
    })
  })

  /** Una acción manual no nace de ningún ítem: no debe inventarse procedencia. */
  it("una acción manual no guarda procedencia de checklist", async () => {
    const { createActionPlanItem } = await import("@/lib/services/pdtp/action-plan")
    const item = await createActionPlanItem({
      executionId: "exec-1", hallazgo: "Hallazgo suelto", accion: "Corregir",
      responsableRole: "prevencionista_faena", responsable: "PRF",
      plazo: "2026-12-31",
    }, "u1")

    const [capa] = await inMemoryDb.select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.id, item.id))
    expect(capa!.sourceRef).toBeNull()
    expect(item.origen).toBe("manual")
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
    const verified = await verifyActionPlanItem(item.id, "u2", "Todo conforme", "Inspección en terreno satisfactoria")
    expect(verified.estado).toBe("verificado")
    expect(verified.verifiedByUserId).toBe("u2")

    /**
     * D11: la bitácora se lee de `prevention_capa_transitions`, que registra
     * cada hecho por separado —la evidencia, la nota y cada salto de estado—
     * en vez de colapsarlos en una fila por acción del usuario como hacía el
     * espejo. La secuencia completa aquí es: creada, evidencia, nota,
     * en implementación, enviada a verificación, verificada.
     */
    const followups = await listFollowups(item.id)
    expect(followups[0]!.estadoNuevo).toBe("verificado")
    expect(followups.map((f) => f.estadoNuevo)).toEqual([
      "verificado", "completado", "en_proceso", "pendiente", "pendiente", "pendiente",
    ])
    // La evidencia sigue colgando de su entrada, no se pierde al desagregar.
    expect(followups.some((f) => f.evidenciaPhotos.length > 0)).toBe(true)
    expect(followups.some((f) => f.observacion === "Control implementado con evidencia")).toBe(true)
  })

  it("reopenActionPlanItem exige un motivo y solo reabre acciones verificadas", async () => {
    const { verifyActionPlanItem, reopenActionPlanItem } = await import("@/lib/services/pdtp/action-plan")
    const item = await createManualAction()

    await expect(reopenActionPlanItem(item.id, "u1", "")).rejects.toThrow()
    await expect(reopenActionPlanItem(item.id, "u1", "motivo válido")).rejects.toThrow(/verificadas/)

    await completeActionForVerification(item.id)
    await verifyActionPlanItem(item.id, "u2", undefined, "Control implementado y observado en terreno")
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
    await expect(listActionsByProgram("prog-1", ["w2"])).resolves.toEqual([])
  })
})

describe("pdtp checklist multi-sujeto", () => {
  it("una ejecución sostiene N instancias por sujeto, cada una con su plan de acción prefijado", async () => {
    const {
      getOrCreateExecutionChecklist, listExecutionChecklists, recalcExecutionQuantityFromInstances,
    } = await import("@/lib/services/pdtp/execution-checklists")
    const { submitExecutionChecklist, listActionPlanItems } = await import("@/lib/services/pdtp/action-plan")

    // Misma definición para ambos extintores (patrón C: un def, N sujetos).
    await seedChecklistTemplate("act-1", "Extintores", {
      code: "ext", version: "01", revisionDate: "2026-01-01", title: "Extintores", tipo: "nuevo",
      legalFramework: [], applicableTo: "",
      sections: [{
        id: "s1", title: "Estado",
        items: [{ id: "i1", label: "Manómetro en zona verde", kind: "cumple_nocumple_obs" }],
      }],
      closingAct: { title: "Cierre", resultOptions: [], signatureRoles: [] },
    })
    await inMemoryDb.insert(schema.preventionEmergencyResourceTypes).values({
      id: "ert-multi", resourceClass: "extinguisher", agent: "PQS", capacity: 6,
      capacityUnit: "kg", canonicalName: "Extintor PQS 6 kg",
    })
    await inMemoryDb.insert(schema.preventionEmergencyResources).values([
      { id: "ext-7", worksiteId: "w1", assetCode: "EXT-007", typeId: "ert-multi", name: "Extintor 7", kind: "Extintor", location: "Bodega", status: "operational" },
      { id: "ext-12", worksiteId: "w1", assetCode: "EXT-012", typeId: "ert-multi", name: "Extintor 12", kind: "Extintor", location: "Camioneta", status: "operational" },
    ])

    // Dos sujetos distintos para la MISMA ejecución.
    const ext7 = await getOrCreateExecutionChecklist("exec-1", "u1", {
      subjectType: "extintor", subjectResourceId: "ext-7",
    })
    const ext12 = await getOrCreateExecutionChecklist("exec-1", "u1", {
      subjectType: "extintor", subjectResourceId: "ext-12",
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
      subjectType: "extintor", subjectResourceId: "ext-7",
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
      "[EXT-007 · Bodega] Aguja en rojo",
      "[EXT-012 · Camioneta] Sello roto",
    ])
    const sourceRefs = (await inMemoryDb.select().from(schema.preventionCapaActions))
      .map((row) => row.sourceRef as { checklistInstanceId?: string })
    expect(sourceRefs.map((ref) => ref.checklistInstanceId).sort()).toEqual([ext12.id, ext7.id].sort())

    // Rollup condicional: con 2 instancias completadas, executedQuantity = 2.
    const updated = await recalcExecutionQuantityFromInstances("exec-1")
    expect(updated).toBe(2)
  })

  it("getOrCreateExecutionChecklist sin sujeto crea la instancia de faena única (backward-compat)", async () => {
    const { getOrCreateExecutionChecklist, recalcExecutionQuantityFromInstances } = await import("@/lib/services/pdtp/execution-checklists")

    await seedChecklistTemplate("act-1", "Taller", {
      code: "t", version: "01", revisionDate: "2026-01-01", title: "T", tipo: "nuevo",
      legalFramework: [], applicableTo: "",
      sections: [{ id: "s1", title: "S1", items: [{ id: "i1", label: "I1", kind: "cumple_nocumple_obs" }] }],
      closingAct: { title: "Cierre", resultOptions: [], signatureRoles: [] },
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
    const { getOrCreateExecutionChecklist, upsertChecklistResponses } = await import("@/lib/services/pdtp/execution-checklists")
    const { submitExecutionChecklist, verifyActionPlanItem, listActionPlanItems } = await import("@/lib/services/pdtp/action-plan")
    const { approvePdtpExecution } = await import("@/lib/services/pdtp/executions")
    const { getPdtpIntegralCompliance } = await import("@/lib/services/pdtp/compliance")

    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: "sched-1", activityId: "act-1", year: 2026, month: 1, week: 1,
      plannedQuantity: 1, sourceColumn: "S1",
    })

    await seedChecklistTemplate("act-1", "L1", {
      code: "c1", version: "01", revisionDate: "2026-01-01", title: "T1", tipo: "nuevo",
      legalFramework: [], applicableTo: "",
      sections: [{ id: "s1", title: "S1", items: [{ id: "i1", label: "I1", kind: "cumple_nocumple_obs" }] }],
      closingAct: { title: "Cierre", resultOptions: [], signatureRoles: [] },
    })
    const instance = await getOrCreateExecutionChecklist("exec-1", "u1")
    await upsertChecklistResponses(instance.id, [{ seccionId: "s1", itemId: "i1", estado: "no_cumple", observacion: "Falla" }], "u1")
    await submitExecutionChecklist(instance.id, "u1")
    await approvePdtpExecution("exec-1", "u1", ["w1"])

    const items = await listActionPlanItems("exec-1")
    await completeActionForVerification(items[0]!.id)
    await verifyActionPlanItem(items[0]!.id, "u2", undefined, "Control implementado y observado en terreno")

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
    const { getOrCreateExecutionChecklist, upsertChecklistResponses, countNoCumpleByExecution } = await import("@/lib/services/pdtp/execution-checklists")
    const { submitExecutionChecklist, listActionPlanItems, verifyActionPlanItem, countActionsByExecution } = await import("@/lib/services/pdtp/action-plan")

    await seedChecklistTemplate("act-1", "L1", {
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
    await verifyActionPlanItem(items[0]!.id, "u2", undefined, "Control implementado y observado en terreno")
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

// Escala B/R/M de los anexos de inspección (Anexos 3, 13, 14).
describe("escala Bueno/Regular/Malo", () => {
  const BRM_TEMPLATE = {
    code: "brm", version: "01", revisionDate: "2026-01-01", title: "Inspección B/R/M", tipo: "seguimiento",
    legalFramework: [], applicableTo: "",
    sections: [{
      id: "s1", title: "Estado",
      items: [
        { id: "i1", label: "Ítem 1", kind: "bueno_regular_malo_obs" },
        { id: "i2", label: "Ítem 2", kind: "bueno_regular_malo_obs" },
        { id: "i3", label: "Ítem 3", kind: "bueno_regular_malo_na_obs" },
      ],
    }],
    closingAct: { title: "Cierre", resultOptions: [], signatureRoles: [] },
  }

  it("puntúa Bueno=1, Regular=0.5, Malo=0", async () => {
    const { getOrCreateExecutionChecklist, upsertChecklistResponses } = await import("@/lib/services/pdtp/execution-checklists")
    await seedChecklistTemplate("act-1", "BRM", BRM_TEMPLATE)

    const instance = await getOrCreateExecutionChecklist("exec-1", "u1")
    const { porcentajeCumplimiento } = await upsertChecklistResponses(instance.id, [
      { seccionId: "s1", itemId: "i1", estado: "cumple" },
      { seccionId: "s1", itemId: "i2", estado: "regular", observacion: "Desgaste leve" },
      { seccionId: "s1", itemId: "i3", estado: "no_cumple", observacion: "Roto" },
    ], "u1")

    // (1 + 0.5 + 0) / 3 = 50%
    expect(porcentajeCumplimiento).toBeCloseTo(50, 2)
  })

  it("Regular no genera acción correctiva; Malo sí", async () => {
    const { getOrCreateExecutionChecklist, upsertChecklistResponses } = await import("@/lib/services/pdtp/execution-checklists")
    const { submitExecutionChecklist } = await import("@/lib/services/pdtp/action-plan")
    await seedChecklistTemplate("act-1", "BRM", BRM_TEMPLATE)

    const instance = await getOrCreateExecutionChecklist("exec-1", "u1")
    await upsertChecklistResponses(instance.id, [
      { seccionId: "s1", itemId: "i1", estado: "cumple" },
      { seccionId: "s1", itemId: "i2", estado: "regular", observacion: "Desgaste leve" },
      { seccionId: "s1", itemId: "i3", estado: "no_cumple", observacion: "Roto", accionCorrectiva: "Reemplazar" },
    ], "u1")

    const { generadas } = await submitExecutionChecklist(instance.id, "u1")
    expect(generadas).toBe(1)
  })

  it("no deja enviar un ítem Regular o Malo sin observación", async () => {
    const { getOrCreateExecutionChecklist, upsertChecklistResponses } = await import("@/lib/services/pdtp/execution-checklists")
    const { submitExecutionChecklist } = await import("@/lib/services/pdtp/action-plan")
    await seedChecklistTemplate("act-1", "BRM", BRM_TEMPLATE)

    const instance = await getOrCreateExecutionChecklist("exec-1", "u1")
    await upsertChecklistResponses(instance.id, [
      { seccionId: "s1", itemId: "i1", estado: "cumple" },
      { seccionId: "s1", itemId: "i2", estado: "regular" },
      { seccionId: "s1", itemId: "i3", estado: "no_cumple" },
    ], "u1")

    await expect(submitExecutionChecklist(instance.id, "u1")).rejects.toThrow(/observación/i)

    // Con la observación puesta, el mismo envío pasa.
    await upsertChecklistResponses(instance.id, [
      { seccionId: "s1", itemId: "i2", estado: "regular", observacion: "Desgaste leve" },
      { seccionId: "s1", itemId: "i3", estado: "no_cumple", observacion: "Roto" },
    ], "u1")
    await expect(submitExecutionChecklist(instance.id, "u1")).resolves.toBeTruthy()
  })

  it("un 'cumple' sin observación no bloquea el envío", async () => {
    const { getOrCreateExecutionChecklist, upsertChecklistResponses } = await import("@/lib/services/pdtp/execution-checklists")
    const { submitExecutionChecklist } = await import("@/lib/services/pdtp/action-plan")
    await seedChecklistTemplate("act-1", "BRM", BRM_TEMPLATE)

    const instance = await getOrCreateExecutionChecklist("exec-1", "u1")
    await upsertChecklistResponses(instance.id, [
      { seccionId: "s1", itemId: "i1", estado: "cumple" },
      { seccionId: "s1", itemId: "i3", estado: "na" },
    ], "u1")

    await expect(submitExecutionChecklist(instance.id, "u1")).resolves.toBeTruthy()
  })
})

// Anexo 7 — Observación Planeada: formulario narrativo, no puntúa.
describe("OBSERVACION_PLANEADA (Anexo 7)", () => {
  it("pasa el validador de definiciones del PDTP", async () => {
    const { OBSERVACION_PLANEADA } = await import("@/lib/sst/definitions/observacion-planeada")
    const { pdtpChecklistDefinitionSchema } = await import("@/lib/validation/prevention-module/pdtp")
    expect(() => pdtpChecklistDefinitionSchema.parse(OBSERVACION_PLANEADA)).not.toThrow()
  })

  it("no tiene ítems de estado, así que no puntúa", async () => {
    const { OBSERVACION_PLANEADA } = await import("@/lib/sst/definitions/observacion-planeada")
    const { getApplicableItems } = await import("@/lib/sst/checklist")
    const { calculateInstanceCompliance } = await import("@/lib/services/pdtp/execution-checklists")

    expect(getApplicableItems(OBSERVACION_PLANEADA, ["prevencionista_faena"])).toHaveLength(0)
    expect(calculateInstanceCompliance(OBSERVACION_PLANEADA, [])).toBeNull()
  })

  it("conserva el relato libre del anexo como campo multilínea", async () => {
    const { OBSERVACION_PLANEADA } = await import("@/lib/sst/definitions/observacion-planeada")
    const items = OBSERVACION_PLANEADA.sections.flatMap((s) => s.items)
    expect(items.find((i) => i.id === "descripcion")?.kind).toBe("textarea")
    expect(items.find((i) => i.id === "lugar_trabajo_observado")).toBeTruthy()
  })
})

// Anexos 3, 13 y 14: escala real B/R/M y sus escapes.
describe("definiciones migradas a B/R/M", () => {
  it("EPP, Carros y Contenedores usan la escala del anexo, no la binaria", async () => {
    const { INSPECCION_EPP } = await import("@/lib/sst/definitions/inspeccion-epp")
    const { INSPECCION_CARROS } = await import("@/lib/sst/definitions/inspeccion-carros")
    const { INSPECCION_CONTENEDORES } = await import("@/lib/sst/definitions/inspeccion-contenedores")
    const kinds = (d: { sections: Array<{ items: Array<{ kind: string }> }> }) =>
      new Set(d.sections.flatMap((s) => s.items.map((i) => i.kind)))

    // Ninguna debe conservar el kind binario que aplanaba Regular.
    for (const def of [INSPECCION_EPP, INSPECCION_CARROS, INSPECCION_CONTENEDORES]) {
      expect([...kinds(def)]).not.toContain("cumple_nocumple_na_obs")
    }
    // Carros: leyenda "B= BUENO  R= REGULAR  M= MALO", sin N/A.
    expect(kinds(INSPECCION_CARROS)).toContain("bueno_regular_malo_obs")
    // Contenedores: la única con NT ("no tiene").
    expect(kinds(INSPECCION_CONTENEDORES)).toContain("bueno_regular_malo_na_nt_obs")
    /* EPP: el Anexo 3 es una matriz con DOS columnas por EPP —"Usa" (Sí/No/N/A)
     * y "Estado" (B/R/M)—, así que el N/A vive en la columna de uso y no en la
     * de estado. La expectativa anterior (`bueno_regular_malo_na_obs` +
     * `entregado_obs`) describía la versión de una sola columna, anterior al
     * refactor a `eppMatrixRow`. */
    expect(kinds(INSPECCION_EPP)).toContain("si_no_na_obs")
    expect(kinds(INSPECCION_EPP)).toContain("bueno_regular_malo_obs")
    // El bloqueador solar conserva su registro de entrega como columna propia.
    expect(kinds(INSPECCION_EPP)).toContain("si_no_obs")
  })

  it("las tres pasan el validador del PDTP", async () => {
    const { pdtpChecklistDefinitionSchema } = await import("@/lib/validation/prevention-module/pdtp")
    const { INSPECCION_EPP } = await import("@/lib/sst/definitions/inspeccion-epp")
    const { INSPECCION_CARROS } = await import("@/lib/sst/definitions/inspeccion-carros")
    const { INSPECCION_CONTENEDORES } = await import("@/lib/sst/definitions/inspeccion-contenedores")
    for (const def of [INSPECCION_EPP, INSPECCION_CARROS, INSPECCION_CONTENEDORES]) {
      expect(() => pdtpChecklistDefinitionSchema.parse(def)).not.toThrow()
    }
  })

  it("NT y N/A salen del denominador en el cálculo PDTP", async () => {
    const { getOrCreateExecutionChecklist, upsertChecklistResponses } = await import("@/lib/services/pdtp/execution-checklists")
    await seedChecklistTemplate("act-1", "NT", {
      code: "nt", version: "01", revisionDate: "2026-01-01", title: "NT", tipo: "seguimiento",
      legalFramework: [], applicableTo: "",
      sections: [{
        id: "s1", title: "S",
        items: [
          { id: "i1", label: "I1", kind: "bueno_regular_malo_na_nt_obs" },
          { id: "i2", label: "I2", kind: "bueno_regular_malo_na_nt_obs" },
          { id: "i3", label: "I3", kind: "bueno_regular_malo_na_nt_obs" },
        ],
      }],
      closingAct: { title: "Cierre", resultOptions: [], signatureRoles: [] },
    })
    const instance = await getOrCreateExecutionChecklist("exec-1", "u1")
    const { porcentajeCumplimiento } = await upsertChecklistResponses(instance.id, [
      { seccionId: "s1", itemId: "i1", estado: "cumple" },
      { seccionId: "s1", itemId: "i2", estado: "na" },
      { seccionId: "s1", itemId: "i3", estado: "no_tiene" },
    ], "u1")
    // Sólo i1 entra al denominador → 100%, no 33%.
    expect(porcentajeCumplimiento).toBe(100)
  })
})

// Anexo 8 — Evidencia Objetiva No Planeada.
describe("Anexo 8: daño potencial y normativa legal", () => {
  it("persiste ambos campos en el hallazgo manual", async () => {
    const { createActionPlanItem } = await import("@/lib/services/pdtp/action-plan")
    const row = await createActionPlanItem({
      executionId: "exec-1",
      hallazgo: "Tablero eléctrico sin tapa",
      accion: "Instalar tapa y señalizar",
      responsableRole: "prevencionista_faena",
      responsable: "Prevencionista",
      plazo: "2026-08-20",
      prioridad: "alta",
      dañoPotencial: "fatal",
      normativaLegal: "Ley 21.512 art. 32",
    }, "u1")

    expect(row.danoPotencial).toBe("fatal")
    expect(row.normativaLegal).toBe("Ley 21.512 art. 32")
    // La prioridad sola no basta: grave y fatal colapsan ambos en alta.
    expect(row.prioridad).toBe("alta")
  })

  it("guarda el daño potencial declarado por la plantilla en las acciones automáticas", async () => {
    const { getOrCreateExecutionChecklist, upsertChecklistResponses } = await import("@/lib/services/pdtp/execution-checklists")
    const { submitExecutionChecklist, listActionPlanItems } = await import("@/lib/services/pdtp/action-plan")
    await seedChecklistTemplate("act-1", "DP", {
      code: "dp", version: "01", revisionDate: "2026-01-01", title: "DP", tipo: "seguimiento",
      legalFramework: [], applicableTo: "",
      sections: [{
        id: "s1", title: "S",
        items: [{ id: "i1", label: "Alarma de retroceso", kind: "cumple_nocumple_obs", danoPotencial: "fatal" }],
      }],
      closingAct: { title: "Cierre", resultOptions: [], signatureRoles: [] },
    })
    const instance = await getOrCreateExecutionChecklist("exec-1", "u1")
    await upsertChecklistResponses(instance.id, [
      { seccionId: "s1", itemId: "i1", estado: "no_cumple", observacion: "No suena", accionCorrectiva: "Reparar" },
    ], "u1")
    await submitExecutionChecklist(instance.id, "u1")

    const acciones = await listActionPlanItems("exec-1")
    expect(acciones[0]!.danoPotencial).toBe("fatal")
  })
})
