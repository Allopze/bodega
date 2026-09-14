/**
 * PER-001 (auditoría 2026-09-14) — Un permiso de trabajo se activaba sin que la
 * cuadrilla hubiera acusado el AST.
 *
 * La compuerta de activación tenía doce bloqueadores (control pendiente,
 * aislamiento sin aplicar, medición vencida, cuadrilla sin competencia,
 * ventana expirada…) y **el acuse del AST no era uno de ellos**: el acuse
 * existía, sólo lo podía dar el propio integrante, era de un solo uso y se
 * sellaba con SHA-256, pero un permiso pasaba a `active` con cero acuses. El
 * respaldo de que la cuadrilla fue informada de los riesgos no condicionaba la
 * autorización.
 *
 * Esta prueba recorre el camino real del servicio —crear el tipo, el permiso,
 * aprobarlo y activarlo— y no sólo la función de cálculo, porque el defecto
 * estaba en que la evaluación ni siquiera leía el acuse desde la base.
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

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const service = await import("@/lib/services/prevention-permits")

const WS = "ws-perack"
const SCOPE = { mode: "some", ids: [WS] } as WorksiteScope
const TODOS = [
  "prevention:permits:view", "prevention:permits:manage", "prevention:permits:request",
  "prevention:permits:verify", "prevention:permits:approve", "prevention:permits:activate",
  "prevention:permits:suspend", "prevention:permits:close",
]
/** Solicita el permiso; no puede aprobarlo (segregación ya existente). */
const SOLICITANTE = { userId: "perack-solicitante", scope: SCOPE, permissions: TODOS.filter((p) => p !== "prevention:permits:approve") }
const APROBADOR = { userId: "perack-aprobador", scope: SCOPE, permissions: TODOS }
/** Integrante de la cuadrilla CON cuenta: es el único que puede acusar lo suyo. */
const OPERADOR = { userId: "perack-operador", scope: SCOPE, permissions: ["prevention:permits:view"] }

function ventana() {
  const inicio = new Date(Date.now() + 60 * 60 * 1000)
  return {
    plannedStartAt: inicio.toISOString(),
    plannedEndAt: new Date(inicio.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  }
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena Permisos", code: "PERACK", isActive: true })
  await testDb.insert(schema.workers).values({
    id: "wk-perack", rut: "18888888-8", firstName: "Ana", lastName: "Pérez",
    position: "Operadora", worksiteId: WS,
  })
  await testDb.insert(schema.users).values([
    { id: SOLICITANTE.userId, name: "Solicitante", email: "solicitante@perack.cl", hashedPassword: "x", isActive: true },
    { id: APROBADOR.userId, name: "Aprobador", email: "aprobador@perack.cl", hashedPassword: "x", isActive: true },
    { id: OPERADOR.userId, name: "Ana Pérez", email: "ana@perack.cl", hashedPassword: "x", isActive: true, workerId: "wk-perack" },
  ])
})

/** Deja un permiso aprobado, con cuadrilla y sin ningún otro bloqueador vivo. */
async function permisoAprobado(requiresCrewAcknowledgement: boolean) {
  const tipo = await service.createPermitType({
    code: `ALT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    name: "Trabajo en altura",
    requiresIsolation: false,
    requiresMeasurement: false,
    // Sin AST exigido y sin controles obligatorios: así el único bloqueador
    // posible es el que se está probando.
    requiresJsa: false,
    requiresCrewAcknowledgement,
    maxDurationHours: 8,
    legalBasis: "DS 44/2024: tarea crítica con cuadrilla briefeada.",
  }, APROBADOR)

  const permiso = await service.createWorkPermit({
    permitTypeId: tipo.id, worksiteId: WS,
    taskDescription: "Cambio de luminarias en estructura sobre los 1,8 m.",
    location: "Nave de mantención", supervisorUserId: APROBADOR.userId,
    ...ventana(),
    crew: [{ workerId: "wk-perack", role: "executor" }],
    controls: [],
  }, SOLICITANTE)

  const enviado = await service.transitionWorkPermit({
    permitId: permiso.id, expectedVersion: permiso.version, toStatus: "pending_approval",
    reason: "Permiso completo, se envía a aprobación.",
  }, SOLICITANTE)
  const aprobado = await service.transitionWorkPermit({
    permitId: permiso.id, expectedVersion: enviado.version, toStatus: "approved",
    reason: "Revisión documental conforme al estándar de altura.",
  }, APROBADOR)
  return { permitId: permiso.id, version: aprobado.version }
}

describe("PER-001 — el acuse del AST bloquea la activación del permiso", () => {
  it("no habilita un permiso cuya cuadrilla no acusó el AST", async () => {
    const { permitId, version } = await permisoAprobado(true)

    const habilitacion = await service.evaluatePermitReadiness(permitId, APROBADOR)
    expect(habilitacion.allowed).toBe(false)
    expect(habilitacion.blockers.map((item) => item.kind)).toEqual(["crew_ack_missing"])

    // Antes de PER-001 esta transición **pasaba**: el permiso quedaba vigente
    // con cero acuses y el resto del expediente en regla.
    await expect(service.transitionWorkPermit({
      permitId, expectedVersion: version, toStatus: "active",
      reason: "Intento de habilitar sin que la cuadrilla acuse el AST.",
    }, APROBADOR)).rejects.toThrow(/no ha acusado el AST/)

    const [fila] = await testDb.select().from(schema.preventionWorkPermits)
      .where(eq(schema.preventionWorkPermits.id, permitId))
    expect(fila!.status).toBe("approved")
  })

  it("habilita en cuanto el propio integrante acusa", async () => {
    const { permitId, version } = await permisoAprobado(true)
    const [integrante] = await testDb.select().from(schema.preventionPermitCrew)
      .where(eq(schema.preventionPermitCrew.permitId, permitId))

    await service.acknowledgePermitCrew({ crewId: integrante!.id }, OPERADOR)

    expect(await service.evaluatePermitReadiness(permitId, APROBADOR)).toEqual({ allowed: true, blockers: [] })
    const activado = await service.transitionWorkPermit({
      permitId, expectedVersion: version, toStatus: "active",
      reason: "Cuadrilla briefeada y con acuse firmado del AST.",
    }, APROBADOR)
    expect(activado.status).toBe("active")
  })

  it("un tipo de permiso que no exige el acuse sigue activando sin él", async () => {
    // El bloqueo es configurable por tipo —la salida que sanciona el plan de
    // remediación—, no una regla universal cableada en el código.
    const { permitId, version } = await permisoAprobado(false)
    const activado = await service.transitionWorkPermit({
      permitId, expectedVersion: version, toStatus: "active",
      reason: "Tipo de permiso que no exige acuse del AST.",
    }, APROBADOR)
    expect(activado.status).toBe("active")
  })
})
