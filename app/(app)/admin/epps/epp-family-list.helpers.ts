export interface EppFamilyHealthInput {
  eppTypeId: string | null
  lifespanMonths: number | null
  lifespanNotApplicable: boolean
  certification: string | null
  brand: string | null
  model: string | null
}

const blank = (value: string | null) => !value || value.trim() === ""

/**
 * Advertencias de una familia EPP, ordenadas por consecuencia.
 *
 * /admin/productos ya avisaba de precio, proveedor y atributos faltantes
 * (`getProductWarnings`); esta pantalla no avisaba de nada, aunque sus campos
 * vacíos pesan más: sin `eppTypeId` la familia es invisible para
 * `computeEppCoverageGaps` y ninguna de sus entregas acredita a nadie.
 */
export function getEppFamilyWarnings(family: EppFamilyHealthInput): string[] {
  const warnings: string[] = []
  if (!family.eppTypeId) warnings.push("Sin tipo de EPP: sus entregas no acreditan cobertura")
  // La bandera es justamente lo que evita el ruido perpetuo sobre el EPP que
  // no vence por diseño (casco, arnés sin fecha fija).
  if (family.lifespanMonths == null && !family.lifespanNotApplicable) {
    warnings.push("Sin vida útil definida: sus entregas nunca vencen")
  }
  if (blank(family.certification)) warnings.push("Sin certificación registrada")
  if (blank(family.brand) && blank(family.model)) warnings.push("Sin marca ni modelo")
  return warnings
}

/** "Sin definir" (nadie llenó el campo) y "No vence" (decisión) no son lo mismo. */
export function formatLifespan(lifespanMonths: number | null, lifespanNotApplicable: boolean): string {
  if (lifespanMonths != null) return `${lifespanMonths} ${lifespanMonths === 1 ? "mes" : "meses"}`
  return lifespanNotApplicable ? "No vence" : "Sin definir"
}
