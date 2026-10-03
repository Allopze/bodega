/**
 * «Riesgos críticos sin control» (Fase B): UNA definición para el KPI del
 * tablero (`getRiskDashboard` → `prevention-section.tsx`) y para la portada
 * MIPER (`listMiperPortfolio`). Así las dos pantallas dicen la misma cifra.
 *
 * - **Crítico:** Intolerable en el RE-04 o, en una fila legacy sin
 *   clasificación, marcada `isCritical`.
 * - **Sin control:** le falta una medida implementada o verificada, **o** le
 *   falta una medida con vínculo PDTP activo (`prevention_pdtp_source_links`,
 *   `source_type = 'risk_control'`). Basta que falte una de las dos. Es el
 *   criterio que el tablero ya aplicaba en `prevention-risk-legal.ts`; se
 *   extrae sin cambiarlo.
 *
 * Sólo cuenta en MIPER vigentes. Ese filtro lo pone quien llama, que es quien
 * sabe qué matrices están publicadas.
 */
export type CriticalCandidate = { classification: string | null; isCritical: boolean }
export type CriticalCandidateControl = { id: string; status: string }

const IN_FORCE: ReadonlySet<string> = new Set(["implemented", "verified"])

export function isCriticalRisk(entry: CriticalCandidate): boolean {
  return entry.classification === "intolerable" || (entry.classification === null && entry.isCritical)
}

export function isCriticalWithoutControl(
  entry: CriticalCandidate,
  controls: readonly CriticalCandidateControl[],
  pdtpLinkedControlIds: ReadonlySet<string>,
): boolean {
  if (!isCriticalRisk(entry)) return false
  return !controls.some((control) => IN_FORCE.has(control.status))
    || !controls.some((control) => pdtpLinkedControlIds.has(control.id))
}
