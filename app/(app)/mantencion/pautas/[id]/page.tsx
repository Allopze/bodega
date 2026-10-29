import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { ScheduleEditor } from "@/components/mantencion/jefatura/pautas/schedule-editor"
import { can, requirePermission } from "@/lib/auth/can"
import { listAssignCandidates } from "@/lib/services/mantencion/schedule-assign"
import { loadScheduleEditor } from "@/lib/services/mantencion/schedules"

export const metadata: Metadata = { title: "Editor de pauta" }
export const dynamic = "force-dynamic"

export default async function ScheduleEditorPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try {
    session = await requirePermission("mant:schedules:manage")
  } catch {
    redirect("/forbidden")
  }
  const { id } = await params
  const [model, assign] = await Promise.all([loadScheduleEditor(id), listAssignCandidates(id)])
  if (!model || !assign) notFound()
  return <ScheduleEditor model={model} candidates={assign.candidates} canExport={can(session, "mant:export")} />
}
