import { z } from "zod"
import { COORDINATION_INFO_TYPES } from "@/lib/prevention/external-engagements"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export const engagementKindSchema = z.enum(["coordinacion", "fiscalizacion", "organismo_administrador"])
export const engagementDirectionSchema = z.enum(["received", "delivered"])
export const counterpartyTypeSchema = z.enum([
  "mandante", "contratista", "subcontratista", "otra_empresa_faena",
  "direccion_trabajo", "seremi_salud", "organismo_administrador", "otro",
])

export const externalEngagementCreateSchema = z.object({
  worksiteId: z.string().trim().min(1),
  kind: engagementKindSchema,
  direction: engagementDirectionSchema.default("received"),
  counterpartyType: counterpartyTypeSchema,
  counterpartyName: z.string().trim().min(2).max(300),
  counterpartyRut: z.string().trim().max(20).optional().nullable(),
  occurredOn: z.string().regex(ISO_DATE, "Fecha inválida (YYYY-MM-DD)."),
  subject: z.string().trim().min(3).max(300),
  summary: z.string().trim().max(4000).optional().nullable(),
  outcome: z.string().trim().max(2000).optional().nullable(),
  officialReference: z.string().trim().max(120).optional().nullable(),
  infoTypes: z.array(z.enum(COORDINATION_INFO_TYPES)).optional().nullable(),
})
  // Los mismos invariantes que los checks de la tabla, para fallar con un
  // mensaje útil en vez de un error de constraint de Postgres.
  .refine((data) => data.kind === "coordinacion" || data.direction === "received", {
    path: ["direction"],
    message: "Sólo la coordinación del art. 20 puede registrarse como entregada: una fiscalización siempre se recibe.",
  })
  .refine((data) => data.kind === "coordinacion" || (data.officialReference ?? "").trim().length >= 3, {
    path: ["officialReference"],
    message: "Indica el N° de acta, resolución o comprobante de la visita.",
  })
  .refine((data) => data.kind !== "coordinacion" || (data.infoTypes ?? []).length > 0, {
    path: ["infoTypes"],
    message: "Indica qué información se intercambió: riesgos, medidas o plan de emergencia.",
  })

export const externalEngagementMeasureSchema = z.object({
  engagementId: z.string().trim().min(1),
  /** Lo que la contraparte constató. */
  finding: z.string().trim().min(10).max(2000),
  /** Medida a implementar. */
  actionDescription: z.string().trim().min(10).max(2000),
  responsibleUserId: z.string().trim().min(1),
  targetDate: z.string().regex(ISO_DATE, "Fecha inválida (YYYY-MM-DD)."),
  priority: z.enum(["low", "medium", "high", "critical"]).default("high"),
  /** Artículo o norma que citó el fiscalizador. */
  normativaLegal: z.string().trim().max(300).optional().nullable(),
})

export const externalEngagementCloseSchema = z.object({
  engagementId: z.string().trim().min(1),
  expectedVersion: z.number().int().positive(),
  outcome: z.string().trim().min(10).max(2000),
})

export type ExternalEngagementCreateInput = z.infer<typeof externalEngagementCreateSchema>
