/**
 * lib/prevention/cgrd.ts
 * Helpers puros del CGRD (G15, DS 44): labels y el umbral comité/coordinador.
 * Vive aparte para que las reglas se puedan probar sin PGlite.
 */

export type GrdMatrixStatus = "draft" | "published" | "superseded"
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
  published: "Publicada",
  superseded: "Reemplazada",
}

export const GRD_COMMITTEE_STATUS_LABELS: Record<GrdCommitteeStatus, string> = {
  active: "Vigente",
  dissolved: "Disuelto",
  expired: "Vencido",
}
