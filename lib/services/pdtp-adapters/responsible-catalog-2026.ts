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

/**
 * Nombre visible por slug. Son cargos, no áreas: la planilla abrevia ("JDPR",
 * "SUP") y nombraba departamentos ("Jefatura de terreno"); aquí se expanden al
 * título de la persona responsable, que es como aparece en la UI y el Excel
 * exportado. Cambiar un valor exige migrar `pdtp_activities.responsible_display`
 * (está denormalizado) — ver `0137_pdtp_responsible_names.sql`.
 */
const DISPLAY_NAME_BY_SLUG: Record<string, string> = {
  conductores_operadores_choferes: "Conductores, operadores y choferes",
  admin_contrato:                  "Administrador de contrato",
  subgerente_operaciones:          "Subgerente de operaciones",
  gerente_legal_rrhh:              "Gerencia Legal y Recursos Humanos",
  jdpr:                            "Jefe del Departamento de Prevención de Riesgos",
  prf:                             "Prevencionista de riesgos en faena",
  sup:                             "Supervisor de terreno",
  jt:                              "Jefe de terreno",
  cphs:                            "Comité Paritario de Higiene y Seguridad",
  jm:                              "Jefe de mantención",
}

export function displayNameForSlug(slug: string, fallback: string) {
  return DISPLAY_NAME_BY_SLUG[slug] ?? fallback
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
