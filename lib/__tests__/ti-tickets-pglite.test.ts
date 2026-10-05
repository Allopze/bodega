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
  createTicket, transitionTicket, assignTicket, addTicketComment,
  listTickets, countTickets, countTicketsByStatus, getTicketById, getTicketComments, getTicketTimeline, isTicketOpen,
} from "@/lib/services/ti/tickets"
import { eq } from "drizzle-orm"
import { createAsset } from "@/lib/services/ti/assets"
import { IT_TICKET_UNASSIGN } from "@/lib/validation/ti"

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
    const { id } = await createTicket({
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
    const { id } = await createTicket({
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

  /**
   * TIT-002 (auditoría 2026-09-14), patrón P6: un ticket podía resolverse y
   * cerrarse sin una palabra sobre qué se hizo, y ahí es donde el historial de
   * soporte pierde el dato más útil para el siguiente incidente idéntico.
   */
  describe("TIT-002 — la solución es obligatoria al cerrar", () => {
    async function ticketEnProgreso(subject: string) {
      const { id } = await createTicket({
        subject, description: "Detalle", category: "impresoras",
        priority: "normal", worksiteId: "ws-ti-norte",
      }, actor)
      await transitionTicket({ ticketId: id, status: "en_diagnostico", reason: "Revisión" }, actor)
      return id
    }

    it("no se resuelve sin decir cómo", async () => {
      const id = await ticketEnProgreso("Sin solución")
      await expect(transitionTicket({ ticketId: id, status: "resuelto", reason: "Listo" }, actor))
        .rejects.toThrow(/cómo se resolvió/i)
      // Y una palabra suelta tampoco basta: es el mismo umbral que el resto.
      await expect(transitionTicket({ ticketId: id, status: "resuelto", reason: "x", resolution: "ok" }, actor))
        .rejects.toThrow(/cómo se resolvió/i)
    })

    it("se resuelve con una solución de verdad, y queda guardada", async () => {
      const id = await ticketEnProgreso("Con solución")
      await transitionTicket({
        ticketId: id, status: "resuelto", reason: "Reparado",
        resolution: "Se cambió el cable de red del puesto 12",
      }, actor)
      expect((await getTicketById(id))?.resolution).toBe("Se cambió el cable de red del puesto 12")
    })

    it("cerrar después de resolver no obliga a repetir la solución", async () => {
      const id = await ticketEnProgreso("Cierre normal")
      await transitionTicket({
        ticketId: id, status: "resuelto", reason: "Reparado",
        resolution: "Se reinstaló el controlador de impresión",
      }, actor)
      await transitionTicket({ ticketId: id, status: "cerrado", reason: "Confirmado por el usuario" }, actor)

      const cerrado = await getTicketById(id)
      expect(cerrado?.status).toBe("cerrado")
      // La solución sobrevive al cierre: antes el cierre la dejaba intacta sólo
      // por casualidad, porque no tocaba la columna.
      expect(cerrado?.resolution).toBe("Se reinstaló el controlador de impresión")
    })
  })

  it("permite reabrir un ticket resuelto y bloquea transiciones inválidas", async () => {
    const { id } = await createTicket({
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
    await transitionTicket({ ticketId: id, status: "resuelto", reason: "Cambio de tóner", resolution: "Se reemplazó el tóner y se limpió el rodillo" }, actor)
    await transitionTicket({ ticketId: id, status: "en_progreso", reason: "Volvió a fallar" }, actor)
    const reopened = await getTicketById(id)
    expect(reopened?.status).toBe("en_progreso")
    expect(reopened?.resolvedAt).toBeNull()
    expect(reopened?.resolution).toBeNull()
  })

  it("separa comentarios internos de los visibles al autor", async () => {
    const { id } = await createTicket({
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

  it("asigna, reasigna y desasigna el técnico responsable", async () => {
    const { id } = await createTicket({
      subject: "Impresora atascada en recepción",
      description: "No toma papel desde la mañana",
      category: "impresoras",
      priority: "normal",
      worksiteId: "ws-ti-norte",
    }, actor)

    const firstAssign = await transitionTicket({ ticketId: id, status: "asignado", reason: "Lo toma soporte", assigneeUserId: actor.userId }, actor)
    expect((await getTicketById(id))?.assigneeUserId).toBe(actor.userId)
    // El payload de retorno es lo que consume la action para notificar: debe
    // reflejar el cambio real de asignado, no solo el estado final en BD.
    expect(firstAssign.previousAssigneeUserId).toBeNull()
    expect(firstAssign.assigneeUserId).toBe(actor.userId)
    expect(firstAssign.assigneeChanged).toBe(true)
    expect(firstAssign.fromStatus).toBe("nuevo")
    expect(firstAssign.toStatus).toBe("asignado")

    // Reasignación explícita a otro técnico.
    const reassign = await transitionTicket({ ticketId: id, status: "en_progreso", reason: "Cambio de responsable", assigneeUserId: "user-ti-gestor" }, actor)
    expect((await getTicketById(id))?.assigneeUserId).toBe("user-ti-gestor")
    expect(reassign.previousAssigneeUserId).toBe(actor.userId)
    expect(reassign.assigneeUserId).toBe("user-ti-gestor")
    expect(reassign.assigneeChanged).toBe(true)

    // Sin el campo, el asignado se conserva: `assigneeChanged` debe ser
    // false, es la condición que evita notificar en cada cambio de estado.
    const noChange = await transitionTicket({ ticketId: id, status: "esperando_proveedor", reason: "Espera repuesto" }, actor)
    expect((await getTicketById(id))?.assigneeUserId).toBe("user-ti-gestor")
    expect(noChange.assigneeChanged).toBe(false)
    expect(noChange.assigneeUserId).toBe("user-ti-gestor")

    // El centinela desasigna.
    const unassign = await transitionTicket({ ticketId: id, status: "en_progreso", reason: "Queda sin dueño", assigneeUserId: IT_TICKET_UNASSIGN }, actor)
    expect((await getTicketById(id))?.assigneeUserId).toBeNull()
    expect(unassign.previousAssigneeUserId).toBe("user-ti-gestor")
    expect(unassign.assigneeUserId).toBeNull()
    expect(unassign.assigneeChanged).toBe(true)
  })

  it("rechaza dejar un ticket en 'asignado' sin técnico y rechaza técnicos inexistentes", async () => {
    const { id } = await createTicket({
      subject: "Teclado con teclas pegadas",
      description: "Varias teclas no responden al escribir",
      category: "hardware",
      priority: "baja",
      worksiteId: "ws-ti-norte",
    }, actor)

    await expect(transitionTicket({ ticketId: id, status: "asignado", reason: "Sin dueño" }, actor))
      .rejects.toThrow(/técnico responsable/i)
    await expect(transitionTicket({ ticketId: id, status: "asignado", reason: "Fantasma", assigneeUserId: "user-inexistente" }, actor))
      .rejects.toThrow(/no existe/i)
    expect((await getTicketById(id))?.status).toBe("nuevo")
  })

  it("countTicketsByStatus ignora el filtro de estado y respeta el resto", async () => {
    const counts = await countTicketsByStatus({})
    // Hay tickets en más de un estado por las pruebas anteriores: el conteo
    // total no puede depender de qué estado esté filtrado en la vista.
    expect(Object.keys(counts).length).toBeGreaterThan(1)

    const nuevos = await listTickets({ status: "nuevo" })
    expect(counts.nuevo).toBe(nuevos.length)

    // Con un filtro de prioridad, el conteo se acota a esa prioridad.
    const criticas = await countTicketsByStatus({ priority: "critica" })
    const totalCriticas = Object.values(criticas).reduce((sum, n) => sum + n, 0)
    expect(totalCriticas).toBe((await listTickets({ priority: "critica" })).length)
  })
  /**
   * TIUX-04 / 17 / 16 / 40 / 52 (auditoría UI/UX de TI, 2026-10-05).
   * Todo en la faena sur: ningún otro bloque crea tickets ahí, así que los
   * conteos y el orden no dependen de lo que hicieron las pruebas anteriores.
   */
  describe("mesa de ayuda — cierre, responsable, línea de tiempo y lista paginada", () => {
    const sur = (subject: string, priority = "normal") => createTicket({
      subject, description: "Descripción suficientemente larga", category: "otro", priority, worksiteId: "ws-ti-sur",
    }, actor)

    it("TIUX-04: un cierre directo exige solución y deja la fecha de término", async () => {
      const { id } = await sur("Cierre directo")
      await expect(transitionTicket({ ticketId: id, status: "cerrado", reason: "Sin respuesta" }, actor))
        .rejects.toThrow(/cómo se resolvió/i)
      // Una solución corta tampoco vale: es el mismo mínimo que el formulario.
      await expect(transitionTicket({ ticketId: id, status: "cerrado", reason: "Sin respuesta", resolution: "Nada" }, actor))
        .rejects.toThrow(/al menos 10 caracteres/i)

      await transitionTicket({ ticketId: id, status: "cerrado", reason: "Sin respuesta", resolution: "Se descartó: el usuario no respondió" }, actor)
      const cerrado = await getTicketById(id)
      expect(cerrado?.status).toBe("cerrado")
      expect(cerrado?.resolution).toBe("Se descartó: el usuario no respondió")
      // Sin esta fecha la ficha no puede decir si se cumplió el plazo.
      expect(cerrado?.resolvedAt).toBeTruthy()
    })

    it("TIUX-17: asignar mueve «nuevo» a «asignado», y quitar el responsable lo devuelve a «nuevo»", async () => {
      const { id } = await sur("Asignación simple")
      const assigned = await assignTicket({ ticketId: id, assigneeUserId: actor.userId }, actor)
      expect(assigned).toMatchObject({ fromStatus: "nuevo", toStatus: "asignado", statusChanged: true, assigneeChanged: true, assigneeUserId: actor.userId })
      expect((await getTicketById(id))?.status).toBe("asignado")

      await expect(assignTicket({ ticketId: id, assigneeUserId: actor.userId }, actor)).rejects.toThrow(/ya está asignado/i)
      // Quitarlo a quien ya lo tiene exige motivo.
      await expect(assignTicket({ ticketId: id, assigneeUserId: IT_TICKET_UNASSIGN }, actor)).rejects.toThrow(/motivo del cambio/i)
      const cleared = await assignTicket({ ticketId: id, assigneeUserId: IT_TICKET_UNASSIGN, reason: "Vuelve a la cola" }, actor)
      expect(cleared).toMatchObject({ fromStatus: "asignado", toStatus: "nuevo", assigneeUserId: null })
      expect((await getTicketById(id))?.assigneeUserId).toBeNull()
    })

    it("TIUX-17: reasignar exige motivo, no toca el estado de trabajo y rechaza técnicos inexistentes, inactivos o tickets cerrados", async () => {
      const { id } = await sur("Reasignación")
      await assignTicket({ ticketId: id, assigneeUserId: actor.userId }, actor)
      await transitionTicket({ ticketId: id, status: "en_progreso", reason: "Trabajando" }, actor)

      await expect(assignTicket({ ticketId: id, assigneeUserId: "user-ti-gestor" }, actor)).rejects.toThrow(/motivo del cambio/i)
      const result = await assignTicket({ ticketId: id, assigneeUserId: "user-ti-gestor", reason: "Pasa a otro turno" }, actor)
      expect(result).toMatchObject({ fromStatus: "en_progreso", toStatus: "en_progreso", statusChanged: false, assigneeChanged: true, previousAssigneeUserId: actor.userId })

      await expect(assignTicket({ ticketId: id, assigneeUserId: "user-fantasma", reason: "Motivo válido" }, actor)).rejects.toThrow(/no existe/i)
      await testDb.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, "user-ti-gestor"))
      await expect(assignTicket({ ticketId: id, assigneeUserId: "user-ti-gestor", reason: "Motivo válido" }, actor)).rejects.toThrow(/inactivo/i)
      await testDb.update(schema.users).set({ isActive: true }).where(eq(schema.users.id, "user-ti-gestor"))

      await transitionTicket({ ticketId: id, status: "resuelto", reason: "Listo", resolution: "Se reinstaló el controlador" }, actor)
      await expect(assignTicket({ ticketId: id, assigneeUserId: actor.userId, reason: "Motivo válido" }, actor)).rejects.toThrow(/Reabre el ticket/)
    })

    it("respeta el alcance de faena al asignar", async () => {
      const { id } = await sur("Fuera de alcance")
      await expect(assignTicket({ ticketId: id, assigneeUserId: actor.userId }, actor, ["ws-ti-norte"]))
        .rejects.toThrow(/No tienes acceso a esta faena/)
    })

    it("TIUX-40: la línea de tiempo junta comentarios, estados y asignaciones, y oculta a quien no gestiona las notas y los motivos", async () => {
      const { id } = await sur("Línea de tiempo")
      await assignTicket({ ticketId: id, assigneeUserId: actor.userId }, actor)
      await addTicketComment({ ticketId: id, body: "Comentario público", isInternal: false }, actor)
      await addTicketComment({ ticketId: id, body: "Nota para TI", isInternal: true }, actor)
      await transitionTicket({ ticketId: id, status: "esperando_usuario", reason: "Falta el número de serie" }, actor)

      const full = await getTicketTimeline(id, true)
      expect(full.map((i) => i.kind)).toEqual(["status", "comment", "comment", "status"])
      // La asignación hecha con el cambio de estado se funde en esa línea.
      const first = full[0]
      expect(first?.kind === "status" && first.assignment?.assigneeName).toBe("Técnico TI")
      expect(first?.kind === "status" && first.reason).toBe("Ticket asignado")
      expect(first?.kind === "status" && [first.from, first.to]).toEqual(["nuevo", "asignado"])
      const last = full[3]
      expect(last?.kind === "status" && last.reason).toBe("Falta el número de serie")
      expect(last?.kind === "status" && last.authorName).toBe("Técnico TI")

      const requesterView = await getTicketTimeline(id, false)
      expect(requesterView.map((i) => i.kind)).toEqual(["status", "comment", "status"])
      expect(requesterView.some((i) => i.kind === "comment" && i.isInternal)).toBe(false)
      // El motivo sí lo ve: le dice por qué está esperando. Lo reservado va en
      // una nota interna, que sigue fuera de su vista.
      const waiting = requesterView.at(-1)
      expect(waiting?.kind === "status" && waiting.reason).toBe("Falta el número de serie")
    })

    it("una reasignación sin cambio de estado aparece como línea propia", async () => {
      const { id } = await sur("Línea de reasignación")
      await assignTicket({ ticketId: id, assigneeUserId: actor.userId }, actor)
      await transitionTicket({ ticketId: id, status: "en_progreso", reason: "Trabajando" }, actor)
      await assignTicket({ ticketId: id, assigneeUserId: "user-ti-gestor", reason: "Cambio de turno" }, actor)

      const items = await getTicketTimeline(id, true)
      const last = items.at(-1)
      expect(last).toMatchObject({ kind: "assignment", assigneeName: "Gestor TI", reason: "Cambio de turno" })
    })

    it("TIUX-31: addTicketComment devuelve lo necesario para avisar al solicitante", async () => {
      const { id, code } = await sur("Aviso de comentario")
      const comment = await addTicketComment({ ticketId: id, body: "Hola", isInternal: false }, actor)
      expect(comment).toMatchObject({ ticketId: id, code, subject: "Aviso de comentario", requesterUserId: actor.userId })
      expect(comment.id).toBeTruthy()
    })

    it("TIUX-52: filtra por responsable y vencimiento, ordena por urgencia y pagina en el servidor", async () => {
      // Se parte de una faena sin tickets propios ordenados: se crean aquí.
      const base = { worksiteId: "ws-ti-sur" }
      const horas = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()
      const mk = async (subject: string, priority: string, dueInHours: number | null) => {
        const { id } = await createTicket({ subject, description: "Descripción suficientemente larga", category: "otro", priority, ...base }, actor)
        await testDb.update(schema.itTickets).set({ dueAt: dueInHours === null ? null : horas(dueInHours) }).where(eq(schema.itTickets.id, id))
        return id
      }
      // Un universo conocido: se aíslan por un texto único de búsqueda.
      const tag = "ZZORD"
      const lejanoBaja = await mk(`${tag} lejano baja`, "baja", 200)
      const vencidoNormal = await mk(`${tag} vencido normal`, "normal", -5)
      const vencidoCritico = await mk(`${tag} vencido critico`, "critica", -2)
      const porVencer = await mk(`${tag} por vencer`, "alta", 10)
      const resuelto = await mk(`${tag} resuelto`, "critica", -30)
      await transitionTicket({ ticketId: resuelto, status: "resuelto", reason: "Listo", resolution: "Se reinició el servicio" }, actor)
      await assignTicket({ ticketId: porVencer, assigneeUserId: actor.userId }, actor)

      const filters = { ...base, search: tag }
      const urgencia = await listTickets(filters)
      // Abiertos primero; vencidos antes que por vencer; dentro, por prioridad.
      expect(urgencia.map((t) => t.id)).toEqual([vencidoCritico, vencidoNormal, porVencer, lejanoBaja, resuelto])

      const porPrioridad = await listTickets(filters, undefined, "prioridad")
      expect(porPrioridad.map((t) => t.id).slice(0, 4)).toEqual([vencidoCritico, porVencer, vencidoNormal, lejanoBaja])
      const porVence = await listTickets(filters, undefined, "vence")
      // Por fecha: el que lleva más tiempo atrasado va primero, sin mirar la prioridad.
      expect(porVence.map((t) => t.id).slice(0, 4)).toEqual([vencidoNormal, vencidoCritico, porVencer, lejanoBaja])

      expect((await listTickets({ ...filters, due: "vencido" })).map((t) => t.id).sort())
        .toEqual([vencidoCritico, vencidoNormal].sort())
      expect((await listTickets({ ...filters, due: "por_vencer" })).map((t) => t.id)).toEqual([porVencer])
      // Un resuelto nunca cuenta como vencido, aunque su plazo ya pasó.
      expect((await listTickets({ ...filters, due: "vencido" })).some((t) => t.id === resuelto)).toBe(false)

      expect((await listTickets({ ...filters, unassigned: true })).some((t) => t.id === porVencer)).toBe(false)
      expect((await listTickets({ ...filters, assigneeUserId: actor.userId })).map((t) => t.id)).toEqual([porVencer])

      // Paginación: el total no depende del tamaño de página y las páginas no se solapan.
      expect(await countTickets(filters)).toBe(5)
      const p1 = await listTickets(filters, { limit: 2, offset: 0 })
      const p2 = await listTickets(filters, { limit: 2, offset: 2 })
      const p3 = await listTickets(filters, { limit: 2, offset: 4 })
      expect([...p1, ...p2, ...p3].map((t) => t.id)).toEqual(urgencia.map((t) => t.id))

      // Los contadores de las pastillas respetan la búsqueda y los demás filtros.
      const counts = await countTicketsByStatus({ ...filters, due: "vencido" })
      expect(counts).toEqual({ nuevo: 2 })
    })

    it("TIUX-52: la búsqueda del servidor cubre trabajador, faena, equipo y personas", async () => {
      const { id } = await createTicket({
        subject: "Búsqueda amplia", description: "Descripción suficientemente larga", category: "otro", priority: "normal",
        workerId: "wk-ti-maria", worksiteId: "ws-ti-sur",
      }, actor)
      await assignTicket({ ticketId: id, assigneeUserId: "user-ti-gestor" }, actor)
      for (const term of ["gómez", "faena sur", "gestor ti"]) {
        const found = await listTickets({ search: term })
        expect(found.some((t) => t.id === id), term).toBe(true)
      }
      expect((await listTickets({ search: "no-existe-este-texto" }))).toHaveLength(0)
    })
  })
})
