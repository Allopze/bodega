import { redirect } from "next/navigation"

export default async function TrazabilidadItemRedirectPage({
  params,
}: {
  params: Promise<{ itemId: string }>
}) {
  const { itemId } = await params
  redirect(`/bodega/trazabilidad/${itemId}`)
}
