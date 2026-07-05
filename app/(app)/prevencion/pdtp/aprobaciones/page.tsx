import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listPendingPdtpExecutions } from "@/lib/services/prevention-pdtp"
import { currentPdtpPeriod } from "@/lib/services/pdtp/period"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { PdtpApprovalButtons } from "../pdtp-approval-buttons"
import { PdtpEvidenceThumbs } from "../pdtp-evidence-thumbs"

export const metadata: Metadata = { title: "Aprobaciones PDTP" }

export default async function PdtpApprovalsPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:approve")) redirect("/forbidden")

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" =
    scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
  const pending = await listPendingPdtpExecutions(currentPdtpPeriod().year, worksiteIds)
  // H-M4: el description debe reflejar el scope real del usuario para
  // no inducir a error (un usuario de faena solo ve sus faenas).
  const scopeDescription =
    scope.mode === "all"
      ? "Ejecuciones semanales del Programa de Trabajo Preventivo pendientes de aprobación, en todas las faenas."
      : scope.mode === "some"
        ? `Ejecuciones semanales del Programa de Trabajo Preventivo pendientes de aprobación en tus ${scope.ids.length} faena(s) asignada(s).`
        : "No tienes faenas asignadas, no se mostrarán ejecuciones pendientes."

  // One row per (activityId, worksiteId) pair — the same activity can be
  // pending in multiple faenas at once.
  const rows = new Map<string, {
    activityId: string
    activityN: number
    activityName: string
    worksiteId: string
    worksiteName: string
    pendingApprovals: Array<{
      id: string
      activityId: string
      month: number
      week: number
      evidenceText: string | null
      evidenceUrl: string | null
      evidencePhotos: string[]
    }>
  }>()
  for (const execution of pending) {
    const key = `${execution.activityId}::${execution.worksiteId}`
    let row = rows.get(key)
    if (!row) {
      row = {
        activityId: execution.activityId,
        activityN: execution.activityN,
        activityName: execution.activityName,
        worksiteId: execution.worksiteId,
        worksiteName: execution.worksiteName,
        pendingApprovals: [],
      }
      rows.set(key, row)
    }
    row.pendingApprovals.push({
      id: execution.id,
      activityId: execution.activityId,
      month: execution.month,
      week: execution.week,
      evidenceText: execution.evidenceText,
      evidenceUrl: execution.evidenceUrl,
      evidencePhotos: execution.evidencePhotos,
    })
  }
  const groupedRows = [...rows.values()]

  return (
    <PageContainer>
      <PageHeader
        title="Aprobaciones PDTP"
        description={scopeDescription}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Programa preventivo SG-SST", href: "/prevencion/pdtp" },
            { label: "Aprobaciones" },
          ]} />
        }
      />

      {groupedRows.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-5">
          <p className="font-medium text-[var(--color-text)]">Sin pendientes</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            No hay ejecuciones pendientes de aprobación.
          </p>
        </div>
      ) : (
        <TableRoot>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[12rem]">Faena</TableHead>
                <TableHead className="min-w-[24rem]">Actividad</TableHead>
                <TableHead className="min-w-[16rem]">Periodos pendientes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupedRows.map((row) => (
                <TableRow key={`${row.activityId}::${row.worksiteId}`}>
                  <TableCell>{row.worksiteName}</TableCell>
                  <TableCell>
                    <div className="space-y-2">
                      <div>
                        <span className="text-[var(--color-text-faint)]">N°{row.activityN}</span>{" "}
                        {row.activityName}
                      </div>
                      {row.pendingApprovals.some((e) => e.evidenceUrl || e.evidenceText || (e.evidencePhotos && e.evidencePhotos.length > 0)) && (
                        <div className="space-y-2">
                          {row.pendingApprovals.map((exec) => (
                            <PdtpEvidenceThumbs
                              key={exec.id}
                              evidenceUrl={exec.evidenceUrl}
                              evidencePhotos={exec.evidencePhotos}
                              evidenceText={exec.evidenceText}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <PdtpApprovalButtons activityId={row.activityId} pendingApprovals={row.pendingApprovals} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
      )}
    </PageContainer>
  )
}
