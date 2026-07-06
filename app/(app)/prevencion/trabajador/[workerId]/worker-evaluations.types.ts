"use client"

export interface Worker {
  id: string
  firstName: string
  lastName: string
  rut: string | null
  position: string | null
  worksiteId: string
  worksiteName: string | null
}

export interface WorkerEvaluationsProps {
  worker: Worker
  evaluations: import("@/db/schema/sst").SstEvaluation[]
  weeklyEvals: import("@/db/schema/sst").SstWeeklyEvaluation[]
  permissions: {
    canCreate: boolean
    canEvaluateAcompanamiento: boolean
    canDelete: boolean
  }
  userEvaluatorRole?: 'prevencionista_faena' | 'admin_contrato' | 'conductor_lider'
}

export const MOTIVO_OPTIONS = [
  { value: "control_periodico",              label: "Control periódico" },
  { value: "post_incidente_persona",         label: "Post incidente — persona" },
  { value: "post_incidente_material",        label: "Post incidente — material" },
  { value: "post_incidente_ambiental",       label: "Post incidente — ambiental" },
  { value: "cuasi_accidente",                label: "Cuasi accidente" },
  { value: "incumplimiento_procedimiento",   label: "Incumplimiento de procedimiento" },
  { value: "reincidencia",                   label: "Reincidencia" },
  { value: "reincorporacion",                label: "Reincorporación" },
  { value: "otro",                           label: "Otro" },
]

export const todayStr = new Date().toISOString().slice(0, 10)
