import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { todayInChile } from "@/lib/utils"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

import {
  acceptTalanaFusible,
  filterByWorksiteScope,
  getTalanaOverview,
  getTalanaWorkerSummaries,
  listTalanaRunItems,
  listTalanaRuns,
  loadTalanaDifferences,
} from "@/lib/integrations/talana/talana-read"

/**
 * Lecturas de `/admin/talana` y de la ficha del trabajador contra Postgres de
 * verdad: el conteo de activos sólo de las razones sociales de Chome, las
 * ausencias vigentes, el bloqueo del fusible y su aceptación auditada, y el
 * resumen laboral por RUT. Nada de esto escribe en Talana ni cambia trabajadores.
 */

const CHOME = "SERVICIOS INDUSTRIALES CHOME LTDA"
const OTHER = "Agrícola Flor del Laja"
const today = todayInChile()
const addDays = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

const userId = "user-talana-read"
const WS_MASISA = "ws-talana-masisa"
const WS_TENO = "ws-talana-teno"

const ISO = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString()

function contract(id: number, rut: string, overrides: Partial<typeof schema.talanaContracts.$inferInsert> = {}): typeof schema.talanaContracts.$inferInsert {
  return {
    talanaContractId: id,
    rut,
    rutValid: true,
    firstName: "ANA",
    lastNamePaternal: "PEREZ",
    lastNameMaternal: "SOTO",
    employerName: CHOME,
    contractType: "Plazo Fijo",
    cargo: "Operador",
    costCenterName: "Masisa Maderas",
    jefeRut: "9999999-9",
    jefeName: "Juan Soto",
    startsOn: addDays(-100),
    endsOn: addDays(10),
    finiquitado: false,
    listedActive: true,
    ...overrides,
  }
}

function sessionWith(isGlobal: boolean, worksiteIds: string[] = []): Session {
  return {
    user: {
      id: userId, name: "RRHH", email: "rrhh@test.cl", roles: [], permissions: ["admin:workers_hr"],
      worksiteIds, primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal,
    },
    expires: "2030-01-01T00:00:00.000Z",
  } satisfies Session
}

