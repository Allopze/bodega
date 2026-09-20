/**
 * Plan de acción del PDTP: ciclo de vida, alcance y dominio de daño potencial.
 *
 * Lo que este archivo cubría del motor de checklist propio se fue con él —los
 * instrumentos viven en Inspecciones—. La cobertura de la escala B/R/M y de la
 * forma del catálogo `lib/sst/definitions/*` no se perdió: la primera ya está,
 * más completa, en `prevention-inspections-calc.test.ts`; la segunda se mudó a
 * `lib/sst/__tests__/definitions.test.ts`.
 */
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
    id: "prog-1", year: 2026, version: 1, status: "active", appliesToAllWorksites: true, title: "T",
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

describe("alcance por faena del plan de acción", () => {
  it("rechaza el acceso a una ejecución y a una acción de otra faena", async () => {
    const { assertPdtpActionPlanItemAccess, assertPdtpExecutionAccess } = await import("@/lib/services/prevention-pdtp")
    const { createActionPlanItem, listActionsByProgram } = await import("@/lib/services/pdtp/action-plan")

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
    await expect(assertPdtpActionPlanItemAccess(action.id, ["w2"])).rejects.toThrow(/sin acceso/i)
    await expect(listActionsByProgram("prog-1", ["w2"])).resolves.toEqual([])
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

})
