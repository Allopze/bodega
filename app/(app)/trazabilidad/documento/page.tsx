import { redirect } from "next/navigation"

export default async function TrazabilidadDocumentoRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ codigo?: string }>
}) {
  const { codigo } = await searchParams
  const query = codigo ? `&codigo=${encodeURIComponent(codigo)}` : ""
  redirect(`/seguimiento?tab=documento${query}`)
}
