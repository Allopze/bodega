/**
 * CAP-002 / PER-002 (auditoría 2026-09-14) — El acuse de una capacitación y el
 * del AST de un permiso sólo los podía dar un trabajador CON cuenta.
 *
 * Los dos acuses comprobaban `workerUserId === access.userId`: la fila del
 * trabajador tenía que estar vinculada a un `users.id` y esa persona tenía que
 * traer sesión. La mayoría del personal de faena no es usuario de la
 * plataforma —el propio módulo PPA lo declara—, así que la constancia de haber
 * recibido la información sólo existía para una minoría, y desde PER-001 un
 * tipo de permiso que exigiera el acuse era directamente inactivable para una
 * cuadrilla sin cuentas.
 *
 * Antes de la corrección, TODAS las pruebas de este archivo fallaban: las
 * funciones `...ByPublicToken` no existían y la única vía era la sesión.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

process.env.AUTH_SECRET ||= "secreto-de-prueba-acuse-sin-cuenta"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const permits = await import("@/lib/services/prevention-permits")
const { derivePreventionAckToken } = await import("@/lib/services/prevention-ack-token")
const { getPermitCrewAckPublicView } = await import("@/lib/services/prevention-ack-public")

const WS = "ws-acuse"
const SCOPE = { mode: "some", ids: [WS] } as WorksiteScope
const TODOS = [
  "prevention:permits:view", "prevention:permits:manage", "prevention:permits:request",
  "prevention:permits:verify", "prevention:permits:approve", "prevention:permits:activate",
  "prevention:permits:suspend", "prevention:permits:close",
]
const SOLICITANTE = { userId: "acuse-solicitante", scope: SCOPE, permissions: TODOS.filter((p) => p !== "prevention:permits:approve") }
const APROBADOR = { userId: "acuse-aprobador", scope: SCOPE, permissions: TODOS }

/** El trabajador del caso: SIN cuenta de usuario. Es el punto del hallazgo. */
const WORKER_SIN_CUENTA = "wk-acuse-sin-cuenta"

function ventana() {
  const inicio = new Date(Date.now() + 60 * 60 * 1000)
  return {
    plannedStartAt: inicio.toISOString(),
    plannedEndAt: new Date(inicio.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  }
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena Acuse", code: "ACUSE", isActive: true })
  await testDb.insert(schema.workers).values({
    id: WORKER_SIN_CUENTA, rut: "17777777-7", firstName: "Rosa", lastName: "Millán",
    position: "Ayudante", worksiteId: WS,
  })
  await testDb.insert(schema.users).values([
    { id: SOLICITANTE.userId, name: "Solicitante", email: "solicitante@acuse.cl", hashedPassword: "x", isActive: true },
    { id: APROBADOR.userId, name: "Aprobador", email: "aprobador@acuse.cl", hashedPassword: "x", isActive: true },
  ])

})

/* El acuse de capacitación sin cuenta (CAP-002) se retiró el 2026-09-19 con el
 * modelo de capacitación por persona: sin asistencia individual no hay nada que
 * una persona pueda acusar. Queda su hermano, el acuse del AST, que es el que
 * bloquea la activación de un permiso. */

describe("PER-002 — acuse del AST sin cuenta de usuario", () => {
  async function permisoAprobadoConCuadrillaSinCuenta() {
    const tipo = await permits.createPermitType({
      code: `ACU-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: "Trabajo en altura (cuadrilla sin cuentas)",
      requiresIsolation: false,
      requiresMeasurement: false,
      requiresJsa: false,
      requiresCrewAcknowledgement: true,
      maxDurationHours: 8,
      legalBasis: "DS 44/2024: tarea crítica con cuadrilla briefeada.",
    }, APROBADOR)

    const permiso = await permits.createWorkPermit({
      permitTypeId: tipo.id, worksiteId: WS,
      taskDescription: "Cambio de luminarias sobre los 1,8 m.",
      location: "Nave de mantención", supervisorUserId: APROBADOR.userId,
      ...ventana(),
      crew: [{ workerId: WORKER_SIN_CUENTA, role: "executor" }],
      controls: [],
    }, SOLICITANTE)
    const enviado = await permits.transitionWorkPermit({
      permitId: permiso.id, expectedVersion: permiso.version, toStatus: "pending_approval",
      reason: "Permiso completo, se envía a aprobación.",
    }, SOLICITANTE)
    const aprobado = await permits.transitionWorkPermit({
      permitId: permiso.id, expectedVersion: enviado.version, toStatus: "approved",
      reason: "Revisión documental conforme al estándar de altura.",
    }, APROBADOR)
    return { permitId: permiso.id, version: aprobado.version }
  }

  it("la cuadrilla sin cuentas acusa por enlace y el permiso deja de estar bloqueado", async () => {
    const { permitId, version } = await permisoAprobadoConCuadrillaSinCuenta()
    const [integrante] = await testDb.select().from(schema.preventionPermitCrew)
      .where(eq(schema.preventionPermitCrew.permitId, permitId))

    // Punto de partida del hallazgo: con PER-001 activo, este permiso estaba
    // bloqueado y NO existía forma de desbloquearlo, porque Rosa no es usuaria.
    const antes = await permits.evaluatePermitReadiness(permitId, APROBADOR)
    expect(antes.blockers.map((item) => item.kind)).toEqual(["crew_ack_missing"])

    const token = derivePreventionAckToken("permiso", integrante!.id)
    const vista = await getPermitCrewAckPublicView(integrante!.id, token)
    expect(vista).toMatchObject({ workerName: "Rosa Millán", acknowledgedAt: null })

    const acusado = await permits.acknowledgePermitCrewByPublicToken(
      { crewId: integrante!.id, token },
      { ip: "203.0.113.9", userAgent: "Terreno/1.0" },
    )
    expect(acusado.acknowledgementChannel).toBe("public_token")
    expect(acusado.acknowledgementSha256).toHaveLength(64)

    expect(await permits.evaluatePermitReadiness(permitId, APROBADOR)).toEqual({ allowed: true, blockers: [] })
    const activado = await permits.transitionWorkPermit({
      permitId, expectedVersion: version, toStatus: "active",
      reason: "Cuadrilla briefeada, con acuse del AST por enlace personal.",
    }, APROBADOR)
    expect(activado.status).toBe("active")
  })

  it("un token que no corresponde al integrante no acusa nada", async () => {
    const { permitId } = await permisoAprobadoConCuadrillaSinCuenta()
    const [integrante] = await testDb.select().from(schema.preventionPermitCrew)
      .where(eq(schema.preventionPermitCrew.permitId, permitId))

    await expect(permits.acknowledgePermitCrewByPublicToken({
      crewId: integrante!.id, token: derivePreventionAckToken("permiso", "otro-integrante"),
    })).rejects.toThrow()

    const [sinTocar] = await testDb.select().from(schema.preventionPermitCrew)
      .where(eq(schema.preventionPermitCrew.id, integrante!.id))
    expect(sinTocar!.acknowledgedAt).toBeNull()
  })
})
