import type { MantPreventiveSummary } from "./types"

/**
 * Cómo se nombra una preventiva según de dónde sale. La declarada (la última anterior a la
 * plataforma, que jefatura declara con su respaldo) NUNCA se muestra como un registro firmado:
 * lleva siempre este rótulo y su respaldo. La firmada muestra su folio.
 * Módulo puro: lo usan la ficha, la app del mecánico, el Excel y el informe.
 */
export const PRIOR_PREVENTIVE_LABEL = "Declarada, anterior a la plataforma"
export const SIGNED_PREVENTIVE_LABEL = "Firmada"

type OriginInput = Pick<MantPreventiveSummary, "origin" | "evidence"> | null | undefined

export function isDeclaredPreventive(preventive: OriginInput): boolean {
  return preventive?.origin === "declarada"
}

/** «Firmada» o «Declarada, anterior a la plataforma»; vacío si no hay preventiva. */
export function preventiveOriginLabel(preventive: OriginInput): string {
  if (!preventive) return ""
  return isDeclaredPreventive(preventive) ? PRIOR_PREVENTIVE_LABEL : SIGNED_PREVENTIVE_LABEL
}

/** Respaldo de la declarada («Respaldo: OT-123») o folio de la firmada; `null` si no hay nada que decir. */
export function preventiveSupportText(preventive: OriginInput): string | null {
  const evidence = preventive?.evidence?.trim()
  if (!preventive || !evidence) return null
  return isDeclaredPreventive(preventive) ? `Respaldo: ${evidence}` : `Folio ${evidence}`
}
