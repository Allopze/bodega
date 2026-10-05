/**
 * TIT-001 (auditoría 2026-09-14) — el plazo que la prioridad de un ticket TI
 * no gobernaba.
 *
 * Antes, un ticket declaraba prioridad (`baja | normal | alta | critica`) y esa
 * columna no cambiaba absolutamente nada: no había vencimiento, no había
 * cálculo de SLA y la única señal temporal era una alerta plana —«sin
 * actualización en más de 5 días»— que consultaba los tickets abiertos **sin
 * mirar la prioridad**. Un ticket `critica` y uno `baja` se avisaban igual, al
 * mismo quinto día.
 *
 * ── De dónde salen estas horas ──────────────────────────────────────────────
 * No hay una política de SLA de TI escrita en ninguna parte del repositorio ni
 * declarada por el negocio. La **única** tabla de plazos por prioridad que la
 * plataforma ya aplica es la del módulo de Soporte / feedback general
 * (`computeDueAt` en `lib/services/feedback.ts`): 24 h crítica, 48 h alta,
 * 5 días normal, 10 días baja. Se reutiliza tal cual —mismas cuatro
 * prioridades, mismo significado— en vez de inventar una segunda escala que
 * nadie podría explicar.
 *
 * Es, por lo tanto, un **valor por defecto pendiente de confirmación** por
 * quien define el servicio de TI. Está aquí, con nombre y en un solo lugar,
 * precisamente para que cambiarlo sea una línea y no una cacería. No se llevó a
 * `system_settings` porque los ajustes operativos de ese módulo son números
 * sueltos (`OPS_SETTING_KEYS`), no un mapa de cuatro valores, y montar la
 * pantalla de administración para esto excedía el hallazgo.
 */

export type TiTicketPriority = "baja" | "normal" | "alta" | "critica"

/** Horas de compromiso por prioridad. Ver la nota de arriba sobre su origen. */
export const TICKET_SLA_HOURS: Record<TiTicketPriority, number> = {
  critica: 24,
  alta: 48,
  normal: 5 * 24,
  baja: 10 * 24,
}

/** Cuánto antes del vencimiento se avisa «por vencer». Igual que en Soporte. */
export const TICKET_SLA_WARNING_HOURS = 24

const HOUR_MS = 60 * 60 * 1000

function normalizePriority(priority: string | null | undefined): TiTicketPriority {
  return priority && priority in TICKET_SLA_HOURS
    ? (priority as TiTicketPriority)
    // Una prioridad desconocida (dato viejo o roto) recibe el plazo de
    // 'normal': degradar a "sin plazo" sería volver al defecto que TIT-001
    // describe.
    : "normal"
}

/** Vencimiento comprometido de un ticket, en ISO, a partir de su prioridad. */
export function computeTicketDueAt(
  priority: string | null | undefined,
  fromIso: string = new Date().toISOString(),
): string {
  const hours = TICKET_SLA_HOURS[normalizePriority(priority)]
  return new Date(new Date(fromIso).getTime() + hours * HOUR_MS).toISOString()
}

export type TicketSlaStage = "on_track" | "due_soon" | "overdue"

/**
 * En qué tramo del compromiso está un ticket. `null` en `dueAt` es un ticket
 * anterior a la migración: no se inventa un vencimiento retroactivo, se declara
 * que no tiene plazo.
 */
export function ticketSlaStage(
  dueAt: string | null | undefined,
  now: Date = new Date(),
): TicketSlaStage | null {
  if (!dueAt) return null
  const due = new Date(dueAt).getTime()
  if (due < now.getTime()) return "overdue"
  if (due <= now.getTime() + TICKET_SLA_WARNING_HOURS * HOUR_MS) return "due_soon"
  return "on_track"
}

/** Prioridades en orden de urgencia (la más urgente primero). */
export const TICKET_PRIORITY_RANK: Record<TiTicketPriority, number> = {
  critica: 0,
  alta: 1,
  normal: 2,
  baja: 3,
}

/** Rango para ordenar; una prioridad desconocida va con 'normal', como en el plazo. */
export function ticketPriorityRank(priority: string | null | undefined): number {
  return TICKET_PRIORITY_RANK[normalizePriority(priority)]
}

/**
 * Una duración en lenguaje de persona: «40 min», «5 h», «2 días». Redondea
 * hacia abajo salvo por debajo del minuto, donde dice «1 min»: «Atrasado 0 min»
 * contradice el «Atrasado» que lo precede.
 */
export function formatTicketSpan(ms: number): string {
  const abs = Math.abs(ms)
  const minutes = Math.max(1, Math.floor(abs / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(abs / HOUR_MS)
  if (hours < 48) return `${hours} h`
  const days = Math.floor(abs / (24 * HOUR_MS))
  return days === 1 ? "1 día" : `${days} días`
}

export type TicketDueKind = "on_track" | "due_soon" | "overdue" | "met" | "missed"

export interface TicketDueInfo {
  kind: TicketDueKind
  /** Cuánto falta (abiertos al día o por vencer) o cuánto se pasó (atrasados). */
  span: string | null
}

/**
 * Lo que la ficha debe decir del compromiso de un ticket.
 *
 * Un ticket abierto cuenta contra el reloj: «vence en 2 días» o «atrasado 5 h».
 * Uno resuelto o cerrado ya no tiene un vencimiento vigente —mostrarlo sería
 * decir que algo sigue corriendo cuando el trabajo terminó—, así que se
 * contrasta cuándo se resolvió con lo comprometido: dentro o fuera de plazo.
 * Sin fecha de resolución (cerrado antes de que se guardara) no se adivina.
 */
export function ticketDueInfo(
  ticket: { status: string; dueAt: string | null | undefined; resolvedAt?: string | null },
  now: Date = new Date(),
): TicketDueInfo | null {
  if (!ticket.dueAt) return null
  const due = new Date(ticket.dueAt).getTime()
  if (ticket.status === "resuelto" || ticket.status === "cerrado") {
    if (!ticket.resolvedAt) return null
    return { kind: new Date(ticket.resolvedAt).getTime() <= due ? "met" : "missed", span: null }
  }
  const stage = ticketSlaStage(ticket.dueAt, now)
  if (!stage) return null
  return { kind: stage, span: formatTicketSpan(due - now.getTime()) }
}

/** Cómo se ordena la lista de tickets. `urgencia` es el orden de quien gestiona. */
export const TICKET_ORDERS = ["urgencia", "vence", "prioridad", "actualizado", "creado"] as const
export type TicketOrder = typeof TICKET_ORDERS[number]
export const DEFAULT_TICKET_ORDER: TicketOrder = "urgencia"

export function parseTicketOrder(value: unknown): TicketOrder {
  return (TICKET_ORDERS as readonly string[]).includes(value as string) ? (value as TicketOrder) : DEFAULT_TICKET_ORDER
}
