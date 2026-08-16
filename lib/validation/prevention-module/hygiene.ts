import { z } from "zod"
import { MINSAL_PROTOCOL_CODES, PROTOCOL_APPLICABILITY_STATUSES } from "@/lib/prevention/minsal-protocols"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * El código de protocolo se valida acá y **no** con un `check` SQL: las columnas
 * de protocolo existentes (`preventionExposureAgents.surveillanceProtocol` y
 * `preventionSurveillancePrograms.protocol`) llevan texto libre de datos
 * legados, y un enum estricto en la base rompería filas ya guardadas. La
 * validación estricta se aplica sólo a lo nuevo, en el borde.
 */
export const minsalProtocolCodeSchema = z.enum(MINSAL_PROTOCOL_CODES as [string, ...string[]])

export const protocolApplicabilitySchema = z.object({
  worksiteId: z.string().trim().min(1),
  protocolCode: minsalProtocolCodeSchema,
  status: z.enum(PROTOCOL_APPLICABILITY_STATUSES),
  justification: z.string().trim().max(2000).optional().nullable(),
  periodicityMonths: z.number().int().min(1).max(120).optional().nullable(),
  lastAssessedOn: z.string().regex(ISO_DATE, "Fecha inválida (YYYY-MM-DD).").optional().nullable(),
  expectedVersion: z.number().int().positive().optional(),
}).refine((data) => data.status !== "not_applicable" || (data.justification ?? "").trim().length >= 10, {
  path: ["justification"],
  message: "Descartar un protocolo exige justificarlo: explica por qué no aplica a esta faena.",
})

export type ProtocolApplicabilityInput = z.infer<typeof protocolApplicabilitySchema>
