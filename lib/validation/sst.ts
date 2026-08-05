import { z } from "zod"

// ── Re-export shared ActionState ──────────────────────────────────────────────
export type { ActionState } from "./masters"

// ── StatusValue enum ──────────────────────────────────────────────────────────
const statusValueSchema = z.enum([
  'cumple',
  'regular',
  'no_cumple',
  'na',
  'no_tiene',
  'entregado',
  'no_entregado',
  'apto',
  'no_apto',
  'si',
  'no',
]).nullable()

// ── Create evaluation ─────────────────────────────────────────────────────────
export const sstEvaluationCreateSchema = z.object({
  tipo:             z.enum(['nuevo', 'seguimiento'], { error: 'Tipo de evaluación requerido' }),
  definicionCode:   z.string().min(1, 'Selecciona una definición de checklist'),
  workerId:         z.string().min(1, 'Trabajador requerido'),
  worksiteId:       z.string().min(1, 'Selecciona una faena'),
  fechaEvaluacion:  z.string().min(1, 'Fecha de evaluación requerida'),
  cargos:           z.array(z.string().min(1)).min(1, 'Selecciona al menos un cargo'),
  evaluatorRole:    z.enum(['prevencionista_faena', 'admin_contrato', 'conductor_lider']).optional(),
  visitId:          z.string().min(1, 'Visita inválida').optional(),
  motivo:           z.enum([
    'control_periodico',
    'post_incidente_persona',
    'post_incidente_material',
    'post_incidente_ambiental',
    'cuasi_accidente',
    'incumplimiento_procedimiento',
    'reincidencia',
    'reincorporacion',
    'otro',
  ]).optional(),
  motivoOtro:           z.string().max(200).optional().or(z.literal('')),
  descripcionEvento:    z.string().max(500).optional().or(z.literal('')),
  equipoPatente:        z.string().max(20).optional().or(z.literal('')),
})

// ── Single response ───────────────────────────────────────────────────────────
export const sstResponseSchema = z.object({
  evaluationId:      z.string().min(1, 'Evaluación requerida'),
  seccionId:         z.string().min(1, 'Sección requerida'),
  itemId:            z.string().min(1, 'Ítem requerido'),
  estado:            statusValueSchema,
  observacion:       z.string().max(500).optional().or(z.literal('')),
  accionCorrectiva:  z.string().max(500).optional().or(z.literal('')),
})

// ── Batch responses ───────────────────────────────────────────────────────────
export const sstResponsesBatchSchema = z.array(sstResponseSchema)

// ── Action plan item ──────────────────────────────────────────────────────────
export const sstActionPlanItemSchema = z.object({
  evaluationId:  z.string().min(1, 'Evaluación requerida'),
  n:             z.coerce.number().int().positive('Número de ítem requerido'),
  hallazgo:      z.string().trim().min(1, 'Describe el hallazgo').max(500),
  accion:        z.string().trim().min(1, 'Describe la acción').max(500),
  responsable:   z.string().trim().min(1, 'Responsable requerido').max(150),
  plazo:         z.string().min(1, 'Plazo requerido'),
  estado:        z.string().min(1, 'Estado requerido').max(50),
})

// ── Followup mark ─────────────────────────────────────────────────────────────
export const sstFollowupMarkSchema = z.object({
  realizado:     z.boolean(),
  cumple:        z.boolean().nullable(),
  observaciones: z.string().max(500).optional().or(z.literal('')),
})

// ── Close evaluation ──────────────────────────────────────────────────────────
export const sstCloseEvaluationSchema = z.object({
  evaluationId:           z.string().min(1, 'Evaluación requerida'),
  restricciones:          z.string().max(500).optional().or(z.literal('')),
  observacionesGenerales: z.string().max(1000).optional().or(z.literal('')),
  hasCriticalDeviation:   z.boolean().optional(),
  hasReincidence:         z.boolean().optional(),
})
