import { z } from "zod"
import { PPA_TIPO_TRABAJO_KEYS } from "@/lib/ppa/types"
import { validateRut } from "@/lib/rut"

// ── Re-export shared ActionState ──────────────────────────────────────────────
export type { ActionState } from "./masters"

const siNo = z.enum(["si", "no"], { error: "Respuesta requerida" })

// ── Envío público del formulario PPA (trabajador, sin login) ──────────────────
export const ppaSubmitSchema = z.object({
  worksiteId: z.string().min(1, "Faena requerida"),

  // Clave de idempotencia generada en el cliente (createPpaSubmissionId en
  // lib/pwa/offline-queue.ts). Opcional: un cliente antiguo cacheado por el
  // Service Worker puede seguir enviando sin ella y el servidor genera la
  // suya — pierde la idempotencia, no el envío.
  clientSubmissionId: z.string().trim().min(12).max(100).optional(),

  // Enlace opcional al permiso de trabajo bajo el cual se ejecuta la tarea.
  // El PPA es la verificación breve dentro del permiso, no un registro
  // desconectado — ver el comentario en `ppa_submissions.work_permit_id`.
  workPermitId: z.string().min(1).optional(),

  // Identificación del trabajador.
  workerId:   z.string().min(1).optional(),          // de la lista controlada
  workerName: z.string().trim().min(2, "Indica tu nombre").max(120),
  // El RUT es la identidad del trabajador cuando no viene de la lista
  // controlada, y con ella se escopa el límite de envíos del formulario público
  // (ver submitPpaAction). Sin dígito verificador válido sería una cadena libre,
  // es decir una identidad que el cliente puede inventar a voluntad.
  workerRut:  z.string().trim().max(20)
    .refine((value) => value === "" || validateRut(value), "RUT inválido")
    .optional(),
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
    if (value.decision === "rechazado") return
    if ((value.accionCorrectiva ?? "").trim().length < 4) {
      ctx.addIssue({ code: "custom", path: ["accionCorrectiva"], message: "Describe la acción correctiva requerida antes del reinicio." })
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

export const ppaCorrectionDeclareSchema = z.object({
  ppaId: z.string().min(1),
  expectedPpaVersion: z.number().int().positive(),
  expectedCapaVersion: z.number().int().positive(),
})
export type PpaCorrectionDeclareInput = z.infer<typeof ppaCorrectionDeclareSchema>

export const ppaVerificationSchema = z.object({
  ppaId: z.string().min(1),
  expectedPpaVersion: z.number().int().positive(),
  expectedCapaVersion: z.number().int().positive(),
  accepted: z.boolean(),
  comment: z.string().trim().min(5).max(2000),
  effectivenessStatus: z.enum(["effective", "not_required"]).optional(),
  effectivenessAssessment: z.string().trim().max(3000).optional(),
  segregationExceptionReason: z.string().trim().max(2000).optional(),
}).superRefine((value, ctx) => {
  if (!value.accepted) return
  if (!value.effectivenessStatus) {
    ctx.addIssue({ code: "custom", path: ["effectivenessStatus"], message: "Evalúa la eficacia del control." })
  }
  if ((value.effectivenessAssessment?.length ?? 0) < 5) {
    ctx.addIssue({ code: "custom", path: ["effectivenessAssessment"], message: "Documenta la evaluación de eficacia." })
  }
})
export type PpaVerificationInput = z.infer<typeof ppaVerificationSchema>

export const ppaAuthorizeRestartSchema = z.object({
  ppaId: z.string().min(1),
  expectedPpaVersion: z.number().int().positive(),
  comment: z.string().trim().max(1000).optional(),
})
export type PpaAuthorizeRestartInput = z.infer<typeof ppaAuthorizeRestartSchema>

export const ppaCancelSchema = z.object({
  ppaId: z.string().min(1),
  expectedPpaVersion: z.number().int().positive(),
  expectedCapaVersion: z.number().int().positive().optional(),
  reason: z.string().trim().min(5).max(2000),
})
export type PpaCancelInput = z.infer<typeof ppaCancelSchema>

export const ppaCloseSchema = z.object({
  ppaId: z.string().min(1),
  expectedPpaVersion: z.number().int().positive(),
  comment: z.string().trim().min(5).max(2000),
})
export type PpaCloseInput = z.infer<typeof ppaCloseSchema>
