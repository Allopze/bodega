import { redirect } from "next/navigation"

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/

function plainDate(value: string | string[] | undefined) {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim()
  return raw && PLAIN_DATE.test(raw) ? raw : undefined
}

/**
 * Vista retirada: «Reportes de combustible» leía la tabla legada `fuel_loads` y
 * nada enlazaba a ella. El análisis por período, faena y equipo vive en
 * «Consumo y rendimiento»; se conserva la ruta y el rango de fechas para los
 * favoritos antiguos.
 */
export default async function ReportesRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = new URLSearchParams({ vista: "analisis" })
  const desde = plainDate(sp.desde)
  const hasta = plainDate(sp.hasta)
  if (desde) params.set("desde", desde)
  if (hasta) params.set("hasta", hasta)
  redirect(`/combustibles?${params.toString()}`)
}
