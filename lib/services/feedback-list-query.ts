import {
  FEEDBACK_ESTADOS,
  FEEDBACK_PRIORIDADES,
  FEEDBACK_TIPOS,
  type FeedbackEstado,
  type FeedbackPrioridad,
  type FeedbackTipo,
} from "@/lib/validation/feedback"

type QueryValue = string | string[] | undefined

export interface FeedbackListQuery {
  q: string
  estado?: FeedbackEstado
  tipo?: FeedbackTipo
  priority?: FeedbackPrioridad
}

function readSingle(value: QueryValue): string {
  return typeof value === "string" ? value : ""
}

function readEnum<T extends readonly string[]>(value: QueryValue, values: T): T[number] | undefined {
  const candidate = readSingle(value)
  return values.includes(candidate) ? candidate as T[number] : undefined
}

/** Parses URL filters at the page boundary. Invalid values are ignored. */
export function parseFeedbackListParams(searchParams: Record<string, QueryValue>): FeedbackListQuery {
  return {
    q: readSingle(searchParams.q).trim().slice(0, 120),
    estado: readEnum(searchParams.estado, FEEDBACK_ESTADOS),
    tipo: readEnum(searchParams.tipo, FEEDBACK_TIPOS),
    priority: readEnum(searchParams.prioridad, FEEDBACK_PRIORIDADES),
  }
}
