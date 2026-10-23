import { redirect } from "next/navigation"
import { legacyAnalysisTarget } from "./redirect-target"

/**
 * Vista retirada: el análisis de rendimiento por familia (R-01 a R-06) se
 * implementó en `/combustibles/control/rendimiento/[familia]` y esta pantalla
 * quedó superada. Se conserva sólo la ruta para los enlaces y favoritos antiguos.
 */
export default async function AnalisisRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(legacyAnalysisTarget(await searchParams))
}
