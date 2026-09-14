/**
 * CAPA-002 y E2E-006 (auditoría 2026-09-14).
 *
 * CAPA-002 — Quien creaba la acción decidía si exigiría evidencia. El schema de
 * creación aceptaba `evidenceRequired: false` del cliente y lo persistía sin
 * pedir justificación: la acción recorría implementación, verificación y cierre
 * sin una sola prueba, y la fila no decía por qué.
 *
 * E2E-006 — No existía forma de abrir una acción correctiva sin un origen del
 * sistema. El enum de la base contemplaba `manual` y ningún código lo escribía,
 * así que un hallazgo de un recorrido obligaba a inventar antes un registro en
 * otro módulo.
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

const { createCapaAction, createManualCapaAction } = await import("@/lib/services/prevention-capa")

const WS = "ws-capa002"
const ACTOR = "capa002-actor"
const SCOPE = { mode: "some", ids: [WS] } as WorksiteScope
const ACCESO = {
  ctx: { userId: ACTOR },
  scope: SCOPE,
  permissions: ["prevention:capa:view", "prevention:capa:manage"],
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena CAPA", code: "CAPA002", isActive: true })
  await testDb.insert(schema.users).values({
    id: ACTOR, name: "Prevencionista", email: "prev@capa002.cl", hashedPassword: "x", isActive: true,
  })
})

describe("CAPA-002 — la exención de evidencia se justifica o no ocurre", () => {
  it("rechaza crear una acción sin evidencia obligatoria cuando no se explica por qué", async () => {
    // Antes de la corrección este mismo input creaba la acción con el gate
    // apagado y sin dejar rastro del motivo.
    await expect(createCapaAction({
      ...ACCESO,
      input: {
        sourceType: "manual", sourceId: "ronda-1", worksiteId: WS,
        finding: "Señalética faltante en el acceso norte",
        actionDescription: "Reponer la señalética del acceso.",
        priority: "medium", targetDate: "2026-12-01",
        evidenceRequired: false,
      },
    })).rejects.toThrow(/al menos 10 caracteres/)
  })

  it("rechaza un motivo de exención más corto que el umbral único de la plataforma", async () => {
    await expect(createCapaAction({
      ...ACCESO,
      input: {
        sourceType: "manual", sourceId: "ronda-2", worksiteId: WS,
        finding: "Extintor sin tarjeta de control",
        actionDescription: "Reponer la tarjeta de control.",
        priority: "medium", targetDate: "2026-12-01",
        evidenceRequired: false, evidenceExemptionReason: "porque",
      },
    })).rejects.toThrow(/al menos 10 caracteres/)
  })

  it("guarda el motivo en la fila y en la bitácora cuando la exención está justificada", async () => {
    const creada = await createCapaAction({
      ...ACCESO,
      input: {
        sourceType: "manual", sourceId: "ronda-3", worksiteId: WS,
        finding: "Charla de seguridad no registrada",
        actionDescription: "Repetir la charla en el turno siguiente.",
        priority: "low", targetDate: "2026-12-01",
        evidenceRequired: false,
        evidenceExemptionReason: "La acción se agota en el acto y no deja producto verificable.",
      },
    })
    expect(creada.evidenceRequired).toBe(false)
    expect(creada.evidenceExemptionReason).toBe("La acción se agota en el acto y no deja producto verificable.")

    const [transicion] = await testDb.select().from(schema.preventionCapaTransitions)
      .where(eq(schema.preventionCapaTransitions.actionId, creada.id))
    expect(transicion?.changeSet).toMatchObject({ evidenceRequired: false })
  })

  it("no admite motivo de exención cuando sí se exige evidencia: la fila diría dos cosas", async () => {
    await expect(createCapaAction({
      ...ACCESO,
      input: {
        sourceType: "manual", sourceId: "ronda-4", worksiteId: WS,
        finding: "Andamio sin rodapié",
        actionDescription: "Instalar rodapié certificado.",
        priority: "high", targetDate: "2026-12-01",
        evidenceRequired: true,
        evidenceExemptionReason: "No hace falta evidencia para esto.",
      },
    })).rejects.toThrow(/Sólo se justifica la exención/)
  })

  it("la base rechaza la exención sin motivo aunque el insert no pase por el servicio", async () => {
    const error = await testDb.insert(schema.preventionCapaActions).values({
      id: "capa-directa", code: "CAPA-DIRECTA", sourceType: "manual", sourceId: "directo-1",
      worksiteId: WS, finding: "Insert directo", actionDescription: "Insert directo",
      targetDate: "2026-12-01", evidenceRequired: false, createdByUserId: ACTOR,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }).then(() => null, (err: unknown) => err)
    // El nombre del CHECK viaja en la causa: drizzle envuelve el mensaje.
    expect((error as { cause?: { constraint?: string } })?.cause?.constraint)
      .toBe("prevention_capa_evidence_exemption_justified")
  })
})

describe("E2E-006 — una acción correctiva puede nacer de una persona", () => {
  it("crea la acción con origen manual descrito y sin ítem de origen", async () => {
    const creada = await createManualCapaAction({
      ...ACCESO,
      input: {
        worksiteId: WS,
        manualOrigin: "Recorrido de terreno del 12-09 con el comité paritario",
        finding: "Cables sueltos en la sala eléctrica",
        actionDescription: "Canalizar y rotular el cableado suelto.",
        priority: "high", targetDate: "2026-12-15",
      },
    })
    expect(creada.sourceType).toBe("manual")
    expect(creada.sourceItemId).toBeNull()
    // El id de origen lo pone el servidor: el cliente no puede colgar la acción
    // de la fila de otro módulo.
    expect(creada.sourceId).toMatch(/^manual-/)
    expect(creada.sourceRef).toMatchObject({ origin: "Recorrido de terreno del 12-09 con el comité paritario" })
    // Nace con el gate de evidencia puesto, como cualquier otra CAPA.
    expect(creada.evidenceRequired).toBe(true)
  })

  it("dos acciones manuales conviven: el índice único es por ítem de origen y no hay ítem", async () => {
    const primera = await createManualCapaAction({
      ...ACCESO,
      input: {
        worksiteId: WS, manualOrigin: "Compromiso del acta de reunión mensual",
        finding: "Falta demarcación de tránsito peatonal",
        actionDescription: "Demarcar la senda peatonal del patio.",
        priority: "medium", targetDate: "2026-12-20",
      },
    })
    const segunda = await createManualCapaAction({
      ...ACCESO,
      input: {
        worksiteId: WS, manualOrigin: "Auditoría externa del mandante",
        finding: "Extintores sin señalización vertical",
        actionDescription: "Instalar señalización vertical de extintores.",
        priority: "medium", targetDate: "2026-12-20",
      },
    })
    expect(segunda.id).not.toBe(primera.id)
    expect(segunda.sourceId).not.toBe(primera.sourceId)
  })

  it("exige el permiso de gestión de CAPA", async () => {
    await expect(createManualCapaAction({
      ...ACCESO,
      permissions: ["prevention:capa:view"],
      input: {
        worksiteId: WS, manualOrigin: "Recorrido", finding: "Hallazgo",
        actionDescription: "Acción", priority: "low", targetDate: "2026-12-20",
      },
    })).rejects.toThrow()
  })

  it("exige describir el origen: sin él la acción no sería trazable", async () => {
    await expect(createManualCapaAction({
      ...ACCESO,
      input: {
        worksiteId: WS, manualOrigin: "",
        finding: "Hallazgo sin origen", actionDescription: "Acción sin origen",
        priority: "low", targetDate: "2026-12-20",
      },
    })).rejects.toThrow()
  })
})
