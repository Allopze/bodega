/**
 * lib/__tests__/prevention-emergency-plan-seed.test.ts
 *
 * El sembrador de planes de emergencia.
 *
 * Existe porque `prevention_emergency_plans` llegó vacío a producción y eso
 * dejaba bloqueada la activación del programa anual: la compuerta exige que la
 * N°84 tenga dónde acreditar, y su número lo declara el plan.
 *
 * Los dos invariantes que estos casos protegen son que **reejecutarlo no cree
 * nada** —corre en cada despliegue— y que **una faena sin dotación no lo
 * detenga**: el plan y sus escenarios son lo que destraba la compuerta, el
 * organigrama es lo que habilita la firma, y son cosas distintas.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

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

const {
  seedEmergencyPlansForActiveWorksites,
  pickEmergencyCoordinator,
  EMERGENCY_COORDINATOR_ROLE_NAME,
} = await import("@/lib/services/prevention-emergency-seed")
const { approveEmergencyPlan } = await import("@/lib/services/prevention-emergency")

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const ACTOR = "user-emg-seed"
const APPROVER = "user-emg-approver"
const WS_CON = "ws-emg-con"
const WS_SIN = "ws-emg-sin"
const WS_OFF = "ws-emg-inactiva"

async function plans() {
  return inMemoryDb.select().from(schema.preventionEmergencyPlans)
}
async function scenarios() {
  return inMemoryDb.select().from(schema.preventionEmergencyScenarios)
}
async function planRoles() {
  return inMemoryDb.select().from(schema.preventionEmergencyRoles)
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.preventionEmergencyRoles)
  await inMemoryDb.delete(schema.preventionEmergencyScenarios)
  await inMemoryDb.delete(schema.preventionEmergencyPlans)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values([
    { id: ACTOR, name: "Prevencionista de faena", email: "prf-emg@example.test", hashedPassword: "x" },
    { id: APPROVER, name: "Jefa de prevención", email: "jefa-emg@example.test", hashedPassword: "x" },
  ])
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_CON, name: "Faena Con Dotación", code: "FCD", isActive: true },
    { id: WS_SIN, name: "Faena Sin Dotación", code: "FSD", isActive: true },
    { id: WS_OFF, name: "Faena Inactiva", code: "FIN", isActive: false },
  ])
  await inMemoryDb.insert(schema.workers).values([
    { id: "wk-emg-b", firstName: "Ana", lastName: "Operaria", position: "Operadora", worksiteId: WS_CON, isActive: true, createdAt: now },
    { id: "wk-emg-a", firstName: "Luis", lastName: "Jefe", position: "Jefe de terreno", worksiteId: WS_CON, isActive: true, createdAt: now },
    { id: "wk-emg-c", firstName: "Sin", lastName: "Vigencia", position: "Operador", worksiteId: WS_SIN, isActive: false, createdAt: now },
  ])
})

describe("pickEmergencyCoordinator", () => {
  it("prefiere un cargo de mando sobre el orden de la tabla", () => {
    const elegido = pickEmergencyCoordinator([
      { id: "wk-a", position: "Operador" },
      { id: "wk-z", position: "Supervisor de faena" },
    ])
    expect(elegido?.id).toBe("wk-z")
  })

  it("sin cargo de mando cae al menor id, no a un azar", () => {
    // La elección tiene que ser determinista: si cambia entre ambientes, el
    // organigrama de dos bases con los mismos datos deja de coincidir.
    const elegido = pickEmergencyCoordinator([
      { id: "wk-z", position: "Operador" },
      { id: "wk-a", position: "Ayudante" },
    ])
    expect(elegido?.id).toBe("wk-a")
  })

  it("sin candidatos devuelve null", () => {
    expect(pickEmergencyCoordinator([])).toBeNull()
  })
})

describe("seedEmergencyPlansForActiveWorksites", () => {
  it("siembra un plan por faena activa, con sus cinco amenazas obligatorias", async () => {
    const result = await seedEmergencyPlansForActiveWorksites({ actorUserId: ACTOR })

    expect(result.worksites).toBe(2)      // la inactiva no cuenta
    expect(result.plansCreated).toBe(2)
    expect(result.scenariosCreated).toBe(10)

    const rows = await plans()
    expect(rows).toHaveLength(2)
    expect(rows.every((p) => p.status === "draft")).toBe(true)
    expect(rows.map((p) => p.worksiteId).sort()).toEqual([WS_CON, WS_SIN].sort())

    const tipos = [...new Set((await scenarios()).map((s) => s.type))].sort()
    expect(tipos).toEqual(["asalto_robo", "corte_agua", "corte_energia", "incendio_estructural", "sismo"])
  })

  it("declara la N°84 en cada plan — es lo que destraba la compuerta", async () => {
    await seedEmergencyPlansForActiveWorksites({ actorUserId: ACTOR })
    for (const plan of await plans()) {
      expect(plan.pdtpActivityNumbers, plan.code).toEqual([84])
    }
  })

  it("una faena sin dotación activa recibe su plan igual, pero sin organigrama", async () => {
    // El plan y los escenarios destraban la compuerta; el rol habilita la firma.
    // Detener el sembrado por falta de dotación confundiría las dos cosas.
    const result = await seedEmergencyPlansForActiveWorksites({ actorUserId: ACTOR })

    expect(result.withoutStaff).toEqual(["Faena Sin Dotación"])
    expect(result.rolesCreated).toBe(1)

    const [planSin] = await inMemoryDb.select().from(schema.preventionEmergencyPlans)
      .where(eq(schema.preventionEmergencyPlans.worksiteId, WS_SIN))
    expect(planSin).toBeDefined()
    const rolesDelPlanSin = (await planRoles()).filter((r) => r.planId === planSin!.id)
    expect(rolesDelPlanSin).toHaveLength(0)
  })

  it("elige como titular al cargo de mando y deja al otro de reemplazo", async () => {
    await seedEmergencyPlansForActiveWorksites({ actorUserId: ACTOR })
    const [rol] = await planRoles()
    expect(rol!.roleName).toBe(EMERGENCY_COORDINATOR_ROLE_NAME)
    expect(rol!.assigneeWorkerId).toBe("wk-emg-a")   // "Jefe de terreno"
    expect(rol!.backupWorkerId).toBe("wk-emg-b")
  })

  it("reejecutarlo no crea nada", async () => {
    await seedEmergencyPlansForActiveWorksites({ actorUserId: ACTOR })
    const second = await seedEmergencyPlansForActiveWorksites({ actorUserId: ACTOR })

    expect(second).toMatchObject({ plansCreated: 0, scenariosCreated: 0, rolesCreated: 0 })
    expect(await plans()).toHaveLength(2)
    expect(await scenarios()).toHaveLength(10)
    expect(await planRoles()).toHaveLength(1)
  })

  it("en dry run no escribe nada", async () => {
    const result = await seedEmergencyPlansForActiveWorksites({ actorUserId: ACTOR, dryRun: true })
    expect(result.plansCreated).toBe(2)
    expect(await plans()).toHaveLength(0)
  })

  it("un plan ya aprobado no se toca: su contenido está congelado", async () => {
    await seedEmergencyPlansForActiveWorksites({ actorUserId: ACTOR })
    const [planCon] = await inMemoryDb.select().from(schema.preventionEmergencyPlans)
      .where(eq(schema.preventionEmergencyPlans.worksiteId, WS_CON))

    // Lo aprueba OTRA persona: el servicio exige que quien firma no sea quien creó.
    await approveEmergencyPlan({ planId: planCon!.id, expectedVersion: planCon!.version }, {
      userId: APPROVER,
      scope: { mode: "all", ids: [] },
      permissions: ["prevention:emergency:approve"],
    })

    const result = await seedEmergencyPlansForActiveWorksites({ actorUserId: ACTOR })
    expect(result.frozen).toEqual(["Faena Con Dotación"])
    expect(result.scenariosCreated).toBe(0)
    expect(await scenarios()).toHaveLength(10)
  })
})
