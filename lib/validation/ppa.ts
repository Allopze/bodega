import { z } from "zod"
import { PPA_TIPO_TRABAJO_KEYS } from "@/lib/ppa/types"

// ── Re-export shared ActionState ──────────────────────────────────────────────
export type { ActionState } from "./masters"

const siNo = z.enum(["si", "no"], { error: "Respuesta requerida" })

// ── Envío público del formulario PPA (trabajador, sin login) ──────────────────
export const ppaSubmitSchema = z.object({
  worksiteId: z.string().min(1, "Faena requerida"),

  // Identificación del trabajador.
  workerId:   z.string().min(1).optional(),          // de la lista controlada
  workerName: z.string().trim().min(2, "Indica tu nombre").max(120),
  workerRut:  z.string().trim().max(20).optional().or(z.literal("")),
  workerCompany: z.string().trim().max(120).optional().or(z.literal("")),

  // Tarea — lista cerrada de cargos (sin conductor_general).
  tipoTrabajo: z.enum(PPA_TIPO_TRABAJO_KEYS as [string, ...string[]], {
    error: "Selecciona el tipo de trabajo",
  }),

  // Preguntas críticas.
  cambioPlanificado:   siNo,
  cambioDescripcion:   z.string().trim().max(500).optional().or(z.literal("")),
  peligroNoControlado: siNo,
  peligroDescripcion:  z.string().trim().max(500).optional().or(z.literal("")),
  controles:           z.array(z.string().min(1)).default([]),
  seguroComenzar:      siNo,

  // Complementarias PPA (obligatorias se validan en la lógica de evaluación).
  complementarias: z.object({
    peligroCritico: z.string().trim().max(500).optional().or(z.literal("")),
    queCambio:      z.string().trim().max(500).optional().or(z.literal("")),
    revisionEquipo: z.string().trim().max(500).optional().or(z.literal("")),
    condicionClima: z.string().trim().max(500).optional().or(z.literal("")),
  }).default({}),
})

export type PpaSubmitInput = z.infer<typeof ppaSubmitSchema>

// ── Revisión del responsable (supervisor/prevencionista) ──────────────────────
export const ppaReviewSchema = z.object({
  ppaId:            z.string().min(1, "PPA requerido"),
  fuiAlLugar:       z.boolean(),
  decision:         z.enum(["autorizado", "rechazado", "correccion"], {
    error: "Selecciona una decisión",
  }),
  accionCorrectiva: z.string().trim().max(1000).optional().or(z.literal("")),
  reviewNota:       z.string().trim().max(1000).optional().or(z.literal("")),
})
  // No se puede autorizar sin registrar una acción correctiva cuando el trabajo
  // fue detenido por riesgo/condición insegura.
  .refine(
    (v) => v.decision !== "autorizado" || (v.accionCorrectiva ?? "").trim().length >= 4,
    { path: ["accionCorrectiva"], error: "Debes registrar la acción correctiva implementada para autorizar el inicio." },
  )

export type PpaReviewInput = z.infer<typeof ppaReviewSchema>
