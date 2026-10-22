/**
 * Medio de suministro sugerido por el lugar de carga (C-01): se preselecciona
 * solo cuando es evidente, para que el operador no tenga que elegirlo cada vez.
 * Evidente = hay un único medio activo, o el nombre del lugar de carga contiene
 * el nombre de exactamente un medio («Surtidor CMPC» → CMPC).
 */
function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleUpperCase("es-CL").replace(/\s+/g, " ").trim()
}

export function suggestSupplyMedium(
  loadingPointName: string | null | undefined,
  media: ReadonlyArray<{ id: string; name: string }>,
): string | null {
  if (media.length === 1) return media[0]!.id
  if (!loadingPointName) return null
  const point = fold(loadingPointName)
  const matches = media.filter((medium) => {
    const name = fold(medium.name)
    return name.length >= 3 && point.includes(name)
  })
  return matches.length === 1 ? matches[0]!.id : null
}
