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
import { and, eq, inArray } from "drizzle-orm"
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

import { approveItem, bulkApproveItems, rejectItem } from "@/lib/services/item-state"

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
      inArray(schema.notifications.type, ["request_approved", "request_rejected"]),
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

describe("APR-002 — la aprobación masiva notifica al solicitante", () => {
  it("un lote que cierra la revisión produce UN aviso al solicitante", async () => {
    const { requestId, itemIds } = await makeRequest(REQUESTER_A, 3)

    await bulkApproveItems(itemIds, APPROVER, { approverName: "Jefa Aprobadora" })

    const notices = (await approvalNotificationsFor(REQUESTER_A)).filter((n) => n.entityId === requestId)
    expect(notices).toHaveLength(1)
    expect(notices[0]!.type).toBe("request_approved")
    expect(notices[0]!.title).toMatch(/^Solicitud SOL-APR002-\d+ aprobada$/)
    expect(notices[0]!.body).toContain("Se aprobaron los 3 ítems")
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
    expect(toB.filter((n) => n.entityId === second.requestId)).toHaveLength(1)
    expect(toB.find((n) => n.entityId === second.requestId)!.body).toContain("Se aprobaron los 2 ítems")
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

/**
 * Producción, 2026-10-05: SOL-0048 se aprobó con 20 clics individuales en ocho
 * minutos y el solicitante recibió 20 correos "Ítem aprobado en SOL-0048". El
 * aviso es ahora UNO, cuando la solicitud se queda sin ítems por revisar, y
 * resume lo aprobado, lo modificado y lo rechazado con su motivo.
 */
describe("aviso de revisión de la solicitud", () => {
  async function noticesFor(requestId: string) {
    return (await approvalNotificationsFor(REQUESTER_A)).filter((n) => n.entityId === requestId)
  }

  it("no avisa mientras queden ítems por revisar y avisa una vez al decidir el último", async () => {
    const { requestId, itemIds } = await makeRequest(REQUESTER_A, 4)

    await approveItem(itemIds[0]!, APPROVER, { approverName: "Jefa Aprobadora" })
    await approveItem(itemIds[1]!, APPROVER, { approverName: "Jefa Aprobadora", modifiedQty: 1, reason: "stock suficiente" })
    await bulkApproveItems([itemIds[2]!], APPROVER, { approverName: "Jefa Aprobadora" })
    expect(await noticesFor(requestId)).toHaveLength(0)

    await approveItem(itemIds[3]!, APPROVER, { approverName: "Jefa Aprobadora" })

    const notices = await noticesFor(requestId)
    expect(notices).toHaveLength(1)
    expect(notices[0]!.type).toBe("request_approved")
    expect(notices[0]!.body).toContain("Se aprobaron los 4 ítems (1 con cantidad modificada)")
  })

  it("incluye los rechazados con su motivo en el mismo aviso", async () => {
    const { requestId, itemIds } = await makeRequest(REQUESTER_A, 3)

    await rejectItem(itemIds[0]!, APPROVER, "Duplicado con SOL-0047", { approverName: "Jefa Aprobadora" })
    expect(await noticesFor(requestId)).toHaveLength(0)
    await bulkApproveItems(itemIds.slice(1), APPROVER, { approverName: "Jefa Aprobadora" })

    const notices = await noticesFor(requestId)
    expect(notices).toHaveLength(1)
    expect(notices[0]!.title).toMatch(/revisada$/)
    expect(notices[0]!.body).toContain("2 ítems aprobados")
    expect(notices[0]!.body).toContain("1 rechazado")
    expect(notices[0]!.body).toContain(`Ítem ${itemIds[0]} — Duplicado con SOL-0047`)
  })

  it("una solicitud rechazada completa avisa como rechazo", async () => {
    const { requestId, itemIds } = await makeRequest(REQUESTER_A, 1)

    await rejectItem(itemIds[0]!, APPROVER, "Sin presupuesto", { approverName: "Jefa Aprobadora" })

    const notices = await noticesFor(requestId)
    expect(notices).toHaveLength(1)
    expect(notices[0]!.type).toBe("request_rejected")
    expect(notices[0]!.title).toMatch(/rechazada$/)
    expect(notices[0]!.body).toContain("Sin presupuesto")
  })

  it("un rechazo posterior al cierre vuelve a avisar con el resumen actualizado", async () => {
    const { requestId, itemIds } = await makeRequest(REQUESTER_A, 2)
    await bulkApproveItems(itemIds, APPROVER, { approverName: "Jefa Aprobadora" })
    expect(await noticesFor(requestId)).toHaveLength(1)

    await rejectItem(itemIds[1]!, APPROVER, "Proveedor sin stock", { approverName: "Jefa Aprobadora" })

    const notices = await noticesFor(requestId)
    expect(notices).toHaveLength(2)
    expect(notices.some((n) => n.body?.includes("Proveedor sin stock"))).toBe(true)
  })
})
