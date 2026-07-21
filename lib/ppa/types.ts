/**
 * lib/ppa/types.ts
 * Tipos, constantes y catálogos del módulo PPA Digital (Para, Piensa y Actúa).
 * Sin imports de DB ni UI — solo dominio puro.
 */

import { CARGO_KEYS, type CargoKey } from "@/lib/sst/cargos"

/* ── Tipo de trabajo ─────────────────────────────────────────────────────────
 * Reutiliza la lista controlada de cargos del módulo de evaluación, EXCLUYENDO
 * `conductor_general` (decisión de negocio, ver prompt). Lista cerrada.
 */
export const PPA_TIPO_TRABAJO_EXCLUDED: CargoKey[] = []

export const PPA_TIPO_TRABAJO_OPTIONS = (Object.entries(CARGO_KEYS) as [CargoKey, string][])
  .reduce<Array<{ value: CargoKey; label: string }>>((options, [value, label]) => {
    if (!PPA_TIPO_TRABAJO_EXCLUDED.includes(value)) options.push({ value, label })
    return options
  }, [])

export const PPA_TIPO_TRABAJO_KEYS = PPA_TIPO_TRABAJO_OPTIONS.map((o) => o.value)

export function tipoTrabajoLabel(key: string): string {
  return (CARGO_KEYS as Record<string, string>)[key] ?? key
}

/**
 * Tareas marcadas como críticas → vuelven obligatorias las preguntas
 * complementarias "Para, Piensa y Actúa". Solución simple y extensible:
 * editar este set para sumar/quitar tareas críticas.
 */
export const PPA_CRITICAL_TASKS = new Set<string>([
  "operador_maquinaria_pesada",
])

export function isTareaCritica(tipoTrabajo: string): boolean {
  return PPA_CRITICAL_TASKS.has(tipoTrabajo)
}

/* ── Controles ───────────────────────────────────────────────────────────── */
export const PPA_CONTROL_OPTIONS = [
  { value: "permiso_trabajo", label: "Permiso de trabajo" },
  { value: "epp",             label: "Elementos de protección personal" },
  { value: "herramientas",    label: "Herramientas adecuadas y en buen estado" },
  { value: "energias",        label: "Energías bloqueadas" },
  { value: "senalizacion",    label: "Señalización" },
  { value: "area_despejada",  label: "Área despejada" },
  { value: "comunicacion",    label: "Comunicación con el equipo" },
  { value: "otro",            label: "Otro control necesario para la tarea" },
] as const

export type PpaControlKey = (typeof PPA_CONTROL_OPTIONS)[number]["value"]

export function controlLabel(key: string): string {
  return PPA_CONTROL_OPTIONS.find((c) => c.value === key)?.label ?? key
}

/**
 * Controles mínimos exigibles para iniciar cualquier tarea. Si falta alguno,
 * el sistema detiene el trabajo. Extensible por tarea si se requiere.
 */
export const PPA_REQUIRED_CONTROLS: PpaControlKey[] = ["epp", "herramientas"]

/* ── Preguntas complementarias PPA ───────────────────────────────────────── */
export const PPA_COMPLEMENTARIAS = [
  { key: "peligroCritico", label: "¿Cuál es el peligro más crítico de la tarea que realizarás?" },
  { key: "queCambio",      label: "¿Qué cambió hoy en el área de trabajo que podría aumentar el riesgo?" },
  { key: "revisionEquipo", label: "¿Qué revisión realizaste al equipo o herramienta antes de comenzar?" },
  { key: "condicionClima", label: "¿Qué condición del clima, ambiente o entorno podría hacerte detener el trabajo?" },
] as const

export type PpaComplementariaKey = (typeof PPA_COMPLEMENTARIAS)[number]["key"]

/* Longitud mínima para considerar "suficiente" una respuesta abierta obligatoria. */
export const PPA_MIN_ANSWER_LEN = 4

/* ── Estructura de respuestas del formulario ─────────────────────────────── */
export interface PpaAnswers {
  tipoTrabajo: string                 // CargoKey
  cambioPlanificado: "si" | "no"
  cambioDescripcion?: string
  peligroNoControlado: "si" | "no"
  peligroDescripcion?: string
  controles: string[]                 // PpaControlKey[]
  seguroComenzar: "si" | "no"
  complementarias: Partial<Record<PpaComplementariaKey, string>>
}

/* ── Estados / resultados ────────────────────────────────────────────────── */
export type PpaResultado = "autorizado_auto" | "detenido"

export type EstadoPpa =
  | "aprobado_auto"      // aprobado automáticamente, puede iniciar
  | "detenido"           // trabajo detenido, pendiente de revisión del responsable
  | "en_correccion"      // el responsable solicitó corrección
  | "pendiente_verificacion" // corrección declarada, pendiente de verificar
  | "autorizado"         // autorizado por el responsable tras revisión
  | "rechazado"          // rechazado por el responsable
  | "cancelado"          // la tarea no se ejecutará; requiere motivo y actor
  | "cerrado"            // caso cerrado

export type PpaDecision = "autorizado" | "rechazado" | "correccion"

/* ── Razones de detención ────────────────────────────────────────────────── */
export type PpaStopReason =
  | "no_seguro"
  | "peligro_no_controlado"
  | "cambio_sin_descripcion"
  | "pregunta_critica_sin_responder"
  | "respuesta_insuficiente"
  | "sin_peligro_en_tarea_critica"
  | "faltan_controles"

export const PPA_STOP_REASON_LABELS: Record<PpaStopReason, string> = {
  no_seguro:                      "El trabajador declaró que NO es seguro comenzar.",
  peligro_no_controlado:          "Existe un peligro no controlado.",
  cambio_sin_descripcion:         "Hay un cambio respecto a lo planificado sin describir.",
  pregunta_critica_sin_responder: "Quedó una pregunta crítica sin responder.",
  respuesta_insuficiente:         "Una respuesta obligatoria es vacía, genérica o insuficiente.",
  sin_peligro_en_tarea_critica:   "No identificó el peligro crítico en una tarea que requiere evaluación de riesgo.",
  faltan_controles:               "Faltan controles relevantes para la tarea seleccionada.",
}
