import { redirect } from "next/navigation"

export default async function DocumentoRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ codigo?: string }>
}) {
  const { codigo } = await searchParams
  const query = codigo ? `&codigo=${encodeURIComponent(codigo)}` : ""
  redirect(`/bodega/trazabilidad?tab=documento${query}`)
}
