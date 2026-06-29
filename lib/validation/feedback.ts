import { z } from "zod"

// ── Re-export shared ActionState ──────────────────────────────────────────────
export type { ActionState } from "./masters"

// ── Tipos y estados ───────────────────────────────────────────────────────────
export const FEEDBACK_TIPOS = ["bug", "consulta", "sugerencia"] as const
export const FEEDBACK_ESTADOS = ["abierto", "en_progreso", "resuelto", "descartado"] as const
export const FEEDBACK_PRIORIDADES = ["baja", "normal", "alta", "critica"] as const

export type FeedbackTipo   = typeof FEEDBACK_TIPOS[number]
export type FeedbackEstado = typeof FEEDBACK_ESTADOS[number]
export type FeedbackPrioridad = typeof FEEDBACK_PRIORIDADES[number]

// ── Crear reporte ─────────────────────────────────────────────────────────────
export const feedbackCreateSchema = z.object({
  tipo:        z.enum(FEEDBACK_TIPOS, { error: "Selecciona el tipo de reporte" }),
  titulo:      z.string().trim().min(1, "El título es obligatorio").max(160, "El título no puede superar 160 caracteres"),
  descripcion: z.string().trim().min(1, "La descripción es obligatoria").max(4000, "La descripción no puede superar 4000 caracteres"),
  pagina:      z.string().trim().max(300, "La URL no puede superar 300 caracteres").optional().or(z.literal("")),
  priority:    z.enum(FEEDBACK_PRIORIDADES).default("normal"),
})

// ── Actualizar estado (solo gestores/admins) ──────────────────────────────────
export const feedbackUpdateStatusSchema = z.object({
  id:          z.string().min(1, "ID de reporte requerido"),
  estado:      z.enum(FEEDBACK_ESTADOS, { error: "Estado inválido" }),
  notaInterna: z.string().trim().max(2000, "La nota no puede superar 2000 caracteres").optional().or(z.literal("")),
})
