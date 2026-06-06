import { z } from "zod"

// ── Re-export shared ActionState ──────────────────────────────────────────────
export type { ActionState } from "./masters"

// ── Request item attribute ────────────────────────────────────────────────────
export const requestItemAttributeSchema = z.object({
  id:            z.string().optional(),
  attributeId:   z.string().optional().nullable(),
  attributeName: z.string().min(1),
  value:         z.string().min(1, "Valor requerido"),
})

// ── Request item ──────────────────────────────────────────────────────────────
export const requestItemSchema = z.object({
  id:              z.string().optional(),
  productId:       z.string().nullable().optional(),
  productNameFree: z.string().max(120).optional().or(z.literal("")),
  quantity:        z.coerce.number().positive("Cantidad debe ser mayor a 0"),
  unitOfMeasure:   z.string().min(1, "Unidad requerida").max(20).default("unidad"),
  urgency:         z.enum(["normal", "high", "critical"]).default("normal"),
  requiredDate:    z.string().optional().nullable(),
  workerId:        z.string().optional().nullable(),
  sortOrder:       z.coerce.number().int().default(0),
  notes:           z.string().max(300).optional().or(z.literal("")),
  attributes:      z.array(requestItemAttributeSchema).default([]),
}).refine(
  (d) => d.productId || (d.productNameFree && d.productNameFree.length > 0),
  { message: "Selecciona un producto o describe el artículo", path: ["productId"] },
)

// ── Purchase request (header) ─────────────────────────────────────────────────
export const requestSchema = z.object({
  id:           z.string().optional(),
  worksiteId:   z.string().min(1, "Selecciona una faena"),
  costCenterId: z.string().optional().nullable().or(z.literal("")),
  urgency:      z.enum(["normal", "high", "critical"]).default("normal"),
  requiredDate: z.string().optional().nullable(),
  notes:        z.string().max(500).optional().or(z.literal("")),
  items:        z.array(requestItemSchema).min(1, "Agrega al menos un ítem"),
})

export type RequestFormData = z.infer<typeof requestSchema>
export type RequestItemFormData = z.infer<typeof requestItemSchema>
