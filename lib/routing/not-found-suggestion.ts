import { levenshtein } from "@/lib/levenshtein"
import type { NavTarget } from "@/components/layout/nav-items"

/**
 * Qué ofrecerle a quien cae en un 404.
 *
 * La misma pantalla atiende dos causas que no se parecen: una ruta que no
 * existe (bookmark viejo, enlace roto, typo) y un registro que sí tenía una
 * ruta válida pero ya no está —borrado o fuera del alcance de faenas de la
 * sesión—. En el segundo caso mandar al usuario a una grilla de módulos le hace
 * rehacer el camino: lo útil es el listado dueño de la ruta.
 *
 * Los destinos entran ya filtrados por permiso y por módulos habilitados
 * (`flattenNavTargets`), así que nunca se sugiere una pantalla que terminaría
 * en /forbidden.
 */
export type NotFoundSuggestion =
  | { kind: "record"; target: NavTarget }
  | { kind: "typo";   target: NavTarget }
  | { kind: "unknown" }

function normalize(value: string): string {
  return value
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

function firstSegment(path: string): string {
  return path.split("/").filter(Boolean)[0] ?? ""
}

/** Claves comparables de un destino: su primer segmento y su etiqueta sin espacios. */
function keysOf(target: NavTarget): string[] {
  return [firstSegment(target.href), normalize(target.label).replace(/\s+/g, "")]
}

export function resolveNotFound(
  pathname: string | null | undefined,
  targets: NavTarget[],
): NotFoundSuggestion {
  const rawPath = (pathname ?? "").split("?")[0]!.split("#")[0]!
  const path = normalize(rawPath)
  const segment = firstSegment(path)
  if (!segment) return { kind: "unknown" }

  // 1. Registro o subruta de un módulo que el usuario sí puede abrir: gana el
  //    href más específico. Se exige que la ruta sea *más profunda* que el
  //    destino, porque si el 404 lo lanzó el listado mismo, "volver" devolvería
  //    a la pantalla que acaba de fallar.
  let owner: NavTarget | null = null
  for (const target of targets) {
    if (!path.startsWith(`${target.href}/`)) continue
    if (!owner || target.href.length > owner.href.length) owner = target
  }
  if (owner) return { kind: "record", target: owner }

  // 2. Sin dueño: el primer segmento puede ser un typo, o un módulo cuya
  //    subruta ya no existe (distancia 0 contra su primer segmento). Segmentos
  //    de 1–2 letras se descartan: cualquier sugerencia sería ruido.
  if (segment.length < 3) return { kind: "unknown" }
  const tolerance = segment.length <= 5 ? 1 : 2
  let best: { target: NavTarget; distance: number } | null = null
  for (const target of targets) {
    // Se compara contra la ruta cruda: `/bodéga` sí merece sugerir Bodega, pero
    // sugerir `/bodega` a quien viene de `/bodega` cierra un bucle.
    if (target.href === rawPath) continue
    for (const key of keysOf(target)) {
      const distance = levenshtein(segment, key)
      if (distance > tolerance) continue
      if (!best || distance < best.distance) best = { target, distance }
    }
  }
  return best ? { kind: "typo", target: best.target } : { kind: "unknown" }
}
