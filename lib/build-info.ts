/**
 * lib/build-info.ts — Qué build está corriendo, igual en el servidor y en el cliente.
 *
 * Antes la versión salía de `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`, una variable de
 * ejecución que el deploy nunca fijaba: en prod la app del mecánico grababa
 * `app_version = "dev"` y los respaldos `"unknown"`, y un componente de cliente
 * no la habría visto nunca (Next incrusta `NEXT_PUBLIC_*` al compilar).
 *
 * Ahora `next.config.ts` fija los dos valores en `env` al compilar:
 * - `NEXT_PUBLIC_BUILD_SHA`: el sha corto que `scripts/deploy-prod.sh` pasa como
 *   `--build-arg BODEGA_BUILD_SHA` (vacío en un build a mano o en `next dev`).
 * - `NEXT_PUBLIC_BUILD_TIME`: la hora en que se compiló.
 *
 * Se leen con `process.env.X` literal, sin desestructurar: Next reemplaza el
 * texto exacto en el bundle.
 */
import { formatDateTime } from "@/lib/utils"

export const BUILD_SHA: string = process.env.NEXT_PUBLIC_BUILD_SHA ?? ""
export const BUILD_TIME: string = process.env.NEXT_PUBLIC_BUILD_TIME ?? ""
/** Lo que se compara para saber si un teléfono corre una versión atrasada. */
export const BUILD_ID: string = BUILD_SHA || BUILD_TIME || "dev"

/**
 * Rótulo legible de una versión: «22-11-2026 14:05 · 3f9c2a1b7d0e». Si la versión
 * es la misma hora del build (no hubo sha), sólo la fecha.
 */
export function buildLabel(builtAt: string | null, version: string): string {
  if (!builtAt) return "Desconocida"
  const when = formatDateTime(builtAt)
  // Sin sha, la versión ES la hora del build; la base la devuelve en otro formato
  // («2026-11-23 01:04:56.101+00»), así que se compara el instante y no el texto.
  const sameInstant = Date.parse(version) === Date.parse(builtAt)
  return version && version !== builtAt && !sameInstant ? `${when} · ${version}` : when
}
