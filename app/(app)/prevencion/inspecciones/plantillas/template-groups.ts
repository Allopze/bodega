/**
 * Una fila por instrumento.
 *
 * El catálogo guardaba una fila por VERSIÓN: un instrumento con tres versiones
 * ocupaba tres filas con el mismo nombre, y la que se usa de verdad se perdía
 * entre las reemplazadas. Acá se agrupa por código:
 *
 * - la fila principal es la versión aprobada o, si no hay ninguna, el último
 *   borrador;
 * - un borrador que convive con una aprobada no es otro instrumento: es «la
 *   nueva versión», y se pinta como subfila de la principal;
 * - lo reemplazado y lo retirado sale de la tabla y se lee en la vista previa
 *   (su historial de versiones). Quien las busca las pide con
 *   `?estado=superseded`, donde la lista es plana.
 *
 * `templates` debe venir como lo entrega `listInspectionTemplates`: por código y,
 * dentro de cada código, la más reciente primero. «El último borrador» es el
 * primero que aparece, porque el tipo de la fila no trae su fecha de creación.
 */
export type TemplateGroup<T> = {
  /** El código del instrumento: identifica el grupo. */
  key: string
  /** La fila principal. En lista plana es la propia versión. */
  primary: T
  /** Un borrador nuevo que convive con una versión aprobada. */
  pendingDraft: T | null
}

type Groupable = { id: string; code: string; status: string }

/** El valor de `?estado=` que pide la lista plana de una sola clase de versión. */
export type TemplateStatusFilter = "all" | "draft" | "approved" | "superseded" | (string & {})

export function groupTemplatesByInstrument<T extends Groupable>(
  templates: readonly T[],
  estado: TemplateStatusFilter = "all",
): TemplateGroup<T>[] {
  // Con un estado pedido la lista es plana: cada versión de ese estado es una fila.
  if (estado !== "all") {
    return templates
      .filter((template) => template.status === estado)
      .map((template) => ({ key: template.code, primary: template, pendingDraft: null }))
  }

  const order: string[] = []
  const byCode = new Map<string, { approved: T | null; draft: T | null }>()
  for (const template of templates) {
    let entry = byCode.get(template.code)
    if (!entry) {
      entry = { approved: null, draft: null }
      byCode.set(template.code, entry)
      order.push(template.code)
    }
    if (template.status === "approved" && !entry.approved) entry.approved = template
    // El primero que aparece es el más reciente (ver la nota de arriba).
    if (template.status === "draft" && !entry.draft) entry.draft = template
  }

  const groups: TemplateGroup<T>[] = []
  for (const code of order) {
    const { approved, draft } = byCode.get(code)!
    if (approved) groups.push({ key: code, primary: approved, pendingDraft: draft })
    else if (draft) groups.push({ key: code, primary: draft, pendingDraft: null })
    // Un instrumento que sólo tiene versiones reemplazadas o retiradas no tiene
    // fila: está en «Reemplazadas o retiradas».
  }
  return groups
}

/** Cuántas versiones reemplazadas o retiradas quedan fuera de la tabla. */
export function countHiddenVersions(templates: readonly Groupable[], estado: TemplateStatusFilter = "all"): number {
  return estado === "all" ? templates.filter((template) => template.status === "superseded").length : 0
}
