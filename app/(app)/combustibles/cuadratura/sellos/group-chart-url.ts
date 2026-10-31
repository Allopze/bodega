/** Añade el grupo seleccionado al enlace base de Cargas sin perder sus filtros (período, faena, cómo llegó). */
export function buildTaeGroupDrilldownHref(baseHref: string, group: string) {
  const separator = baseHref.includes("?") ? "&" : "?"
  return `${baseHref}${separator}${new URLSearchParams({ q: group }).toString()}`
}
