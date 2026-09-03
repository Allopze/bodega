import { redirect } from "next/navigation"

export default async function TrazabilidadRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (v !== undefined && v !== null) {
      if (Array.isArray(v)) v.forEach((val) => params.append(k, val))
      else params.set(k, v)
    }
  }
  const query = params.toString()
  redirect(query ? `/bodega/trazabilidad?${query}` : "/bodega/trazabilidad")
}
