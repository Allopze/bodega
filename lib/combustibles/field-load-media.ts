/**
 * Medio de suministro sugerido por el lugar de carga (C-01): se preselecciona
 * solo cuando es evidente, para que el operador no tenga que elegirlo cada vez.
 * Evidente = hay un único medio activo, o el nombre del lugar de carga contiene
 * el nombre de exactamente un medio («Surtidor CMPC» → CMPC).
 *
 * Se compara con `matchName` (el nombre del catálogo) y no con `name` (el de pantalla): el medio TAE
 * se ve como «Vasija (carga Copec)» pero el lugar se llama «Surtidor TAE». Con el nombre de pantalla
 * la sugerencia dejó de funcionar para los medios Copec el 2026-11-16.
 */
function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleUpperCase("es-CL").replace(/\s+/g, " ").trim()
}

export function suggestSupplyMedium(
  loadingPointName: string | null | undefined,
  media: ReadonlyArray<{ id: string; name: string; matchName?: string }>,
): string | null {
  if (media.length === 1) return media[0]!.id
  if (!loadingPointName) return null
  const point = fold(loadingPointName)
  const matches = media.filter((medium) => {
    const name = fold(medium.matchName ?? medium.name)
    return name.length >= 3 && point.includes(name)
  })
  return matches.length === 1 ? matches[0]!.id : null
}
