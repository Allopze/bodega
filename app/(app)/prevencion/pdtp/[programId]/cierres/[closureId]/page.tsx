import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { DownloadSimple } from "@phosphor-icons/react/dist/ssr"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getPdtpProgram } from "@/lib/services/prevention-pdtp"
import { getPdtpPeriodClosure } from "@/lib/services/pdtp/period-closures"
import type { PdtpPeriodClosureSnapshot } from "@/lib/services/pdtp/period-closures"
import { Callout } from "@/components/ui/callout"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { DetailItem } from "@/components/ui/detail-item"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { MONTH_LABELS, formatDateTime } from "@/lib/utils"

export const metadata: Metadata = { title: "Detalle del cierre mensual" }

type PageProps = { params: Promise<{ programId: string; closureId: string }> }

function percentLabel(value: number | null): string {
  return value === null ? "Sin planificación" : `${Math.round(value * 100)} %`
}

/**
 * Detalle de un cierre: los indicadores congelados del mes, el avance por
 * objetivo, los desvíos declarados y —sólo acá— el aviso de desviación
 * respecto de la base viva.
 *
 * `driftedSinceClose` se muestra en el detalle y no en la lista a propósito:
 * calcularlo exige reconstruir la foto completa del mes, que es caro, y
 * entenderlo exige el contexto que sólo esta pantalla da (la acreditación por
 * integración no se bloquea, así que un mes cerrado puede seguir recibiendo
 * hechos de otros módulos).
 */
export default async function PdtpPeriodClosureDetailPage({ params }: PageProps) {
  let session
  try { session = await requireAuth() }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/pdtp")}`) }
  if (!can(session, "prevention:pdtp:view")) redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/pdtp")}`)

  const { programId, closureId } = await params
  const program = await getPdtpProgram(programId)
  if (!program) notFound()

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" = scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []

  let closure
  try { closure = await getPdtpPeriodClosure(closureId, worksiteIds) }
  catch { redirect(`/forbidden?desde=${encodeURIComponent(`/prevencion/pdtp/${programId}/cierres`)}`) }
  if (!closure) notFound()

  const snapshot = closure.snapshotJson as PdtpPeriodClosureSnapshot
  const monthLabel = `${MONTH_LABELS[closure.month - 1] ?? closure.month} ${closure.year}`
  const month = snapshot.indicators.monthly.find((entry) => entry.month === closure.month)

  return (
    <PageContainer>
      <PageHeader
        title={`Cierre de ${monthLabel} · ${snapshot.re36.worksite.name}`}
        description="Todo lo que sigue es la copia congelada del mes, no el estado actual del programa."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Programa de trabajo", href: "/prevencion/pdtp" },
            { label: program.title, href: `/prevencion/pdtp/${programId}` },
            { label: "Cierres mensuales", href: `/prevencion/pdtp/${programId}/cierres` },
            { label: monthLabel },
          ]} />
        }
        actions={
          <Button asChild size="sm">
            <a href={`/api/prevencion/pdtp/cierres/${closure.id}/export`} download className="flex items-center gap-2">
              <DownloadSimple size={14} />
              Descargar el Excel del cierre
            </a>
          </Button>
        }
      />

      {closure.driftedSinceClose && (
        <Callout tone="warning" title="Los datos del mes cambiaron después del cierre">
          Algo del mes se movió desde que se congeló esta copia — normalmente una actividad acreditada automáticamente
          por otro módulo, que sigue entrando aunque el mes esté cerrado para no perder el hecho. La copia y su
          descarga no cambian; si necesitas que la evidencia refleje lo nuevo, reabre el mes y ciérralo otra vez.
        </Callout>
      )}

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DetailItem layout="stacked" label="Cumplimiento del mes" value={percentLabel(month?.percent ?? null)} mono />
        <DetailItem layout="stacked" label="Planificado / ejecutado" value={`${month?.planned ?? 0} / ${month?.executed ?? 0}`} mono />
        <DetailItem layout="stacked" label="Actividades en cero" value={String(month?.zeroActivities ?? 0)} mono />
        <DetailItem layout="stacked" label="Desvíos declarados" value={String(snapshot.deviations.length)} mono />
      </dl>

      <dl className="grid gap-4 sm:grid-cols-2">
        <DetailItem
          layout="stacked"
          label="Estado"
          value={<MetaBadge meta={closure.status === "reopened"
            ? { label: "Reabierto", variant: "warning" }
            : { label: "Cerrado", variant: "outline" }} />}
        />
        <DetailItem layout="stacked" label="Versión de la copia" value={`v${closure.version}`} />
        <DetailItem layout="stacked" label="Cerrado el" value={formatDateTime(closure.closedAt)} />
        <DetailItem layout="stacked" label="Aviso enviado" value={closure.distributedAt ? formatDateTime(closure.distributedAt) : "Sin enviar"} />
        <DetailItem layout="stacked" label="Fundamento del cierre" value={closure.closeReason} />
        {closure.reopenReason && <DetailItem layout="stacked" label="Motivo de la reapertura" value={closure.reopenReason} />}
      </dl>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Avance por objetivo, al corte del mes</h2>
        {snapshot.objectives.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">El programa no tenía objetivos declarados al cerrar este mes.</p>
        ) : (
          <TableRoot>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Objetivo</TableHead>
                  <TableHead>Planificado</TableHead>
                  <TableHead>Ejecutado</TableHead>
                  <TableHead>Avance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.objectives.map((objective) => (
                  <TableRow key={objective.code}>
                    <TableCell>{objective.name}</TableCell>
                    <TableCell>{objective.planned}</TableCell>
                    <TableCell>{objective.executed}</TableCell>
                    <TableCell>{percentLabel(objective.percent)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Desvíos declarados en la copia</h2>
        {snapshot.deviations.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No había desvíos declarados al cerrar este mes.</p>
        ) : (
          <TableRoot>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N°</TableHead>
                  <TableHead>Actividad</TableHead>
                  <TableHead>Mes y semana</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Registrado por</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.deviations.map((deviation) => (
                  <TableRow key={`${deviation.n}-${deviation.month}-${deviation.week}-${deviation.kind}`}>
                    <TableCell>{deviation.n}</TableCell>
                    <TableCell>{deviation.activity}</TableCell>
                    <TableCell>{`${MONTH_LABELS[deviation.month - 1] ?? deviation.month}, semana ${deviation.week}`}</TableCell>
                    <TableCell>{deviation.kind}</TableCell>
                    <TableCell>{deviation.reason}</TableCell>
                    <TableCell>
                      <span className="block">{deviation.recordedBy}</span>
                      <span className="block text-[11px] text-[var(--color-text-muted)]">{deviation.recordedAt}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
        )}
      </section>
    </PageContainer>
  )
}
