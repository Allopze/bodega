import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Info } from "@phosphor-icons/react/dist/ssr"
import { Callout } from "@/components/ui/callout"
import { ExportButton } from "@/components/ui/export-button"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { NewScheduleDialog } from "@/components/mantencion/jefatura/pautas/new-schedule-dialog"
import { SchedulesTable } from "@/components/mantencion/jefatura/pautas/schedules-table"
import { can, requirePermission } from "@/lib/auth/can"
import { plural } from "@/lib/mantencion/format"
import { countActiveEquipmentWithoutSchedule, listSchedules } from "@/lib/services/mantencion/schedules"
import { exportSchedulesAction } from "./actions"

export const metadata: Metadata = { title: "Pautas de mantención" }
export const dynamic = "force-dynamic"

export default async function SchedulesPage() {
  let session
  try {
    session = await requirePermission("mant:schedules:manage")
  } catch {
    redirect("/forbidden")
  }
  const [rows, withoutSchedule] = await Promise.all([listSchedules(), countActiveEquipmentWithoutSchedule()])
  return (
    <PageContainer>
      <PageHeader
        title="Pautas de mantención"
        description="Cada pauta define qué revisa el mecánico en cada intervalo. Cada equipo tiene una pauta asignada."
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Pautas" }]}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {can(session, "mant:export") && <ExportButton action={exportSchedulesAction} label="Exportar a Excel" />}
            <NewScheduleDialog schedules={rows.map((row) => ({ id: row.id, name: row.name, unit: row.unit }))} />
          </div>
        )}
      />
      <div className="flex flex-col gap-4">
        {withoutSchedule > 0 && (
          <Callout tone="warning" icon={<Info size={16} />} title={`${plural(withoutSchedule, "equipo activo está", "equipos activos están")} sin pauta`}>
            El mecánico no podrá registrarles una mantención preventiva.{" "}
            <Link href="/mantencion/equipos?pauta=sin" className="font-semibold underline underline-offset-2">Ver cuáles</Link>
          </Callout>
        )}
        <SchedulesTable rows={rows} />
      </div>
    </PageContainer>
  )
}
