import { redirect } from "next/navigation"

/** Compatibilidad con marcadores: el alta libre del catálogo ya no es el flujo operativo. */
export default async function LegacyTrainingCatalogPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}): Promise<never> {
  const params = await searchParams
  const nextParams = new URLSearchParams()
  for (const key of ["faena", "year"]) {
    const value = params?.[key]
    if (typeof value === "string" && value) nextParams.set(key, value)
    else if (Array.isArray(value) && value[0]) nextParams.set(key, value[0])
  }
  const query = nextParams.toString()
  redirect(query ? `/prevencion/capacitacion?${query}` : "/prevencion/capacitacion")
}
