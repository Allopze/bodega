import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq, and } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { seedTiBase, seedAssetType, plainDateIn } from "./helpers/ti-seeds"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

import { collectTiAlerts, runTiAlerts } from "@/lib/services/ti/alerts"
import { createTicket } from "@/lib/services/ti/tickets"
import { createNotification } from "@/lib/services/notification-create"
import { createAsset } from "@/lib/services/ti/assets"
import { createLicense } from "@/lib/services/ti/licenses"

describe("módulo TI — alertas cron", () => {
  const actor = { userId: "user-ti-tecnico", userEmail: "tecnico@ti.cl" }

  async function backdate(table: "assets" | "tickets", id: string, days: number) {
    const old = new Date(Date.now() - days * 86_400_000).toISOString()
    if (table === "assets") {
      await testDb.update(schema.itAssets).set({ updatedAt: old }).where(eq(schema.itAssets.id, id))
    } else {
      await testDb.update(schema.itTickets).set({ updatedAt: old }).where(eq(schema.itTickets.id, id))
    }
  }

  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    const seeds = await seedTiBase(testDb)
    const typeId = await seedAssetType(testDb)

    // Garantía que vence en 10 días → alerta.
    const warrantyAsset = await createAsset({
      code: "TI-AL-0001", assetTypeId: typeId, warrantyEndDate: plainDateIn(10),
    }, actor)
    expect(warrantyAsset).toBeTruthy()
    // Garantía lejana (120 días) → sin alerta.
    await createAsset({ code: "TI-AL-0002", assetTypeId: typeId, warrantyEndDate: plainDateIn(120) }, actor)

    // Licencia que renueva en 7 días → alerta.
    await createLicense({
      name: "Licencia Próxima", purchasedQuantity: 1, periodicity: "anual", renewalDate: plainDateIn(7),
    }, actor)
    // Licencia lejana → sin alerta.
    await createLicense({
      name: "Licencia Lejana", purchasedQuantity: 1, periodicity: "anual", renewalDate: plainDateIn(60),
    }, actor)

    // Activo atascado en reparación (updatedAt hace 40 días) → alerta.
    const stuckRepair = await createAsset({ code: "TI-AL-0003", assetTypeId: typeId }, actor)
    await testDb.update(schema.itAssets).set({ status: "en_reparacion" }).where(eq(schema.itAssets.id, stuckRepair))
    await backdate("assets", stuckRepair, 40)

    // Ticket abierto sin actualización (6 días) → alerta.
    const { id: staleTicket } = await createTicket({
      subject: "Ticket viejo",
      description: "Sin novedades",
      category: "software",
      priority: "normal",
      worksiteId: seeds.worksiteId,
    }, actor)
    await backdate("tickets", staleTicket, 6)

    // Ticket resuelto → nunca alerta.
    const { id: resolvedTicket } = await createTicket({
      subject: "Ticket resuelto",
      description: "Cerrado",
      category: "software",
      priority: "normal",
      worksiteId: seeds.worksiteId,
    }, actor)
    await backdate("tickets", resolvedTicket, 6)

    // Permiso ti:view para el usuario que recibe notificaciones. Se concede
    // POR ROL a propósito: así lo hace `modules/ti/manifest.ts` vía
    // `defaultGrants` → `role_permissions`. Otorgarlo con un grant directo en
    // `user_permissions` ejercitaba el único camino que no ocurre en
    // producción y ocultaba que el cron no encontraba destinatarios.
    await testDb.insert(schema.permissions).values({
      id: "p-ti-view-alertas",
      name: "ti:view",
      description: "Ver módulo TI",
      module: "ti",
    })
    await testDb.insert(schema.roles).values({
      id: "rol-ti-alertas",
      name: "tecnico_ti",
      label: "Técnico TI",
      isGlobal: true,
    })
    await testDb.insert(schema.rolePermissions).values({
      roleId: "rol-ti-alertas",
      permissionId: "p-ti-view-alertas",
    })
    await testDb.insert(schema.userRoles).values({
      userId: seeds.userId,
      roleId: "rol-ti-alertas",
    })
  })

  afterAll(async () => pg.close())

  it("colecta solo lo accionable dentro de cada ventana", async () => {
    const alerts = await collectTiAlerts()

    expect(alerts.some((a) => a.type === "ti_warranty_expiring" && a.title.includes("TI-AL-0001"))).toBe(true)
    expect(alerts.some((a) => a.title.includes("TI-AL-0002"))).toBe(false)

    expect(alerts.some((a) => a.type === "ti_license_renewal" && a.title.includes("Licencia Próxima"))).toBe(true)
    expect(alerts.some((a) => a.title.includes("Licencia Lejana"))).toBe(false)

    expect(alerts.some((a) => a.type === "ti_repair_stuck" && a.title.includes("TI-AL-0003"))).toBe(true)

    expect(alerts.some((a) => a.type === "ti_ticket_stale" && a.title.includes("INC-"))).toBe(true)
    expect(alerts.some((a) => a.type === "ti_ticket_stale" && a.title.includes("Ticket resuelto"))).toBe(false)
  })

  it("notifica a quien tiene ti:view y deduplica por dedupeKey en corridas repetidas", async () => {
    await testDb.delete(schema.notifications)

    const first = await runTiAlerts()
    expect(first.sent).toBeGreaterThan(0)

    const notifications = await testDb.select().from(schema.notifications)
    expect(notifications.length).toBeGreaterThan(0)
    expect(notifications.every((n) => n.userId === "user-ti-tecnico")).toBe(true)

    // Segunda corrida: el índice único (userId, dedupeKey) impide duplicados.
    await runTiAlerts()
    const after = await testDb.select().from(schema.notifications)
    expect(after.length).toBe(notifications.length)

    // Una dedupeKey con datos de entidad presentes en la alerta.
    const dedupes = after.map((n) => n.dedupeKey).filter(Boolean)
    expect(new Set(dedupes).size).toBe(dedupes.length)
  })

  it("deduplica el par (userId, dedupeKey) a nivel de BD y de servicio", async () => {
    await testDb.delete(schema.notifications)
    const base = {
      userId: "user-ti-tecnico",
      type: "ti_ticket_stale" as const,
      title: "Ticket viejo",
      body: "Sin novedades",
      entityType: "it_ticket",
      entityId: "ticket-cualquiera",
      entityHref: "/ti/tickets/ticket-cualquiera",
      dedupeKey: "ti:ticket:ticket-cualquiera",
    }

    // El índice único parcial rechaza la inserción cruda duplicada.
    await testDb.insert(schema.notifications).values({ id: "ntf-ti-1", ...base })
    await expect(testDb.insert(schema.notifications).values({ id: "ntf-ti-2", ...base })).rejects.toThrow()

    // El servicio, en cambio, deduplica por select-first: no lanza y no inserta.
    await createNotification(base)
    await createNotification(base)

    const rows = await testDb.select().from(schema.notifications)
      .where(and(eq(schema.notifications.userId, "user-ti-tecnico"), eq(schema.notifications.dedupeKey, "ti:ticket:ticket-cualquiera")))
    expect(rows).toHaveLength(1)
  })

  /* ── TIT-001 · SLA por prioridad ────────────────────────────────────────── */

  describe("SLA del ticket según su prioridad (TIT-001)", () => {
    /*
     * Antes de este arreglo la prioridad de un ticket no gobernaba ningún
     * plazo: la única señal temporal era la alerta plana de "sin actualización
     * en más de 5 días", igual para un `critica` que para un `baja`, y esa
     * consulta además incluía los estados de espera, de modo que un ticket
     * detenido esperando respuesta ajena se reportaba como abandonado.
     */
    async function ticketConVencimiento(
      subject: string, priority: string, dueInHours: number, status?: string,
    ) {
      const { id } = await createTicket({
        subject, description: "SLA", category: "software", priority,
        worksiteId: "ws-ti-norte",
      }, actor)
      const dueAt = new Date(Date.now() + dueInHours * 3_600_000).toISOString()
      await testDb.update(schema.itTickets)
        .set(status ? { dueAt, status } : { dueAt })
        .where(eq(schema.itTickets.id, id))
      return id
    }

    it("le pone plazo al ticket al crearlo, y el plazo depende de la prioridad", async () => {
      const { id: critico } = await createTicket({
        subject: "Correo caído", description: "Nadie recibe correo", category: "correo",
        priority: "critica", worksiteId: "ws-ti-norte",
      }, actor)
      const { id: bajo } = await createTicket({
        subject: "Cambiar fondo de pantalla", description: "Cosmético", category: "otro",
        priority: "baja", worksiteId: "ws-ti-norte",
      }, actor)

      const [filaCritica] = await testDb.select().from(schema.itTickets).where(eq(schema.itTickets.id, critico))
      const [filaBaja] = await testDb.select().from(schema.itTickets).where(eq(schema.itTickets.id, bajo))
      expect(filaCritica?.dueAt).toBeTruthy()
      expect(filaBaja?.dueAt).toBeTruthy()

      const horas = (fila: typeof filaCritica) =>
        (new Date(fila!.dueAt!).getTime() - new Date(fila!.createdAt).getTime()) / 3_600_000
      expect(Math.round(horas(filaCritica))).toBe(24)
      expect(Math.round(horas(filaBaja))).toBe(240)
    })

    it("avisa por tramo: vencido y por vencer, y no antes", async () => {
      const vencido = await ticketConVencimiento("SLA vencido", "critica", -3)
      const porVencer = await ticketConVencimiento("SLA por vencer", "alta", 6)
      const holgado = await ticketConVencimiento("SLA holgado", "baja", 200)

      const alerts = await collectTiAlerts()
      const porId = (id: string) => alerts.filter((a) => a.entityId === id).map((a) => a.type)

      expect(porId(vencido)).toContain("ti_ticket_sla_overdue")
      expect(porId(porVencer)).toContain("ti_ticket_sla_due_soon")
      expect(porId(holgado)).not.toContain("ti_ticket_sla_due_soon")
      expect(porId(holgado)).not.toContain("ti_ticket_sla_overdue")
    })

    it("no reporta como abandonado un ticket detenido esperando respuesta ajena", async () => {
      const esperando = await ticketConVencimiento("Esperando al proveedor", "normal", 200, "esperando_proveedor")
      await backdate("tickets", esperando, 9)

      const alerts = await collectTiAlerts()
      expect(alerts.filter((a) => a.entityId === esperando).map((a) => a.type))
        .not.toContain("ti_ticket_stale")
    })
  })
})
