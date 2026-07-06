"use client"

import type { SelectOption } from "@/lib/sst/types"

export interface WorkerOption {
  id: string
  name: string
  rut: string
  worksiteId: string
}

export interface WorksiteOption {
  id: string
  name: string
}

export interface DefinicionOption {
  code: string
  title: string
  tipo: "nuevo" | "seguimiento"
}

export interface Props {
  workers: WorkerOption[]
  worksites: WorksiteOption[]
  definiciones: DefinicionOption[]
  cargoOptions: SelectOption[]
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

export const today = new Date().toISOString().slice(0, 10)

export function getEvaluationTypeLabel(def: DefinicionOption) {
  if (def.tipo === "seguimiento") return "Control de seguimiento"
  return "Trabajador nuevo"
}
