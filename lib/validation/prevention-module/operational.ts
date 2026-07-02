import { z } from "zod"

export const equipmentDailyReportSchema = z.object({
  worksiteId:       z.string().min(1),
  equipmentId:      z.string().min(1),
  operatorWorkerId: z.string().min(1),
  shift:            z.string().min(1),
  status:           z.enum(["ok", "observado", "fuera_servicio"]).default("ok"),
  odometer:         z.coerce.number().int().positive().optional(),
  hourmeter:        z.coerce.number().int().positive().optional(),
  checklist:        z.record(z.string(), z.unknown()).default({}),
})

export const equipmentReportReviewSchema = z.object({
  reportId:         z.string().min(1),
  status:           z.enum(["aprobado", "observado", "requiere_cierre"]),
  findings:         z.record(z.string(), z.unknown()).default({}),
})

export const equipmentChecklistSchema = z.object({
  worksiteId:  z.string().min(1),
  kind:        z.enum(["contenedor", "camion", "equipo", "carro", "batea", "taller_respel"]),
  assetCode:   z.string().min(1),
  items:       z.record(z.string(), z.unknown()).default({}),
  status:      z.enum(["ok", "observado", "fuera_servicio"]).default("ok"),
  closeRequired: z.boolean().default(false),
})

export const alcoholTestSchema = z.object({
  worksiteId:    z.string().min(1),
  testedWorkerId: z.string().optional().or(z.literal("")),
  shift:         z.string().min(1),
  result:        z.enum(["negativo", "positivo", "rechazado", "no_concluyente"]),
  evidenceUrl:   z.string().max(500).optional().or(z.literal("")),
  sentAt:        z.string().optional().or(z.literal("")),
})
