import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { seedTiBase, seedAssetType } from "./helpers/ti-seeds"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

import {
  createTicket, transitionTicket, addTicketComment,
  listTickets, getTicketById, getTicketComments, isTicketOpen,
} from "@/lib/services/ti/tickets"
import { createAsset } from "@/lib/services/ti/assets"

describe("módulo TI — tickets (mesa de ayuda)", () => {
  let assetId: string
  const actor = { userId: "user-ti-tecnico", userEmail: "tecnico@ti.cl" }
  const fieldActor = { userId: "user-ti-gestor", userEmail: "gestor@ti.cl" }

  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    const seeds = await seedTiBase(testDb)
    const typeId = await seedAssetType(testDb)
    assetId = await createAsset({ code: "TI-NB-0100", assetTypeId: typeId, worksiteId: seeds.worksiteId }, actor)
  })

  afterAll(async () => pg.close())

  it("crea un ticket con correlativo INC y estado 'nuevo'", async () => {
    const id = await createTicket({
      subject: "No enciende el notebook",
      description: "Pantalla negra al iniciar",
      category: "hardware",
      priority: "alta",
      workerId: "wk-ti-juan",
      worksiteId: "ws-ti-norte",
      assetId,
    }, actor)

    const ticket = await getTicketById(id)
    expect(ticket?.code).toMatch(/^INC-\d{4}-\d{4}$/)
    expect(ticket?.status).toBe("nuevo")
    expect(ticket?.workerName).toBe("Juan Pérez")
    expect(ticket?.assetCode).toBe("TI-NB-0100")
  })

  it("rechaza el ticket en una faena fuera de scope", async () => {
    await expect(createTicket({
      subject: "Sin acceso",
      description: "Problema",
      category: "accesos",
      priority: "normal",
      worksiteId: "ws-ti-sur",
    }, fieldActor, ["ws-ti-norte"])).rejects.toThrow(/No tienes acceso a esta faena/)
  })

  it("rechaza un trabajador inexistente o un activo dado de baja", async () => {
    await expect(createTicket({
      subject: "T",
      description: "D",
      category: "hardware",
      priority: "normal",
      workerId: "wk-inexistente",
      worksiteId: "ws-ti-norte",
    }, actor)).rejects.toThrow(/Trabajador no encontrado/)

    await expect(createTicket({
      subject: "T",
      description: "D",
      category: "hardware",
      priority: "normal",
      worksiteId: "ws-ti-norte",
      assetId: "as-inexistente",
    }, actor)).rejects.toThrow(/Activo no encontrado/)
  })

  it("no mezcla en un ticket la faena con un trabajador o activo de otra faena", async () => {
    await expect(createTicket({
      subject: "Acceso del trabajador equivocado",
      description: "La persona afectada pertenece a otra faena.",
      category: "accesos",
      priority: "normal",
      workerId: "wk-ti-maria",
      worksiteId: "ws-ti-norte",
    }, actor)).rejects.toThrow(/trabajador.*faena/i)

    const southAssetId = await createAsset({
      code: "TI-NB-SUR-0100",
      assetTypeId: "type-ti-notebook",
      worksiteId: "ws-ti-sur",
    }, actor)
    await expect(createTicket({
      subject: "Activo de otra faena",
      description: "El activo referenciado pertenece a una faena distinta.",
      category: "hardware",
      priority: "normal",
      worksiteId: "ws-ti-norte",
      assetId: southAssetId,
    }, actor)).rejects.toThrow(/activo.*faena/i)
  })

  it("transiciona estados válidos y deja resolución al resolver", async () => {
    const id = await createTicket({
      subject: "Correo no llega",
      description: "Bandeja vacía",
      category: "correo",
      priority: "critica",
      worksiteId: "ws-ti-norte",
    }, actor)

    await transitionTicket({ ticketId: id, status: "asignado", reason: "Lo toma soporte", assigneeUserId: actor.userId }, actor)
    await transitionTicket({ ticketId: id, status: "en_progreso", reason: "Diagnóstico" }, actor)
    await transitionTicket({ ticketId: id, status: "resuelto", reason: "Listo", resolution: "Se reconfiguró Outlook" }, actor)

    const ticket = await getTicketById(id)
    expect(ticket?.status).toBe("resuelto")
    expect(ticket?.resolution).toBe("Se reconfiguró Outlook")
    expect(ticket?.resolvedAt).toBeTruthy()
    expect(ticket?.assigneeName).toBe("Técnico TI")
  })

  it("permite reabrir un ticket resuelto y bloquea transiciones inválidas", async () => {
    const id = await createTicket({
      subject: "Impresora",
      description: "No imprime",
      category: "impresoras",
      priority: "normal",
      worksiteId: "ws-ti-norte",
    }, actor)

    // Desde 'nuevo' no se puede saltar a esperando_proveedor (hay que pasar
    // por en_diagnostico/en_progreso).
    await expect(transitionTicket({ ticketId: id, status: "esperando_proveedor", reason: "Repuesto" }, actor))
      .rejects.toThrow(/No se puede pasar de 'nuevo' a 'esperando_proveedor'/)

    await transitionTicket({ ticketId: id, status: "en_diagnostico", reason: "Revisión" }, actor)
    await transitionTicket({ ticketId: id, status: "resuelto", reason: "Cambio de tóner", resolution: "Listo" }, actor)
    await transitionTicket({ ticketId: id, status: "en_progreso", reason: "Volvió a fallar" }, actor)
    const reopened = await getTicketById(id)
    expect(reopened?.status).toBe("en_progreso")
    expect(reopened?.resolvedAt).toBeNull()
    expect(reopened?.resolution).toBeNull()
  })

  it("separa comentarios internos de los visibles al autor", async () => {
    const id = await createTicket({
      subject: "VPN",
      description: "No conecta",
      category: "accesos",
      priority: "alta",
      worksiteId: "ws-ti-norte",
    }, fieldActor)

    await addTicketComment({ ticketId: id, body: "¿Reiniciaste el router?", isInternal: false }, actor)
    await addTicketComment({ ticketId: id, body: "Cliente interno sospechoso", isInternal: true }, actor)

    const visible = await getTicketComments(id, false)
    expect(visible).toHaveLength(1)
    expect(visible[0]?.body).toBe("¿Reiniciaste el router?")
    expect(visible[0]?.isInternal).toBe(false)

    const full = await getTicketComments(id, true)
    expect(full).toHaveLength(2)
  })

  it("lista con filtros de estado, prioridad y búsqueda de texto", async () => {
    await createTicket({
      subject: "Mouse sin funcionar",
      description: "Clic no responde",
      category: "hardware",
      priority: "baja",
      worksiteId: "ws-ti-norte",
    }, actor)

    const porEstado = await listTickets({ status: "nuevo" })
    expect(porEstado.some((t) => t.subject === "Mouse sin funcionar")).toBe(true)

    const porBusqueda = await listTickets({ search: "mouse" })
    expect(porBusqueda.length).toBeGreaterThan(0)

    const porPrioridad = await listTickets({ priority: "critica" })
    expect(porPrioridad.every((t) => t.priority === "critica")).toBe(true)
  })

  it("isTicketOpen distingue abiertos de resueltos/cerrados", () => {
    expect(isTicketOpen("nuevo")).toBe(true)
    expect(isTicketOpen("en_progreso")).toBe(true)
    expect(isTicketOpen("resuelto")).toBe(false)
    expect(isTicketOpen("cerrado")).toBe(false)
  })
})
