/**
 * El scope de la bandeja de Compras (`comprasInboxSql`).
 *
 * Dos reglas que ya se rompieron una vez cada una:
 *
 * 1. Una OC eliminada no se muestra. `deleteOrder` es un soft delete que muta el
 *    código a `OC-…-DELETED-<id>` para liberar el UNIQUE, así que cuando se
 *    escapa no se escapa discretamente: ese código interno aparece en pantalla,
 *    suma en "Todas" y llena la tab "Anuladas" desplazando a las anuladas de
 *    verdad. DAT-16 le puso este mismo corte al export de gasto por faena; el
 *    listado se había quedado sin él. El test es el que evita la tercera vez.
 * 2. Una OC con recepción activa no aparece en Compras: su trabajo pertenece
 *    exclusivamente a /recepcion. Bajo el filtro de factura pendiente sólo
 *    una OC cuya recepción ya terminó puede volver por trabajo de facturación.
 *
 * Se ejecuta contra PGlite y no con aserciones sobre el SQL generado: lo que
 * importa es qué filas vuelven.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { comprasInboxSql } from "@/app/(app)/compras/list-scope"
import * as schema from "@/db/schema"

const pg = new PGlite()
const db = drizzle(pg, { schema })

const now = "2026-08-10T12:00:00.000Z"

async function order(id: string, code: string, status: string, deletedAt: string | null = null) {
  await db.insert(schema.purchaseOrders).values({
    id, code, worksiteId: "ws-inbox", supplierId: "sup-inbox", createdBy: "user-inbox",
    status, netAmount: 100, taxAmount: 19, totalAmount: 119,
    createdAt: now, updatedAt: now, deletedAt,
  })
}

/** Los códigos que la bandeja entregaría con este scope, ordenados. */
async function inboxCodes(opts: { invoicePendingOnly: boolean }) {
  const rows = await db
    .select({ code: schema.purchaseOrders.code })
    .from(schema.purchaseOrders)
    .where(comprasInboxSql(opts))
  return rows.map((row) => row.code).sort()
}

describe("scope de la bandeja de Compras", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await db.insert(schema.worksites).values({
      id: "ws-inbox", name: "Faena bandeja", code: "FB-01", isActive: true, createdAt: now, updatedAt: now,
    })
    await db.insert(schema.suppliers).values({
      id: "sup-inbox", name: "Proveedor bandeja", createdAt: now, updatedAt: now,
    })
    await db.insert(schema.users).values({
      id: "user-inbox", name: "Compradora", email: "compradora@bandeja.test",
      hashedPassword: "hash", createdAt: now, updatedAt: now,
    })

    await order("oc-borrador", "OC-INBOX-0001", "draft")
    await order("oc-enviada",  "OC-INBOX-0002", "sent")
    await order("oc-parcial-oficina", "OC-INBOX-0003", "partially_office_received")
    await order("oc-oficina", "OC-INBOX-0004", "office_received")
    await order("oc-parcial-faena", "OC-INBOX-0005", "partially_received")
    // Anulada de verdad: `cancelOrder` conserva el código y no marca deletedAt.
    await order("oc-anulada",  "OC-INBOX-0006", "cancelled")
    // Eliminada: `deleteOrder` deja el mismo status con el código mutado.
    await order("oc-eliminada", "OC-INBOX-0007-DELETED-tXQzMnLA", "cancelled", now)
    await order("oc-recibida", "OC-INBOX-0008", "received")
    await order("oc-cerrada",  "OC-INBOX-0009", "closed")
  })

  afterAll(async () => {
    await pg.close()
  })

  it("entrega sólo el trabajo de abastecimiento y deja toda recepción fuera", async () => {
    expect(await inboxCodes({ invoicePendingOnly: false })).toEqual([
      "OC-INBOX-0001", "OC-INBOX-0006",
    ])
  })

  it("no entrega la OC eliminada, ni su código mutado, en ninguno de los dos modos", async () => {
    const both = [
      ...await inboxCodes({ invoicePendingOnly: false }),
      ...await inboxCodes({ invoicePendingOnly: true }),
    ]
    expect(both.some((code) => code.includes("DELETED"))).toBe(false)
  })

  it("conserva la anulada de verdad, que es la que la tab «Anuladas» debe contar", async () => {
    expect(await inboxCodes({ invoicePendingOnly: false })).toContain("OC-INBOX-0006")
  })

  it("bajo el filtro de factura pendiente admite la OC ya recibida, no la recepción activa ni la cerrada", async () => {
    expect(await inboxCodes({ invoicePendingOnly: true })).toEqual(["OC-INBOX-0008"])
  })
})
