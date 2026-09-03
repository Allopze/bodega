/**
 * lib/prevention/cgrd.ts
 * Helpers puros del CGRD (G15, DS 44): labels, y la máquina de estados de la
 * matriz GRD que `prevention-cgrd.ts` ejecuta contra la base. Vive aparte
 * para que las reglas de transición se puedan probar sin PGlite.
 */
import type { Permission } from "@/modules/permissions"

export type GrdMatrixStatus = "draft" | "in_review" | "reviewed" | "approved" | "published" | "superseded"
export type GrdMeetingStatus = "scheduled" | "closed" | "cancelled"
export type GrdCommitteeStatus = "active" | "dissolved" | "expired"

/** Órgano que corresponde según la dotación del centro de trabajo. */
export type GrdStructure = "coordinator" | "committee"

/**
 * Dotación desde la cual corresponde comité y no coordinador.
 *
 * DS 44 y la guía de Gestión del Riesgo de Desastres: hasta 25 personas
 * corresponde **designar un Coordinador de Gestión del Riesgo de Desastres**;
 * desde 26 corresponde **constituir el Comité (CGRD)**.
 *
 * No confundir con el **Delegado de Seguridad y Salud en el Trabajo**, que es
 * otra figura, de otro cuerpo normativo, y aplica entre 10 y 25 trabajadores
 * cuando no existe Comité Paritario (`prevention_worksite_delegates`, módulo
 * CPHS). Son órganos distintos y pueden coexistir en la misma faena.
 */
export const GRD_COMMITTEE_MIN_HEADCOUNT = 26

export function resolveGrdStructure(workerCount: number): GrdStructure {
  return workerCount >= GRD_COMMITTEE_MIN_HEADCOUNT ? "committee" : "coordinator"
}

export const GRD_STRUCTURE_LABELS: Record<GrdStructure, string> = {
  coordinator: "Coordinador de Gestión del Riesgo de Desastres",
  committee: "Comité de Gestión del Riesgo de Desastres (CGRD)",
}

/**
 * Si el órgano existente basta para la dotación actual. La norma fija un
 * mínimo, así que sobrecumplir no es incumplir: un comité en una faena de 12
 * personas es válido. Lo que no basta es un coordinador donde corresponde
 * comité — eso sí es una brecha.
 */
export function grdStructureSatisfies(existing: GrdStructure, workerCount: number): boolean {
  return existing === "committee" || resolveGrdStructure(workerCount) === "coordinator"
}

export const GRD_MATRIX_STATUS_LABELS: Record<GrdMatrixStatus, string> = {
  draft: "Borrador",
  in_review: "En revisión",
  reviewed: "Revisada",
  approved: "Aprobada",
  published: "Publicada",
  superseded: "Reemplazada",
}

export const GRD_MEETING_STATUS_LABELS: Record<GrdMeetingStatus, string> = {
  scheduled: "Convocada",
  closed: "Cerrada",
  cancelled: "Cancelada",
}

export const GRD_COMMITTEE_STATUS_LABELS: Record<GrdCommitteeStatus, string> = {
  active: "Vigente",
  dissolved: "Disuelto",
  expired: "Vencido",
}

/**
 * Transiciones válidas de la matriz GRD — misma máquina que la MIPER
 * (`MATRIX_TRANSITIONS` en prevention-risk-legal.ts), incluido el retorno de
 * `in_review` a `draft` (MIPER-10): una versión con una amenaza mal evaluada
 * no debe quedar trabada sin poder corregirse.
 */
export const GRD_MATRIX_TRANSITIONS: Record<GrdMatrixStatus, readonly GrdMatrixStatus[]> = {
  draft: ["in_review"],
  in_review: ["reviewed", "draft"],
  reviewed: ["approved"],
  approved: ["published"],
  published: [],
  superseded: [],
}

export function canTransitionGrdMatrix(from: GrdMatrixStatus, to: GrdMatrixStatus): boolean {
  return GRD_MATRIX_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Qué permiso exige mover la matriz A este estado. 'draft' es la devolución
 * del revisor, no una corrección del editor — por eso pide revisión, no
 * edición (mismo criterio que `MATRIX_PERMISSION` de la MIPER).
 */
export const GRD_MATRIX_TRANSITION_PERMISSION: Record<GrdMatrixStatus, Permission> = {
  draft: "prevention:cgrd:matrix:review",
  in_review: "prevention:cgrd:matrix:edit",
  reviewed: "prevention:cgrd:matrix:review",
  approved: "prevention:cgrd:matrix:approve",
  published: "prevention:cgrd:matrix:publish",
  superseded: "prevention:cgrd:matrix:publish",
}

export function grdMatrixTransitionPermission(toStatus: string): Permission {
  return GRD_MATRIX_TRANSITION_PERMISSION[toStatus as GrdMatrixStatus] ?? "prevention:cgrd:matrix:edit"
}
