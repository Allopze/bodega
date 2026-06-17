import { redirect } from "next/navigation"

export default async function ServicioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/solicitudes/${id}`)
}
