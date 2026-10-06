import { redirect } from "next/navigation"

/**
 * `/bodega/trazabilidad` pasó a ser `/seguimiento` (Adquisiciones › Seguimiento
 * de solicitudes). La URL vieja sigue viva porque está en favoritos, correos y
 * enlaces de documentos ya emitidos; se conserva la query completa (pestañas,
 * faena y filtros).
 */
export default async function TrazabilidadMovidaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (value === undefined) continue
    if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry))
    else params.set(key, value)
  }
  const query = params.toString()
  redirect(query ? `/seguimiento?${query}` : "/seguimiento")
}
