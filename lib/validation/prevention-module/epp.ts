import { z } from "zod"

export const eppPositionEntrySchema = z.object({
  worksiteId:    z.string().min(1),
  position:      z.string().trim().min(1).max(120),
  eppProductId:  z.string().min(1),
  riskId:        z.string().optional().or(z.literal("")),
  requiredSince: z.string().min(1),
  notes:         z.string().max(500).optional().or(z.literal("")),
})

export const eppLifecyclePolicySchema = z.object({
  eppProductId:       z.string().min(1),
  lifespanDays:       z.coerce.number().int().positive(),
  maxReuses:          z.coerce.number().int().positive().optional(),
  inspectionChecklist: z.record(z.string(), z.unknown()).default({}),
})

export const eppStockThresholdSchema = z.object({
  worksiteId:    z.string().min(1),
  eppProductId:  z.string().min(1),
  minStock:      z.coerce.number().int().min(0),
  criticalStock: z.coerce.number().int().min(0),
})

export const eppDeliveryLogSchema = z.object({
  workerId:      z.string().min(1, "Trabajador requerido"),
  eppProductId:  z.string().min(1, "EPP requerido"),
  deliveredAt:   z.string().optional().or(z.literal("")),
  evidenceUrl:   z.string().max(500).min(1, "El acta de entrega es requerida"),
})
