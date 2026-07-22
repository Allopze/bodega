/**
 * Traducción de responsables declarados en el archivo de referencia 2026
 * (`admin_contrato`, `jdpr`, `prf`…) a nombres legibles y al catálogo de
 * responsables (`pdtp_responsible_catalog`). Describe el vocabulario fijo
 * de esa plantilla, no el modelo general — un programa nuevo declara sus
 * responsables directamente (`responsibleSlugs`/`responsibleDisplay` por
 * actividad), sin pasar por estos nombres codificados. Consumido solo por
 * el adaptador de importación/bootstrap 2026 (`catalog.ts`, `imports.ts`).
 */
import { ROLE_RESPONSIBLE_SLUGS } from "./sheet-meta-2026"

export function displayNameForSlug(slug: string, fallback: string) {
  if (slug === "conductores_operadores_choferes") return "Conductores, operadores y choferes"
  if (slug === "admin_contrato") return "Administración de contrato"
  if (slug === "subgerente_operaciones") return "Subgerencia de operaciones"
  if (slug === "gerente_legal_rrhh") return "Gerencia Legal y Recursos Humanos"
  if (slug === "jdpr") return "Jefatura del Departamento de Prevención de Riesgos"
  if (slug === "prf") return "Prevencionista de riesgos en faena"
  if (slug === "sup") return "Supervisión de faena"
  if (slug === "jt") return "Jefatura de terreno"
  if (slug === "cphs") return "Comité Paritario de Higiene y Seguridad"
  if (slug === "jm") return "Jefatura de mantenimiento"
  return fallback
}

export function displayNameForActivity(slugs: string[], fallback: string) {
  if (slugs.length === 0) return fallback
  return slugs.map((slug) => displayNameForSlug(slug, slug.replace(/_/g, " "))).join(", ")
}

export function collectResponsibleCatalog(catalog: { activities: Array<{ responsibleSlugs: string[]; responsibleDisplay: string }> }) {
  const bySlug = new Map<string, { slug: string; displayName: string; roleName: string | null; kind: string; notes: string | null }>()
  for (const activity of catalog.activities) {
    for (const slug of activity.responsibleSlugs) {
      if (bySlug.has(slug)) continue
      bySlug.set(slug, {
        slug, displayName: displayNameForSlug(slug, activity.responsibleDisplay),
        roleName: ROLE_RESPONSIBLE_SLUGS.get(slug) ?? null,
        kind: ROLE_RESPONSIBLE_SLUGS.has(slug) ? "rbac_role" : "worker_group",
        notes: "Responsable extraido desde PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx.",
      })
    }
  }
  return [...bySlug.values()]
}
