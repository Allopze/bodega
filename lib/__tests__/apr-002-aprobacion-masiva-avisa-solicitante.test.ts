/**
 * `APR-002` (auditoría 2026-09-14) — la aprobación masiva también avisa al solicitante.
 *
 * Antes: `approveItemAction` (gesto individual) leía el solicitante y le mandaba
 * `request_approved` tras el commit; `bulkApproveItems` —el servicio detrás de
 * «Aprobar todos» y de la barra «Aprobar N», que es lo que la interfaz
 * recomienda para un grupo completo— aprobaba y terminaba en revalidación, sin
 * cargar solicitantes ni emitir nada. El mismo hecho de negocio avisaba o no
 * según el gesto del aprobador.
 *
 * Las notificaciones se insertan de verdad (no se mockea `notifyManyUser`):
 * la agrupación y la llave de deduplicación se apoyan en el índice único
 * parcial `notifications_user_dedupe_unique`, y mockear el emisor lo escondería.
 */

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import { and, eq } from "drizzle-orm"
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

// El correo no es parte del contrato que se prueba acá; sólo estorbaría.
vi.mock("@/lib/email/smtp", () => ({
  sendEmail: vi.fn(async () => {}),
  sendBatchEmails: vi.fn(async () => {}),
  getAppBaseUrl: () => "http://localhost:3000",
}))

/**
 * `notifyAfterCommit` difiere al microtask; acá hay que poder esperar el aviso.
 * Se conserva el resto del barrel REAL para que la notificación entre a la base.
 */
const notifyState = vi.hoisted(() => ({ pending: [] as Promise<unknown>[] }))
vi.mock("@/lib/services/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/notifications")>()
  return {
    ...actual,
    notifyAfterCommit: (thunk: () => unknown) => {
      notifyState.pending.push(Promise.resolve().then(thunk))
    },
  }
})

import { bulkApproveItems } from "@/lib/services/item-state"

const now = new Date().toISOString()
const WORKSITE = "ws-apr002"
const APPROVER = "u-aprobador-apr002"
const REQUESTER_A = "u-solicitante-a-apr002"
const REQUESTER_B = "u-solicitante-b-apr002"

async function approvalNotificationsFor(userId: string) {
  await Promise.all(notifyState.pending)
  notifyState.pending.length = 0
  return inMemoryDb.query.notifications.findMany({
    where: and(
      eq(schema.notifications.userId, userId),
      eq(schema.notifications.type, "request_approved"),
    ),
  })
}

let counter = 0
async function makeRequest(requesterId: string, itemCount: number, itemStatus: "requested" | "approved" = "requested") {
  const suffix = ++counter
  const requestId = `req-apr002-${suffix}`
  await inMemoryDb.insert(schema.purchaseRequests).values({
    id: requestId, code: `SOL-APR002-${suffix}`, worksiteId: WORKSITE, requesterId,
    requestType: "epp", urgency: "normal", status: "submitted", createdAt: now, updatedAt: now,
  })
  const itemIds = Array.from({ length: itemCount }, (_, index) => `reqi-apr002-${suffix}-${index}`)
  await inMemoryDb.insert(schema.purchaseRequestItems).values(itemIds.map((id) => ({
    id, requestId, productNameFree: `Ítem ${id}`, quantity: 1, unitOfMeasure: "unidad",
    status: itemStatus, createdAt: now, updatedAt: now,
  })))
  return { requestId, itemIds }
}

describe("APR-002 — la aprobación masiva notifica al solicitante", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await inMemoryDb.insert(schema.worksites).values({
      id: WORKSITE, name: "Faena APR-002", code: "APR002", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.users).values([
      { id: APPROVER, name: "Jefa Aprobadora", email: "aprobador-apr002@chome.cl", hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now },
      { id: REQUESTER_A, name: "Solicitante A", email: "sol-a-apr002@chome.cl", hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now },
      { id: REQUESTER_B, name: "Solicitante B", email: "sol-b-apr002@chome.cl", hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now },
    ])
  })

  afterAll(async () => { await pg.close() })

  it("un lote de varias líneas de la misma solicitud produce UN aviso al solicitante", async () => {
    const { requestId, itemIds } = await makeRequest(REQUESTER_A, 3)

    await bulkApproveItems(itemIds, APPROVER, { approverName: "Jefa Aprobadora" })

    const notices = await approvalNotificationsFor(REQUESTER_A)
    expect(notices).toHaveLength(1)
    expect(notices[0]!.title).toContain("3 ítems aprobados")
    expect(notices[0]!.entityId).toBe(requestId)
    expect(notices[0]!.entityHref).toBe(`/solicitudes/${requestId}`)
    expect(notices[0]!.body).toContain("Jefa Aprobadora")
  })

  it("un lote que cruza solicitudes no cruza destinatarios", async () => {
    const first = await makeRequest(REQUESTER_A, 1)
    const second = await makeRequest(REQUESTER_B, 2)

    await bulkApproveItems([...first.itemIds, ...second.itemIds], APPROVER, { approverName: "Jefa Aprobadora" })

    const toA = await approvalNotificationsFor(REQUESTER_A)
    const toB = await approvalNotificationsFor(REQUESTER_B)
    expect(toA.filter((n) => n.entityId === first.requestId)).toHaveLength(1)
    expect(toA.some((n) => n.entityId === second.requestId)).toBe(false)
    expect(toB).toHaveLength(1)
    expect(toB[0]!.entityId).toBe(second.requestId)
    expect(toB[0]!.title).toContain("2 ítems aprobados")
  })

  it("si el lote revierte no se avisa nada: el aviso vive tras el commit", async () => {
    const valid = await makeRequest(REQUESTER_B, 1)
    // Un ítem ya aprobado no admite la transición: la tanda entera revierte.
    const invalid = await makeRequest(REQUESTER_B, 1, "approved")

    await expect(
      bulkApproveItems([...valid.itemIds, ...invalid.itemIds], APPROVER, { approverName: "Jefa Aprobadora" }),
    ).rejects.toThrow()

    const notices = await approvalNotificationsFor(REQUESTER_B)
    expect(notices.some((n) => n.entityId === valid.requestId)).toBe(false)
  })
})
