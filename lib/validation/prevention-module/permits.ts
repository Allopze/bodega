import { z } from "zod"
// Día calendario en Chile: una fecha `YYYY-MM-DD` no es un instante, así que
// compararla contra UTC adelanta o atrasa el corte según la hora del envío.
import { todayInChile } from "@/lib/utils"

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
const instant = z.string().datetime({ offset: true })
const reason = z.string().trim().min(10).max(3000)

/** Tolerancia para relojes desincronizados del dispositivo que registra en terreno. */
const CLOCK_SKEW_MS = 120_000

export const ENERGY_SOURCES = [
  "electrical", "mechanical", "hydraulic", "pneumatic",
  "thermal", "chemical", "gravitational", "other",
] as const

export const permitTypeSchema = z.object({
  code: z.string().trim().min(2).max(60),
  name: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  competencyTaskKey: z.string().trim().max(120).nullable().optional(),
  requiresIsolation: z.boolean().default(false),
  requiresMeasurement: z.boolean().default(false),
  requiresJsa: z.boolean().default(true),
  measurementValidityMinutes: z.number().int().positive().max(1440).nullable().optional(),
  // Opt-in por tipo: ausente = no se exige calibración vigente del instrumento.
  measurementCalibrationValidityDays: z.number().int().positive().max(3650).nullable().optional(),
  maxDurationHours: z.number().int().positive().max(72).default(12),
  legalBasis: z.string().trim().min(5).max(2000),
}).superRefine((value, ctx) => {
  if (value.requiresMeasurement && !value.measurementValidityMinutes) {
    ctx.addIssue({ code: "custom", path: ["measurementValidityMinutes"], message: "Un permiso que exige mediciones debe declarar su vigencia en minutos." })
  }
})

export const workPermitSchema = z.object({
  permitTypeId: z.string().min(1),
  worksiteId: z.string().min(1),
  taskDescription: z.string().trim().min(10).max(3000),
  location: z.string().trim().min(3).max(300),
  riskEntryId: z.string().min(1).nullable().optional(),
  supervisorUserId: z.string().min(1),
  plannedStartAt: instant,
  plannedEndAt: instant,
  crew: z.array(z.object({
    workerId: z.string().min(1),
    role: z.enum(["executor", "supervisor", "standby", "observer"]),
  })).default([]),
  controls: z.array(z.object({
    description: z.string().trim().min(3).max(1000),
    isMandatory: z.boolean().default(true),
  })).default([]),
}).superRefine((value, ctx) => {
  if (Date.parse(value.plannedEndAt) <= Date.parse(value.plannedStartAt)) {
    ctx.addIssue({ code: "custom", path: ["plannedEndAt"], message: "El término debe ser posterior al inicio." })
  }
})

export const jsaStepSchema = z.object({
  permitId: z.string().min(1),
  steps: z.array(z.object({
    stepOrder: z.number().int().positive().max(200),
    stepDescription: z.string().trim().min(5).max(2000),
    hazards: z.array(z.string().trim().min(3).max(500)).min(1, "Cada paso debe declarar al menos un peligro."),
    controls: z.array(z.string().trim().min(3).max(500)).min(1, "Cada paso debe declarar al menos un control."),
    residualRisk: z.enum(["low", "medium", "high", "critical"]),
  })).min(1),
})

export const permitControlVerificationSchema = z.object({
  controlId: z.string().min(1),
  verified: z.boolean(),
  notApplicableReason: z.string().trim().max(1000).nullable().optional(),
}).superRefine((value, ctx) => {
  if (!value.verified && !value.notApplicableReason?.trim()) {
    ctx.addIssue({ code: "custom", path: ["notApplicableReason"], message: "Para no verificar un control debes declarar por qué no aplica." })
  }
})

export const permitIsolationSchema = z.object({
  permitId: z.string().min(1),
  energySource: z.enum(ENERGY_SOURCES),
  equipmentTag: z.string().trim().min(1).max(200),
  isolationMethod: z.string().trim().min(3).max(500),
  lockTagId: z.string().trim().min(1).max(120),
})

export const permitIsolationApplySchema = z.object({
  isolationId: z.string().min(1),
  verifiedZeroEnergy: z.boolean(),
})

export const permitIsolationRemoveSchema = z.object({
  isolationId: z.string().min(1),
  reason: z.string().trim().min(5).max(1000),
})

export const permitMeasurementSchema = z.object({
  permitId: z.string().min(1),
  parameter: z.string().trim().min(1).max(120),
  value: z.number().finite(),
  unit: z.string().trim().min(1).max(40),
  acceptableMin: z.number().finite().nullable().optional(),
  acceptableMax: z.number().finite().nullable().optional(),
  equipmentTag: z.string().trim().min(1).max(200),
  calibrationDate: date.nullable().optional(),
  takenAt: instant,
}).superRefine((value, ctx) => {
  if (value.acceptableMin != null && value.acceptableMax != null && value.acceptableMin > value.acceptableMax) {
    ctx.addIssue({ code: "custom", path: ["acceptableMax"], message: "El máximo aceptable no puede ser menor que el mínimo." })
  }
  if (value.acceptableMin == null && value.acceptableMax == null) {
    ctx.addIssue({ code: "custom", path: ["acceptableMin"], message: "Una medición debe declarar al menos un límite aceptable." })
  }
  // Una medición con hora futura nunca envejece: dejaría el permiso habilitado
  // indefinidamente por vigencia. `takenAt` es un instante absoluto, así que
  // `Date.now()` es la comparación correcta (sin husos horarios de por medio).
  if (Date.parse(value.takenAt) > Date.now() + CLOCK_SKEW_MS) {
    ctx.addIssue({ code: "custom", path: ["takenAt"], message: "La medición no puede tener una hora futura." })
  }
  if (value.calibrationDate && value.calibrationDate > todayInChile()) {
    ctx.addIssue({ code: "custom", path: ["calibrationDate"], message: "La fecha de calibración no puede estar en el futuro." })
  }
})

export const permitTransitionSchema = z.object({
  permitId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  toStatus: z.enum(["pending_approval", "approved", "active", "suspended", "closed", "rejected", "cancelled"]),
  reason,
})

export const permitExtensionSchema = z.object({
  permitId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  extendedUntilAt: instant,
  reason,
})

export const permitCrewAckSchema = z.object({
  crewId: z.string().min(1),
})