describe("lecturas de la sincronización con Talana", () => {
  beforeAll(async () => {
    vi.stubEnv("TALANA_API_TOKEN", "token-de-prueba")
    vi.stubEnv("TALANA_SYNC_MODE", "simulate")
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    const now = new Date().toISOString()

    await testDb.insert(schema.users).values({
      id: userId, name: "RRHH", email: "rrhh-talana@chome.cl", hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now,
    })
    await testDb.insert(schema.worksites).values([
      { id: WS_MASISA, name: "Masisa", code: "TLN-MAS", isActive: true, createdAt: now, updatedAt: now },
      { id: WS_TENO, name: "Teno - Arauco", code: "TLN-TEN", isActive: true, createdAt: now, updatedAt: now },
    ])
    await testDb.insert(schema.workerPositions).values({
      id: "pos-talana-operador", code: "TLN-OPER", name: "Operador de maquinaria", normalizedKey: "operador de maquinaria",
      isActive: true, needsReview: false, isSystem: false, createdAt: now, updatedAt: now,
    })
    await testDb.insert(schema.workers).values([
      // Ana está en Teno pero su centro de costo en Talana es Masisa: «faena distinta».
      { id: "w-ana", rut: "11111111-1", firstName: "Ana", lastName: "Pérez", positionId: "pos-talana-operador", worksiteId: WS_TENO, isActive: true },
      // Beto no figura en Talana.
      { id: "w-beto", rut: "22222222-2", firstName: "Beto", lastName: "Rojas", worksiteId: WS_MASISA, isActive: true },
      // Carla no tiene RUT en Chome.
      { id: "w-carla", rut: null, firstName: "Carla", lastName: "Díaz", worksiteId: WS_TENO, isActive: true },
    ])

    await testDb.insert(schema.talanaContracts).values([
      contract(1001, "11111111-1"),
      // Contrato vigente de una persona sin ficha en Chome.
      contract(1002, "33333333-3", { firstName: "LUIS", lastNamePaternal: "GOMEZ", lastNameMaternal: null, contractType: "Indefinido", endsOn: null }),
      // Otra razón social: no es dotación de Chome.
      contract(1003, "44444444-4", { employerName: OTHER, firstName: "OTRO", lastNamePaternal: "TRABAJADOR" }),
    ])
    await testDb.insert(schema.talanaAbsences).values([
      { talanaAbsenceId: 1, rut: "11111111-1", absenceType: "LICENCIA MEDICA", startsOn: addDays(-1), endsOn: addDays(5), approved: true },
      // Sin aprobar explícitamente (null): cuenta como vigente.
      { talanaAbsenceId: 2, rut: "33333333-3", absenceType: "PERMISO CON GOCE", startsOn: addDays(-2), endsOn: addDays(0), approved: null },
      // Rechazada: no cuenta.
      { talanaAbsenceId: 3, rut: "11111111-1", absenceType: "PERMISO SIN GOCE", startsOn: addDays(-1), endsOn: addDays(2), approved: false },
      // Futura: no es de hoy.
      { talanaAbsenceId: 4, rut: "33333333-3", absenceType: "LICENCIA MEDICA", startsOn: addDays(20), endsOn: addDays(25), approved: true },
      // De alguien sin contrato de Chome (otra razón social): no cuenta en el resumen de la pantalla.
      { talanaAbsenceId: 5, rut: "44444444-4", absenceType: "LICENCIA MEDICA", startsOn: addDays(-1), endsOn: addDays(3), approved: true },
    ])

    await testDb.insert(schema.talanaSyncRuns).values([
      { id: "run-old-block", trigger: "cron", mode: "apply", status: "blocked", fusibleReason: "mass_altas", startedAt: ISO(100), finishedAt: ISO(100) },
      { id: "run-good", trigger: "cron", mode: "simulate", status: "partial", activeContracts: 2, altas: 1, cargos: 1, skipped: 1, startedAt: ISO(50), finishedAt: ISO(50) },
      { id: "run-ok-older", trigger: "cron", mode: "simulate", status: "success", startedAt: ISO(70), finishedAt: ISO(70) },
      { id: "run-block", trigger: "cron", mode: "apply", status: "blocked", fusibleReason: "active_drop", startedAt: ISO(2), finishedAt: ISO(2) },
    ])
    await testDb.insert(schema.talanaSyncRunItems).values([
      { id: "item-cargo", runId: "run-good", workerId: "w-ana", talanaContractId: 1001, rut: "11111111-1", kind: "cargo", outcome: "planned", beforeLabel: "Auxiliar", afterLabel: "Operador de maquinaria" },
      { id: "item-alta", runId: "run-good", workerId: null, talanaContractId: 1002, rut: "33333333-3", kind: "alta", outcome: "planned", afterLabel: "Masisa" },
      { id: "item-skip", runId: "run-good", workerId: "w-beto", talanaContractId: null, rut: "22222222-2", kind: "baja", outcome: "skipped", reasonCode: "actividad_posterior" },
    ])
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    await pg.close()
  })

  describe("getTalanaOverview", () => {
    it("separa la última corrida, el bloqueo sin revisar y la última descarga buena", async () => {
      const overview = await getTalanaOverview()

      expect(overview.config).toEqual({
        mode: "simulate",
        hasCredentials: true,
        sources: { token: "environment", mode: "environment" },
        tokenUnreadable: false,
      })
      expect(overview.lastRun?.id).toBe("run-block")
      expect(overview.blockedRun?.id).toBe("run-block")
      expect(overview.blockedRun?.fusibleReason).toBe("active_drop")
      // La última con datos (success o partial) es la más reciente de las dos, no la bloqueada.
      expect(overview.lastGoodSyncAt).toBe((await testDb.query.talanaSyncRuns.findFirst({ where: eq(schema.talanaSyncRuns.id, "run-good") }))?.finishedAt)
    })

    it("lo guardado en la plataforma gana sobre el .env y el resumen dice de dónde sale, sin el token", async () => {
      await testDb.insert(schema.systemSettings).values({ key: "talana.sync_mode", value: "apply", updatedAt: new Date().toISOString() })
      try {
        const overview = await getTalanaOverview()
        expect(overview.config).toEqual({
          mode: "apply",
          hasCredentials: true,
          sources: { token: "environment", mode: "system_settings" },
          tokenUnreadable: false,
        })
        expect(JSON.stringify(overview.config)).not.toContain("token-de-prueba")
      } finally {
        await testDb.delete(schema.systemSettings).where(eq(schema.systemSettings.key, "talana.sync_mode"))
      }
    })

    it("cuenta como activos sólo los contratos vigentes de las razones sociales de Chome", async () => {
      const overview = await getTalanaOverview()
      // 1001 y 1002 son de Chome; 1003 es de otra razón social.
      expect(overview.activeContracts).toBe(2)
    })

    it("cuenta las ausencias de hoy, aprobadas o sin resolver, de personas con contrato en Chome", async () => {
      const overview = await getTalanaOverview()
      // 1 (aprobada) y 2 (sin resolver): la 3 está rechazada, la 4 es futura y la 5 es de otra razón social.
      expect(overview.currentAbsences).toBe(2)
    })
  })

  describe("listTalanaRuns", () => {
    it("lista de la más reciente a la más antigua y respeta el límite", async () => {
      const runs = await listTalanaRuns()
      expect(runs.map((run) => run.id)).toEqual(["run-block", "run-good", "run-ok-older", "run-old-block"])
      expect(await listTalanaRuns(2)).toHaveLength(2)
    })
  })

  describe("listTalanaRunItems", () => {
    it("muestra el nombre de Chome, o el de Talana si todavía no hay ficha, con la faena", async () => {
      const items = await listTalanaRunItems("run-good")

      // Las altas van primero.
      expect(items.map((item) => item.kind)).toEqual(["alta", "baja", "cargo"])
      const alta = items.find((item) => item.kind === "alta")!
      expect(alta.displayName).toBe("Luis Gomez")
      expect(alta.worksiteId).toBeNull()
      expect(alta.worksiteName).toBeNull()

      const cargo = items.find((item) => item.kind === "cargo")!
      expect(cargo.displayName).toBe("Ana Pérez")
      expect(cargo.worksiteName).toBe("Teno - Arauco")
      expect(cargo.beforeLabel).toBe("Auxiliar")
      expect(cargo.afterLabel).toBe("Operador de maquinaria")

      const baja = items.find((item) => item.kind === "baja")!
      expect(baja.outcome).toBe("skipped")
      expect(baja.reasonCode).toBe("actividad_posterior")
    })

    it("de una corrida sin cambios devuelve una lista vacía", async () => {
      expect(await listTalanaRunItems("run-ok-older")).toEqual([])
    })
  })

  describe("loadTalanaDifferences", () => {
    it("cruza Talana con Chome y reporta lo que la sincronización no resuelve sola", async () => {
      const { differences, syncedAt } = await loadTalanaDifferences()
      const codesOf = (workerId: string | null, rut?: string) =>
        differences.filter((difference) => (workerId ? difference.workerId === workerId : difference.rut === rut)).map((difference) => difference.code)

      expect(codesOf("w-ana")).toContain("faena_distinta")
      expect(codesOf("w-ana")).not.toContain("cargo_distinto")
      expect(codesOf("w-beto")).toContain("activo_sin_contrato")
      expect(codesOf("w-carla")).toContain("sin_rut_en_chome")
      expect(codesOf(null, "33333333-3")).toContain("sin_ficha_en_chome")

      expect(syncedAt).toBe((await testDb.query.talanaSyncRuns.findFirst({ where: eq(schema.talanaSyncRuns.id, "run-good") }))?.finishedAt)
    })

    it("lleva la faena de la ficha, para poder filtrar por alcance", async () => {
      const { differences } = await loadTalanaDifferences()
      expect(differences.find((difference) => difference.code === "faena_distinta")?.worksiteId).toBe(WS_TENO)
      expect(differences.find((difference) => difference.code === "sin_ficha_en_chome")?.worksiteId).toBeNull()
    })
  })

  describe("filterByWorksiteScope", () => {
    const rows = [
      { id: "a", worksiteId: WS_TENO },
      { id: "b", worksiteId: WS_MASISA },
      { id: "c", worksiteId: null },
    ]

    it("una sesión global ve todo, incluso lo que no tiene faena", () => {
      expect(filterByWorksiteScope(sessionWith(true), rows).map((row) => row.id)).toEqual(["a", "b", "c"])
    })

    it("una sesión acotada ve sólo sus faenas y nunca las filas sin faena", () => {
      expect(filterByWorksiteScope(sessionWith(false, [WS_TENO]), rows).map((row) => row.id)).toEqual(["a"])
      expect(filterByWorksiteScope(sessionWith(false, []), rows)).toEqual([])
    })
  })

  describe("getTalanaWorkerSummaries", () => {
    it("resume contrato y ausencia por RUT y omite a quien no tiene nada que mostrar", async () => {
      const summaries = await getTalanaWorkerSummaries([
        { id: "w-ana", rut: "11111111-1" },
        { id: "w-beto", rut: "22222222-2" },
        { id: "w-carla", rut: null },
      ])

      const ana = summaries["w-ana"]!
      expect(ana.contract?.type).toBe("Plazo Fijo")
      expect(ana.contract?.state).toBe("por_vencer")
      expect(ana.contract?.costCenterName).toBe("Masisa Maderas")
      expect(ana.contract?.jefeName).toBe("Juan Soto")
      // La licencia aprobada gana a la rechazada.
      expect(ana.absence).toMatchObject({ label: "Licencia médica", current: true, endsOn: addDays(5) })
      expect(ana.syncedAt).toBe((await testDb.query.talanaSyncRuns.findFirst({ where: eq(schema.talanaSyncRuns.id, "run-good") }))?.finishedAt)

      expect(summaries["w-beto"]).toBeUndefined()
      expect(summaries["w-carla"]).toBeUndefined()
    })

    it("encuentra a la persona aunque la ficha tenga el RUT con puntos", async () => {
      const summaries = await getTalanaWorkerSummaries([{ id: "w-ana", rut: "11.111.111-1" }])
      expect(summaries["w-ana"]?.contract?.type).toBe("Plazo Fijo")
    })

    it("ignora los contratos de otras razones sociales", async () => {
      const summaries = await getTalanaWorkerSummaries([{ id: "w-otro", rut: "44444444-4" }])
      // Sólo tiene una ausencia (por RUT): el contrato de la otra razón social no aparece.
      expect(summaries["w-otro"]?.contract).toBeNull()
      expect(summaries["w-otro"]?.absence?.label).toBe("Licencia médica")
    })

    it("sin trabajadores con RUT no consulta nada", async () => {
      expect(await getTalanaWorkerSummaries([])).toEqual({})
      expect(await getTalanaWorkerSummaries([{ id: "x", rut: null }])).toEqual({})
    })
  })

  describe("acceptTalanaFusible", () => {
    const actor = { userId, email: "rrhh@test.cl" }

    it("no rearma una corrida que ya no es la última terminada", async () => {
      expect(await acceptTalanaFusible("run-old-block", actor)).toBe(false)
      const row = await testDb.query.talanaSyncRuns.findFirst({ where: eq(schema.talanaSyncRuns.id, "run-old-block") })
      expect(row?.fusibleAcceptedAt).toBeNull()
    })

    it("no rearma una corrida que no está bloqueada ni una que no existe", async () => {
      expect(await acceptTalanaFusible("run-good", actor)).toBe(false)
      expect(await acceptTalanaFusible("no-existe", actor)).toBe(false)
    })

    it("rearma la última corrida bloqueada una sola vez y deja constancia en la auditoría", async () => {
      expect(await acceptTalanaFusible("run-block", actor)).toBe(true)

      const row = await testDb.query.talanaSyncRuns.findFirst({ where: eq(schema.talanaSyncRuns.id, "run-block") })
      expect(row?.fusibleAcceptedAt).not.toBeNull()
      expect(row?.fusibleAcceptedBy).toBe(userId)

      const audit = await testDb.query.auditLog.findMany({ where: eq(schema.auditLog.entityId, "run-block") })
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({ action: "update", entityType: "talana_sync_run", reason: "Fusible rearmado", userId })

      // La segunda vez ya no hay nada que rearmar.
      expect(await acceptTalanaFusible("run-block", actor)).toBe(false)
      expect(await testDb.query.auditLog.findMany({ where: eq(schema.auditLog.entityId, "run-block") })).toHaveLength(1)
    })

    it("una vez revisado, el resumen ya no muestra el bloqueo", async () => {
      const overview = await getTalanaOverview()
      expect(overview.lastRun?.id).toBe("run-block")
      expect(overview.blockedRun).toBeNull()
    })
  })

  describe("sin ninguna copia de Talana", () => {
    it("no inventa diferencias: nadie «falta en Talana» si nunca se descargó nada", async () => {
      await testDb.delete(schema.talanaContracts)

      const { differences } = await loadTalanaDifferences()

      expect(differences).toEqual([])
    })
  })
})
