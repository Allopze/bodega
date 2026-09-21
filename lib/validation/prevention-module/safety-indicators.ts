import { z } from "zod"

export const safetyIndicatorMonthSchema = z.object({
  worksiteId:          z.string().min(1, "Faena requerida"),
  year:                z.coerce.number().int().min(2024, "El año debe ser al menos 2024").max(2100, "El año no puede superar 2100"),
  month:               z.coerce.number().int().min(1).max(12),
  trabajadores:        z.coerce.number().int().min(0).default(0),
  horasHombre:         z.coerce.number().min(0).default(0),
  accConTiempoPerdido: z.coerce.number().int().min(0).default(0),
  accSinTiempoPerdido: z.coerce.number().int().min(0).default(0),
  diasPerdidos:        z.coerce.number().int().min(0).default(0),
  incidentes:          z.coerce.number().int().min(0).default(0),
  danoMaterial:        z.coerce.number().int().min(0).default(0),
  danoAmbiental:       z.coerce.number().int().min(0).default(0),
  correctionReason:    z.string().trim().min(10).max(3000).nullable().optional(),
})

export type SafetyIndicatorMonthInput = z.infer<typeof safetyIndicatorMonthSchema>

/**
 * El motivo por el que las notas son obligatorias depende del estado, y el
 * mensaje tiene que decirlo: con la conciliación en `pending` —que es el valor
 * POR DEFECTO del formulario— el texto único anterior ("Documenta la diferencia
 * o excepción") describía dos situaciones que no eran la del usuario, así que
 * el camino más probable de la pantalla fallaba con una explicación que no
 * aplicaba.
 */
const RECONCILIATION_NOTES_REQUIRED: Record<string, string> = {
  pending: "Explica por qué la conciliación sigue pendiente.",
  difference: "Documenta la diferencia encontrada.",
  exception: "Documenta la excepción aceptada.",
}

export const safetyIndicatorDenominatorSchema = z.object({
  worksiteId: z.string().min(1, "Faena requerida"),
  year: z.coerce.number().int().min(2024).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  workerCount: z.coerce.number({ message: "Indica la dotación del mes." }).int("La dotación se expresa en personas enteras.").min(0, "La dotación no puede ser negativa."),
  workedHours: z.coerce.number({ message: "Indica las horas trabajadas." }).min(0, "Las horas no pueden ser negativas."),
  sourceType: z.enum(["rrhh", "xlsx_import", "manual", "other_system"]),
  sourceReference: z.string().trim().min(3, "Identifica la fuente con al menos 3 caracteres.").max(1000),
  evidenceReference: z.string().trim().min(3, "Identifica la evidencia con al menos 3 caracteres.").max(4000),
  // Ninguna pantalla produce este valor: el formulario ya no pide el hash a
  // mano (una huella que teclea una persona sobre un archivo que la plataforma
  // no guarda no acredita nada). Queda como boundary para los registros
  // existentes y para cuando la evidencia sea un archivo cargado y el sistema
  // calcule la huella. Se normaliza para que el valor almacenado sea canónico:
  // un hash es el mismo dato en mayúsculas o minúsculas, pero comparar dos
  // cajas distintas da falso negativo.
  evidenceChecksumSha256: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z.string().regex(/^[a-f0-9]{64}$/, "Un SHA-256 son 64 caracteres hexadecimales.").nullable().optional(),
  ),
  reconciliationStatus: z.enum(["pending", "matched", "difference", "exception"]),
  reconciliationNotes: z.string().trim().min(5, "Usa al menos 5 caracteres.").max(4000).nullable().optional(),
  submitForReview: z.boolean().default(false),
  expectedVersion: z.number().int().positive().nullable().optional(),
  correctionReason: z.string().trim().min(10, "El motivo de corrección necesita al menos 10 caracteres.").max(3000).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.reconciliationStatus !== "matched" && !value.reconciliationNotes) {
    ctx.addIssue({
      code: "custom",
      path: ["reconciliationNotes"],
      message: RECONCILIATION_NOTES_REQUIRED[value.reconciliationStatus] ?? "Documenta el estado de la conciliación.",
    })
  }
  // `approveSafetyIndicatorDenominator` rechaza aprobar con la conciliación en
  // `pending`. Dejar que el registro llegue igual a revisión producía un
  // callejón sin salida: el aprobador no puede aprobarlo y tampoco editarlo
  // —el formulario se desmonta en `pending_review`— y nada explicaba por qué.
  // Se corta acá, donde el preparador todavía puede arreglarlo.
  if (value.submitForReview && value.reconciliationStatus === "pending") {
    ctx.addIssue({
      code: "custom",
      path: ["reconciliationStatus"],
      message: "Resuelve la conciliación antes de enviar a revisión: con la conciliación pendiente no se puede aprobar.",
    })
  }
})

export const approveSafetyIndicatorDenominatorSchema = z.object({
  denominatorId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(10).max(3000),
})

export const closeSafetyIndicatorPeriodSchema = z.object({
  worksiteId: z.string().min(1),
  year: z.coerce.number().int().min(2024).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  reason: z.string().trim().min(10).max(3000),
})

export type SafetyIndicatorDenominatorInput = z.infer<typeof safetyIndicatorDenominatorSchema>
