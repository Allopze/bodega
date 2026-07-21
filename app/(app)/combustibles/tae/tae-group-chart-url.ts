/** Añade el grupo seleccionado al enlace base de la bitácora sin perder sus filtros. */
export function buildTaeGroupDrilldownHref(baseHref: string, group: string) {
  const separator = baseHref.includes("?") ? "&" : "?"
  return `${baseHref}${separator}${new URLSearchParams({ q: group }).toString()}`
}
