/**
 * Carga por responsable: cuánta cantidad planificada recae sobre cada rol o
 * grupo de responsables del catálogo, agregada por posición de semana
 * (1-4, sumada a través de todos los meses del horizonte) y por mes (1-12,
 * sumada a través de las semanas de ese mes).
 *
 * Módulo puro — sin base de datos, sin React — pensado para correr en el
 * cliente sobre los valores *vivos* de la matriz de planificación (incluidos
 * cambios sin guardar todavía), no sobre una consulta nueva al servidor. El
 * panel que lo consume (`role-load-panel.tsx`) le pasa exactamente lo que la
 * pestaña de planificación tiene en memoria en ese momento.
 *
 * Decisión deliberada: una actividad con dos responsables (`responsibleSlugs:
 * ["sup", "jt"]`) suma su cantidad planificada a AMBOS roles, no la reparte.
 * Es la lectura correcta de "quién debe estar disponible para que esto
 * ocurra" — la actividad no se hace a medias si falta uno de los dos — pero
 * tiene una consecuencia que quien lea el panel debe tener presente: la suma
 * de `total` de todas las filas de este panel casi siempre será MAYOR que el
 * total de ocurrencias del programa (que cuenta cada celda una sola vez, sin
 * importar cuántos responsables tenga la actividad). No es un error de
 * conteo, es la naturaleza de "responsables" como conjunto, no partición.
 */
export type PdtpRoleLoadRow = {
  slug: string
  /** Nombre del catálogo de responsables si el slug está en él; el slug
   *  crudo si no (actividad importada o catálogo incompleto) — nunca deja
   *  la fila sin etiqueta legible. */
  displayName: string
  /** Cantidad planificada en la semana N (índice 0 = semana 1 … índice 3 =
   *  semana 4), sumada a través de todos los meses presentes en `cells`. */
  weekly: number[]
  /** Cantidad planificada en el mes N (índice 0 = enero … índice 11 =
   *  diciembre), sumada a través de las semanas de ese mes. */
  monthly: number[]
  /** Suma total de `weekly` (= suma total de `monthly`). */
  total: number
  /** Cuántas actividades del programa tienen a este responsable en su
   *  `responsibleSlugs` — cuenta actividades, no celdas, e incluye las que
   *  todavía no tienen ninguna celda planificada. */
  activityCount: number
}

export type PdtpRoleLoadInput = {
  activities: Array<{ id: string; responsibleSlugs: string[] }>
  cells: Array<{ activityId: string; month: number; week: number; plannedQuantity: number }>
  catalog: Array<{ slug: string; displayName: string }>
}

function clampWeekIndex(week: number): number {
  return Math.min(3, Math.max(0, Math.trunc(week || 1) - 1))
}

function clampMonthIndex(month: number): number {
  return Math.min(11, Math.max(0, Math.trunc(month || 1) - 1))
}

/**
 * Agrega la planificación por responsable. Sin efectos secundarios: no lee
 * ni escribe nada, sólo agrega los datos que se le pasan.
 */
export function computePdtpRoleLoad(input: PdtpRoleLoadInput): PdtpRoleLoadRow[] {
  const catalogNames = new Map(input.catalog.map((entry) => [entry.slug, entry.displayName]))
  const slugsByActivity = new Map(input.activities.map((activity) => [activity.id, activity.responsibleSlugs]))
  const rows = new Map<string, PdtpRoleLoadRow>()

  function ensureRow(slug: string): PdtpRoleLoadRow {
    const existing = rows.get(slug)
    if (existing) return existing
    const created: PdtpRoleLoadRow = {
      slug,
      displayName: catalogNames.get(slug) ?? slug,
      weekly: [0, 0, 0, 0],
      monthly: Array.from({ length: 12 }, () => 0),
      total: 0,
      activityCount: 0,
    }
    rows.set(slug, created)
    return created
  }

  // `activityCount` cuenta actividades, no celdas: se recorre por separado
  // de `cells` para que una actividad sin ninguna celda planificada todavía
  // cuente para su(s) responsable(s).
  for (const activity of input.activities) {
    for (const slug of activity.responsibleSlugs) {
      ensureRow(slug).activityCount += 1
    }
  }

  for (const cell of input.cells) {
    const quantity = Number(cell.plannedQuantity) || 0
    if (quantity <= 0) continue
    const slugs = slugsByActivity.get(cell.activityId)
    if (!slugs || slugs.length === 0) continue
    const weekIndex = clampWeekIndex(cell.week)
    const monthIndex = clampMonthIndex(cell.month)
    for (const slug of slugs) {
      const row = ensureRow(slug)
      // `weekIndex`/`monthIndex` están acotados por `clampWeekIndex`/
      // `clampMonthIndex` a 0..3 y 0..11 respectivamente — dentro del
      // tamaño fijo de `weekly`/`monthly` (`noUncheckedIndexedAccess` no
      // puede saberlo estáticamente).
      row.weekly[weekIndex] = (row.weekly[weekIndex] ?? 0) + quantity
      row.monthly[monthIndex] = (row.monthly[monthIndex] ?? 0) + quantity
      row.total += quantity
    }
  }

  return [...rows.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, "es"))
}
