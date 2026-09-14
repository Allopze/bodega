/**
 * `PEND-003` (auditoría 2026-09-14) — la CTA de seguimiento SST abre el
 * seguimiento que la originó.
 *
 * Antes: la fuente `sst_followup` seleccionaba el id del seguimiento como
 * `source_id` y unía su evaluación —conocía las dos identidades— pero emitía
 * siempre `'/prevencion/evaluaciones'`, la lista general agrupada por trabajador
 * (hasta 50 grupos, sin parámetros de destino). La CTA decía «Registrar
 * seguimiento» y aterrizaba en una pantalla donde había que buscar el caso a
 * mano, con el riesgo de actualizar el seguimiento equivocado.
 */

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

import { getOperationalWorkQueue } from "@/lib/services/operational-work-queue"

const now = "2026-01-10T12:00:00.000Z"
const WORKSITE = "ws-pend003"
const USER = "u-pend003"
const WORKER = "w-pend003"
const EVALUATION = "eval-pend003"
const FOLLOWUP = "seg-pend003"

function makeSession(permissions: string[]): Session {
  return {
    expires: "2099-01-01T00:00:00.000Z",
    user: {
      id: USER, name: "Prevencionista", email: "pend003@chome.cl",
      roles: [], permissions, worksiteIds: [WORKSITE], primaryWorksiteId: WORKSITE,
      avatarColor: null, isActive: true,
    },
  } as Session
}

describe("PEND-003 — el pendiente de seguimiento SST enlaza su propia evaluación", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await inMemoryDb.insert(schema.worksites).values({
      id: WORKSITE, name: "Faena PEND-003", code: "PEND003", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.users).values({
      id: USER, name: "Prevencionista", email: "pend003@chome.cl",
      hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.workers).values({
      id: WORKER, firstName: "Trabajador", lastName: "PEND003", worksiteId: WORKSITE, isActive: true, createdAt: now,
    })
    await inMemoryDb.insert(schema.sstEvaluations).values({
      id: EVALUATION, worksiteId: WORKSITE, workerId: WORKER, createdBy: USER,
      definicionCode: "trabajador_nuevo", definicionVersion: "01", tipo: "nuevo",
      fechaEvaluacion: "2026-01-01", estado: "cerrada", createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.sstScheduledFollowups).values({
      id: FOLLOWUP, evaluationId: EVALUATION, instancia: "dia_7",
      fechaProgramada: "2026-01-08", realizado: false,
    })
  })

  afterAll(async () => { await pg.close() })

  it("la CTA abre la ficha de la evaluación y nombra el seguimiento, no la lista general", async () => {
    const result = await getOperationalWorkQueue(makeSession(["sst:manage", "sst:view"]), { module: "sst" })
    const item = result.items.find((row) => row.sourceId === FOLLOWUP)

    expect(item).toBeDefined()
    expect(item!.ctaLabel).toBe("Registrar seguimiento")
    // Lo que fallaba: el href era la lista agrupada por trabajador, sin
    // evaluación, sin seguimiento y sin faena.
    expect(item!.href).not.toBe("/prevencion/evaluaciones")
    expect(item!.href).toBe(`/prevencion/${EVALUATION}?seguimiento=${FOLLOWUP}`)
  })
})
