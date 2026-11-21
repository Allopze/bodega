import { nameKey } from "@/lib/mantencion/normalize"

/**
 * Resuelve el texto de faena que trae una planilla o un formulario
 * (2026-11-21, Trinorma). Contrato compartido por todos los importadores:
 *
 * 1. Nombre exacto, comparado con `nameKey` (sin tildes ni mayúsculas).
 * 2. Alias registrado en `worksite_aliases` («Horcones» → Arauco).
 * 3. Si no, `null`: la fila conserva su texto y queda «faena sin identificar».
 *
 * Nunca adivina por parecido, y un nombre que coincide con dos faenas tampoco
 * se resuelve: dos faenas con el mismo nombre (una activa y otra cerrada) son
 * un dato que hay que corregir, no algo que el importador decida.
 */

export interface ResolvableWorksite { id: string; name: string }
export interface ResolvableAlias { worksiteId: string; aliasKey: string }

export function resolveWorksiteId(
  text: string | null | undefined,
  sites: readonly ResolvableWorksite[],
  aliases: readonly ResolvableAlias[],
): string | null {
  const key = nameKey(text ?? "")
  if (!key) return null
  const exact = sites.filter((site) => nameKey(site.name) === key)
  if (exact.length === 1) return exact[0]!.id
  if (exact.length > 1) return null
  const alias = aliases.filter((entry) => entry.aliasKey === key)
  if (alias.length !== 1) return null
  return sites.some((site) => site.id === alias[0]!.worksiteId) ? alias[0]!.worksiteId : null
}

/** Clave que se guarda en `worksite_aliases.alias_key`. */
export function worksiteAliasKey(aliasText: string): string {
  return nameKey(aliasText)
}
