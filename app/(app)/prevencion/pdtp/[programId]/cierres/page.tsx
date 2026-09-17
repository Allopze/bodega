import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { DownloadSimple } from "@phosphor-icons/react/dist/ssr"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getPdtpProgram } from "@/lib/services/prevention-pdtp"
import { listPdtpPeriodClosures } from "@/lib/services/pdtp/period-closures"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { MONTH_LABELS, formatDateTime } from "@/lib/utils"
import { PdtpClosureReopenButton, PdtpClosureResendButton } from "./closure-row-actions"

export const metadata: Metadata = { title: "Cierres mensuales del PDTP" }

type PageProps = { params: Promise<{ programId: string }> }

function pdtpClosureMonthLabel(year: number, month: number): string {
  return `${MONTH_LABELS[month - 1] ?? month} ${year}`
}

/**
 * Cierres mensuales del programa por faena.
 *
 * Es la vista de procedencia: qué meses están congelados, con qué versión,
 * quién los cerró, si ya se avisaron y desde dónde se baja el Excel que se
 * distribuyó. La descarga apunta a la ruta del cierre —que renderiza desde la
 * foto— y no al export del programa vivo, que daría otro archivo.
 */
export default async function PdtpPeriodClosuresPage({ params }: PageProps) {
  let session
  try { session = await requireAuth() }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/pdtp")}`) }
  if (!can(session, "prevention:pdtp:view")) redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/pdtp")}`)

  const { programId } = await params
  const program = await getPdtpProgram(programId)
  if (!program) notFound()

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" = scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
  const closures = await listPdtpPeriodClosures(programId, worksiteIds)
  const canClose = can(session, "prevention:pdtp:close_period")

  return (
    <PageContainer>
      <PageHeader
        title="Cierres mensuales"
        description="Cada cierre guarda una copia del programa tal como estaba al terminar el mes: el documento RE-36, los indicadores, los desvíos y el avance por objetivo. Esa copia no cambia aunque después cambien los datos."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Programas PDTP", href: "/prevencion/pdtp" },
            { label: program.title, href: `/prevencion/pdtp/${programId}` },
            { label: "Cierres mensuales" },
          ]} />
        }
      />

      {closures.length === 0 ? (
        <EmptyState
          compact
          align="start"
          title="Todavía no se ha cerrado ningún mes"
          description="Cierra un mes desde la vista del programa, eligiendo la faena. Se congela la copia del mes y se puede avisar por correo a jefatura y responsables."
          action={<Button asChild size="sm"><Link href={`/prevencion/pdtp/${programId}`}>Ir al programa</Link></Button>}
        />
      ) : (
        <TableRoot>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mes</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Versión</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Cerrado por</TableHead>
                <TableHead>Aviso</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {closures.map((closure) => {
                const monthLabel = pdtpClosureMonthLabel(closure.year, closure.month)
                return (
                  <TableRow key={closure.id}>
                    <TableCell>
                      <Link href={`/prevencion/pdtp/${programId}/cierres/${closure.id}`} className="underline">
                        {monthLabel}
                      </Link>
                    </TableCell>
                    <TableCell>{closure.worksiteName}</TableCell>
                    <TableCell>{`v${closure.version}`}</TableCell>
                    <TableCell>
                      <MetaBadge meta={closure.status === "reopened"
                        ? { label: "Reabierto", variant: "warning" }
                        : { label: "Cerrado", variant: "outline" }} />
                    </TableCell>
                    <TableCell>
                      <span className="block">{closure.closedByName}</span>
                      <span className="block text-[11px] text-[var(--color-text-muted)]">{formatDateTime(closure.closedAt)}</span>
                    </TableCell>
                    <TableCell>
                      {closure.distributedAt
                        ? formatDateTime(closure.distributedAt)
                        : <span className="text-[var(--color-text-faint)]">Sin enviar</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <Button asChild size="sm" variant="ghost">
                          <a href={`/api/prevencion/pdtp/cierres/${closure.id}/export`} download className="flex items-center gap-1">
                            <DownloadSimple size={14} />
                            Descargar
                          </a>
                        </Button>
                        {canClose && <PdtpClosureResendButton closureId={closure.id} />}
                        {canClose && closure.status === "closed" && (
                          <PdtpClosureReopenButton closureId={closure.id} monthLabel={monthLabel} />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableRoot>
      )}
    </PageContainer>
  )
}
