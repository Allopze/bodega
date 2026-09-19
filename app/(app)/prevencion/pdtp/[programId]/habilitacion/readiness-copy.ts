/**
 * Los nombres que ve el prevencionista.
 *
 * Vivían en `lib/services/pdtp/lifecycle.ts`, dentro de un servicio que corre
 * en las compuertas de envío y activación. Ajustar una palabra obligaba a tocar
 * lógica de dominio y a correr tests con Postgres, así que en la práctica nunca
 * se ajustaban: el panel mostraba «CON INSTRUMENTO DECLARADO PERO NO VIGENTE
 * (PLANTILLA, CURSO O PLAN SIN APROBAR/PUBLICAR)» en mayúsculas sostenidas, y
 * «Flujo segregado válido», que es vocabulario de la arquitectura del sistema y
 * no del oficio.
 *
 * Regla de redacción: nombrar el **hueco**, no el mecanismo interno. El
 * operador sabe qué es una plantilla, un curso y un plan de emergencia; no
 * tiene por qué saber qué es un enganche, un flujo segregado ni una compuerta.
 */

import type { PdtpCoverageInstrument } from "@/lib/services/pdtp/instrument-gap"
import type { PdtpFulfillmentCoverageIssue } from "@/lib/services/prevention-pdtp"

type CoverageStatus = PdtpFulfillmentCoverageIssue["status"]

export type ReadinessGroupCopy = {
  /** Título del grupo. Frase nominal corta, sin mayúsculas sostenidas. */
  title: string
  /** Se muestra **una vez** por grupo, no por fila: es la explicación de clase
   *  que antes se repetía idéntica en las catorce filas. */
  blurb: string
}

const GROUP_COPY: Record<CoverageStatus, ReadinessGroupCopy> = {
  ready: {
    title: "Listas",
    blurb: "Tienen dónde ejecutarse y quién las acredita.",
  },
  code_gap: {
    title: "Sin forma de dejar constancia",
    blurb: "No hay ningún registro en la plataforma que pueda dar por hecha esta actividad. Hay que definirlo antes de firmar el programa.",
  },
  destination_not_configured: {
    title: "Sin pantalla donde realizarlas",
    blurb: "La actividad no apunta a ninguna pantalla donde ejecutarla. Se elige en el editor del programa.",
  },
  permission_gap: {
    title: "Sin responsable asignado",
    blurb: "Ningún cargo del catálogo de responsables quedó asociado a la actividad.",
  },
  executor_required: {
    title: "Sin quién la ejecute",
    blurb: "Falta asignar al menos un cargo que pueda registrar el hecho en la pantalla de destino.",
  },
  executor_permission_gap: {
    title: "Con un ejecutor que no puede registrarla",
    blurb: "Los cargos asignados no tienen el permiso que la pantalla de destino exige.",
  },
  config_required: {
    title: "Sin declarar en la faena",
    blurb: "Su número no está declarado en ninguna plantilla, curso, campaña, plan o tipo de documento de estas faenas.",
  },
  instrument_required: {
    title: "Con el instrumento sin aprobar",
    blurb: "La plantilla, el curso o el plan que las respalda existe pero todavía no está aprobado ni publicado. Mientras siga así, la actividad no acredita.",
  },
  decision_required: {
    title: "Sin saber a cuántas personas alcanza",
    blurb: "Se miden por cobertura, así que necesitan el número de personas esperadas por faena.",
  },
  segregated_valid: {
    title: "Las acredita un tercero",
    blurb: "El contrato separa quién hace y quién firma. No necesitan un ejecutor de este programa.",
  },
}

export function readinessGroupCopy(status: CoverageStatus): ReadinessGroupCopy {
  // El Record esta completo por tipo; el fallback es por `noUncheckedIndexedAccess`.
  return GROUP_COPY[status] ?? GROUP_COPY.ready
}

