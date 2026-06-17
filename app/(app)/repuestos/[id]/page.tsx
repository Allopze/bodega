import { redirect } from "next/navigation"

export default async function RepuestoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/solicitudes/${id}`)
}
