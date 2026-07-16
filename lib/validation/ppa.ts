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
  responsibleRole: z.enum(["prevencionista_faena", "admin_contrato", "jefe_faena", "prevencionista"]).optional(),
  responsible: z.string().trim().max(200).optional().or(z.literal("")),
  dueDate: z.string().trim().max(10).optional().or(z.literal("")),
  priority: z.enum(["alta", "media", "baja"]).optional(),
  reviewNota:       z.string().trim().max(1000).optional().or(z.literal("")),
})
  .superRefine((value, ctx) => {
    if (value.decision !== "autorizado") return
    if ((value.accionCorrectiva ?? "").trim().length < 4) {
      ctx.addIssue({ code: "custom", path: ["accionCorrectiva"], message: "Describe la acción correctiva para autorizar el inicio." })
    }
    if (!value.responsibleRole) {
      ctx.addIssue({ code: "custom", path: ["responsibleRole"], message: "Selecciona el rol responsable de la acción." })
    }
    if ((value.responsible ?? "").trim().length < 2) {
      ctx.addIssue({ code: "custom", path: ["responsible"], message: "Indica la persona responsable de la acción." })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.dueDate ?? "")) {
      ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Indica un plazo válido para la acción." })
    }
    if (!value.priority) {
      ctx.addIssue({ code: "custom", path: ["priority"], message: "Selecciona la prioridad de la acción." })
    }
  })

export type PpaReviewInput = z.infer<typeof ppaReviewSchema>
