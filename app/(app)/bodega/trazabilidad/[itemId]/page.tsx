import { redirect } from "next/navigation"

/** El detalle de ítem se mudó a `/seguimiento/[itemId]`; la URL vieja redirige. */
export default async function TrazabilidadItemMovidoPage({
  params,
}: {
  params: Promise<{ itemId: string }>
}) {
  const { itemId } = await params
  redirect(`/seguimiento/${encodeURIComponent(itemId)}`)
}