/** Etiqueta del tipo de instrumento, para la columna "Qué falta". */
export function instrumentKindLabel(instrument: PdtpCoverageInstrument): string {
  if (instrument.kind === "inspection_template") return "Plantilla"
  if (instrument.kind === "training_catalog_item") return "Actividad del catálogo"
  return "Plan de emergencia"
}

/** El código legible del instrumento, o las faenas cuando es por faena. */
export function instrumentCode(instrument: PdtpCoverageInstrument): string {
  if (instrument.kind === "inspection_template") return instrument.code
  if (instrument.kind === "training_catalog_item") return instrument.code
  const withPlan = instrument.worksites.find((worksite) => worksite.planCode)
  return withPlan?.planCode ?? "Sin crear"
}

const INSTRUMENT_STATE_LABELS: Record<string, string> = {
  draft: "En borrador",
  in_review: "En revisión",
  observed: "Observada",
  approved: "Aprobada, sin publicar",
  published: "Publicada",
  superseded: "Reemplazada",
  archived: "Archivada",
}

/** Estado del instrumento en lenguaje del oficio, para su propia columna. */
export function instrumentStateLabel(instrument: PdtpCoverageInstrument): string {
  if (instrument.kind === "inspection_template") {
    return INSTRUMENT_STATE_LABELS[instrument.status] ?? instrument.status
  }
  if (instrument.kind === "training_catalog_item") return "Dada de baja"
  const missing = instrument.worksites.filter((worksite) => !worksite.planId).length
  if (missing === instrument.worksites.length) return "Sin crear"
  return "En borrador"
}

/**
 * El motivo **de esta fila**, no el de su grupo.
 *
 * El defecto reportado: las catorce filas del grupo `instrument_required`
 * mostraban la misma frase palabra por palabra, porque el servicio no sabía
 * cuál instrumento era. Ahora sí lo sabe y el motivo lo dice; `issue.reason`
 * queda de respaldo para las clasificaciones que no llevan instrumento.
 */
export function readinessRowReason(issue: PdtpFulfillmentCoverageIssue): string {
  const instruments = issue.instruments ?? []
  if (instruments.length === 0) return issue.reason

  if (instruments.length === 1) {
    const only = instruments[0]!
    if (only.kind === "inspection_template") {
      return `Plantilla ${only.code} ${only.versionLabel} ${(INSTRUMENT_STATE_LABELS[only.status] ?? only.status).toLocaleLowerCase("es-CL")}`
    }
    if (only.kind === "training_catalog_item") {
      return `Actividad ${only.code} dada de baja del catálogo anual`
    }
    const names = only.worksites.map((worksite) => worksite.name)
    return `Sin plan aprobado en ${listNames(names)}`
  }

  // Varios caminos: se enumeran los tipos, y la fila deja claro que basta uno.
  const kinds = instruments.map(instrumentKindLabel)
  return `${listNames(kinds)}: resolver cualquiera habilita la actividad`
}

function listNames(names: string[]): string {
  if (names.length === 0) return ""
  if (names.length === 1) return names[0]!
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`
  return `${names.slice(0, 2).join(", ")} y ${names.length - 2} faenas más`
}

/** Las faenas afectadas, para su columna. `null` = la actividad no es por faena. */
export function affectedWorksiteNames(issue: PdtpFulfillmentCoverageIssue): string[] | null {
  const plan = issue.instruments?.find((instrument) => instrument.kind === "emergency_plan")
  if (!plan) return null
  return plan.worksites.map((worksite) => worksite.name)
}

/**
 * Vocabulario que no debe llegar a la pantalla.
 *
 * Se exporta para que el test lo pueda barrer sobre lo renderizado: una lista
 * que sólo vive en un comentario se incumple en el siguiente cambio.
 */
export const READINESS_FORBIDDEN_JARGON = [
  "flujo segregado",
  "ciclo de vida",
  "no acredita hasta resolverse",
  "destino operativo",
  "mecanismo de acreditación",
  "enganche",
  "compuerta",
]
