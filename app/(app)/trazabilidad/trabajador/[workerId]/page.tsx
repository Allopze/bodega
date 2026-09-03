import { redirect } from "next/navigation"

export default async function TrazabilidadTrabajadorRedirectPage({
  params,
}: {
  params: Promise<{ workerId: string }>
}) {
  const { workerId } = await params
  redirect(`/bodega/trazabilidad/trabajador/${workerId}`)
}
