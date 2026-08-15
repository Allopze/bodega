/* Organización preventiva exigible por dotación.
 *
 * La obligación no es uniforme: sobre 25 trabajadores propios corresponde
 * Comité Paritario; entre 10 y 25 corresponde Delegado de Seguridad y Salud en
 * el Trabajo cuando no hay CPHS aplicable; bajo 10 no corresponde ninguno de
 * los dos, lo que NO exime de gestión preventiva (MIPER, programa,
 * capacitación, higiene y registros siguen corriendo).
 *
 * Antes este umbral vivía sólo dentro del PDTP como una condición binaria
 * (`PDTP_CPHS_MIN_HEADCOUNT`, ≥25 o nada) que servía para excluir la actividad
 * N°11 en las faenas chicas. El tramo del delegado no existía en el sistema.
 */

export const CPHS_MIN_HEADCOUNT = 25
export const DELEGATE_MIN_HEADCOUNT = 10

export type PreventiveOrganization = "cphs" | "delegate" | "none"

export const PREVENTIVE_ORGANIZATION_LABELS: Record<PreventiveOrganization, string> = {
  cphs: "Comité Paritario propio",
  delegate: "Delegado de Seguridad y Salud en el Trabajo",
  none: "Sin órgano exigible por dotación",
}

export const DELEGATE_STATUS_LABELS: Record<string, string> = {
  active: "Vigente",
  ended: "Terminado",
}

/**
 * Qué órgano exige la dotación. `headcount` es el número de trabajadores
 * propios activos de la faena; los de empresas contratistas no cuentan para
 * esta obligación de Chome.
 */
export function resolvePreventiveOrganization(headcount: number): PreventiveOrganization {
  if (headcount > CPHS_MIN_HEADCOUNT) return "cphs"
  if (headcount >= DELEGATE_MIN_HEADCOUNT) return "delegate"
  return "none"
}

export interface OrganizationComplianceInput {
  headcount: number
  hasActiveCommittee: boolean
  hasActiveDelegate: boolean
}

export interface OrganizationCompliance {
  required: PreventiveOrganization
  compliant: boolean
  detail: string
}

/**
 * Un comité vigente satisface también el tramo del delegado: la norma pide
 * delegado *cuando no exista CPHS aplicable*, no además del comité. Al revés no
 * vale — un delegado no reemplaza al comité donde el comité es exigible.
 */
export function assessOrganizationCompliance(input: OrganizationComplianceInput): OrganizationCompliance {
  const required = resolvePreventiveOrganization(input.headcount)

  if (required === "cphs") {
    return input.hasActiveCommittee
      ? { required, compliant: true, detail: "Comité Paritario vigente." }
      : {
          required,
          compliant: false,
          detail: `La faena tiene ${input.headcount} trabajadores y no registra Comité Paritario vigente.`,
        }
  }

  if (required === "delegate") {
    if (input.hasActiveCommittee) {
      return { required, compliant: true, detail: "Comité Paritario vigente; cubre la exigencia de delegado." }
    }
    return input.hasActiveDelegate
      ? { required, compliant: true, detail: "Delegado de Seguridad y Salud vigente." }
      : {
          required,
          compliant: false,
          detail: `La faena tiene ${input.headcount} trabajadores y no registra delegado vigente ni Comité Paritario.`,
        }
  }

  return {
    required,
    compliant: true,
    detail: `La faena tiene ${input.headcount} trabajadores: no corresponde comité ni delegado por dotación.`,
  }
}
