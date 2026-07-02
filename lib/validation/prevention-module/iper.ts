import { z } from "zod"

const riskScore = z.coerce.number().int().min(1).max(5)

export const iperMatrixCreateSchema = z.object({
  worksiteId:    z.string().min(1, "Faena requerida"),
  code:          z.string().trim().min(1, "Codigo requerido").max(40),
  version:       z.coerce.number().int().positive("Version requerida"),
  title:         z.string().trim().min(1, "Titulo requerido").max(160),
  effectiveFrom: z.string().min(1, "Fecha de vigencia requerida"),
  effectiveTo:   z.string().optional().or(z.literal("")),
})

export const iperRiskItemSchema = z.object({
  matrixId:            z.string().min(1, "Matriz requerida"),
  process:             z.string().trim().min(1).max(120),
  task:                z.string().trim().min(1).max(160),
  hazard:              z.string().trim().min(1).max(200),
  consequence:         z.string().trim().min(1).max(200),
  initialProbability:  riskScore,
  initialSeverity:     riskScore,
  controls:            z.array(z.string().trim().min(1)).min(1, "Indica al menos un control"),
  residualProbability: riskScore,
  residualSeverity:    riskScore,
  responsible:         z.string().trim().min(1).max(160),
  requiresTraining:    z.boolean().optional(),
  requiresPpa:         z.boolean().optional(),
})
