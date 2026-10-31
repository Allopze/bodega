interface Option { id: string; name: string }

/**
 * Faena y punto con que arranca el registro. Sólo se ofrecen las faenas con al
 * menos un punto de carga activo: elegir una sin puntos dejaba el paso 1 sin
 * salida y, si la persona tenía una sola faena operable entre varias, impedía
 * dejarla elegida sin preguntar. La faena y el punto de la URL valen sólo si
 * están entre esas opciones; si no, una faena sola o un punto solo quedan elegidos.
 */
export function resolveRegistrarSelection(input: {
  worksites: readonly Option[]
  points: ReadonlyArray<Option & { worksiteId: string }>
  requestedWorksiteId: string
  requestedPointId: string
  /** `false` si no se pudieron leer los puntos: entonces se ofrecen todas las faenas. */
  pointsKnown?: boolean
}): { worksites: Option[]; worksiteId: string; pointId: string } {
  const operable = input.pointsKnown === false
    ? [...input.worksites]
    : input.worksites.filter((worksite) => input.points.some((point) => point.worksiteId === worksite.id))
  const worksiteId = operable.some((worksite) => worksite.id === input.requestedWorksiteId)
    ? input.requestedWorksiteId
    : operable.length === 1 ? operable[0]!.id : ""
  const worksitePoints = input.points.filter((point) => point.worksiteId === worksiteId)
  const pointId = worksitePoints.some((point) => point.id === input.requestedPointId)
    ? input.requestedPointId
    : worksitePoints.length === 1 ? worksitePoints[0]!.id : ""
  return { worksites: operable, worksiteId, pointId }
}
