import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { HistoricalFilters } from "@/components/mantencion/jefatura/registros/historical-filters"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { ServerPagination } from "@/components/ui/server-pagination"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { FORMS_CUTOVER_DATE, FORMS_LAST_COUNTED_DATE } from "@/lib/mantencion/forms-cutover"
import { ACTION_TYPE_LABELS, type ActionTypeOrUnknown } from "@/lib/mantencion/action-type"
import { formatHours, plural } from "@/lib/mantencion/format"
import { buildPaginationHref, resolvePagination } from "@/lib/pagination"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { listHistoricalRecords } from "@/lib/services/mantencion/historical-import"
import { formatDate } from "@/lib/utils"

export const metadata: Metadata = { title: "Historial anterior" }
export const dynamic = "force-dynamic"

const PATH = "/mantencion/registros/historicos"
const WARNING_TEXT = "text-xs text-[var(--color-warning-ink)]"

/** El tipo normalizado del consolidado; en las filas que sólo vienen del formulario, el texto que escribieron. */
function actionLabel(row: { actionType: string | null; kindText: string }): string {
  if (row.actionType && row.actionType in ACTION_TYPE_LABELS) return ACTION_TYPE_LABELS[row.actionType as ActionTypeOrUnknown]
  return row.kindText || "No informada"
}
/** Horas hombre normalizadas; si no hay, lo que el formulario escribió. */
/** La faena por su nombre; el texto crudo del formulario sólo cuando no se resolvió. */
const worksiteLabel = (row: { worksiteName: string | null; worksiteText: string }) => row.worksiteName || row.worksiteText
/** Fecha de ingreso; si falta, el día del envío, dicho como tal. */
const entryLabel = (row: { entryDate: string | null; submittedAt: string }) => row.entryDate ? formatDate(row.entryDate) : row.submittedAt ? `Enviado el ${formatDate(row.submittedAt)}` : "Fecha no informada"
const hoursLabel = (row: { laborHours: number | null; hoursText: string }) => (row.laborHours !== null ? formatHours(row.laborHours) : row.hoursText.trim() || "—")

type Params = Record<string, string | string[] | undefined>
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? ""

export default async function HistoricalRecordsPage({ searchParams }: { searchParams: Promise<Params> }) {
  let session
  try {
    session = await requireAnyPermission(["mant:records:view_worksite", "mant:records:view_all"])
  } catch {
    redirect("/forbidden")
  }
  const raw = await searchParams
  const search = first(raw.q).slice(0, 100)
  const vehicleId = first(raw.equipo).slice(0, 64)
  const pendingParam = first(raw.vinculo)
  const pending = pendingParam === "equipment" || pendingParam === "conflict" || pendingParam === "worksite" ? pendingParam : undefined
  const page = Number(first(raw.page))
  const from = first(raw.desde).slice(0, 10)
  const to = first(raw.hasta).slice(0, 10)
  const worksiteId = first(raw.faena).slice(0, 64)
  const list = await listHistoricalRecords(viewerFromSession(session), { search, vehicleId, page, pending, from, to, worksiteId })
  const period = list.applied.from || list.applied.to
    ? `${list.applied.from ? `desde el ${formatDate(list.applied.from)}` : ""}${list.applied.from && list.applied.to ? " " : ""}${list.applied.to ? `hasta el ${formatDate(list.applied.to)}` : ""}`
    : ""
  const pagination = resolvePagination({ pageParam: String(list.page), totalItems: list.total, pageSize: list.pageSize })
  const canImport = can(session, "mant:equipment:manage") && can(session, "mant:records:view_all")
  const filtered = Boolean(search || vehicleId || pending || list.applied.from || list.applied.to || list.applied.worksite)

  return (
    <PageContainer>
      <PageHeader
        title="Historial anterior"
        description="Trabajos registrados en los formularios anteriores, con sus datos de origen."
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Registros firmados", href: "/mantencion/registros" }, { label: "Historial anterior" }]}
        actions={canImport ? <Button asChild><Link href={`${PATH}/importar`}>Importar historial anterior</Link></Button> : undefined}
      />

      <HistoricalFilters worksiteName={list.applied.worksite?.name} />

      <p className="mb-3 text-sm text-[var(--color-text-muted)]">
        {plural(list.total, "trabajo", "trabajos")} {vehicleId ? "de este equipo" : "en el historial anterior"}
        {list.applied.worksite ? ` en ${list.applied.worksite.name}` : ""}{period ? ` ${period}` : ""}. No modifican las lecturas, el semáforo de pautas ni las alertas. Cuentan en los indicadores de trabajos del Panel hasta el {formatDate(FORMS_LAST_COUNTED_DATE)}, salvo los marcados como posible prueba; desde el {formatDate(FORMS_CUTOVER_DATE)} la plataforma reemplaza a los formularios.
      </p>

      {list.rows.length === 0 ? (
        <EmptyState
          title="No hay trabajos para mostrar"
          description={filtered ? "Prueba con otra búsqueda o quita los filtros para ver todo el historial anterior." : "Cuando se importe un archivo de historial anterior, sus trabajos aparecerán aquí."}
          action={filtered
            ? <Button asChild variant="secondary"><Link href={PATH}>Ver todo el historial</Link></Button>
            : canImport ? <Button asChild><Link href={`${PATH}/importar`}>Importar historial anterior</Link></Button> : undefined}
        />
      ) : (
        <>
          <ul aria-label="Trabajos del historial anterior como tarjetas" className="grid gap-3 md:hidden">
            {list.rows.map((row) => (
              <li key={row.sourceKey}>
                <ResponsiveDataListCard
                  // La lista es el contenido de la página: sus tarjetas cuelgan del h1 (paso 6).
                  headingLevel={2}
                  title={row.equipmentText || "Sin equipo"}
                  description={`${worksiteLabel(row) || "Sin faena"} · ${entryLabel(row)}`}
                  actions={(
                    <Button asChild variant="secondary" size="sm" className="w-full">
                      <Link href={`${PATH}/${row.sourceKey}`} aria-label={`Ver el trabajo de ${row.equipmentText || "equipo no informado"}, orden ${row.orderText || "sin número"}`}>Ver el trabajo</Link>
                    </Button>
                  )}
                >
                  <ResponsiveDataListField label="Acción">{actionLabel(row)}</ResponsiveDataListField>
                  <ResponsiveDataListField label="Orden">{row.orderText || "No informada"}</ResponsiveDataListField>
                  <ResponsiveDataListField label="Horas hombre">{hoursLabel(row)}</ResponsiveDataListField>
                  <ResponsiveDataListField label="Contrato">{row.contractText || "—"}</ResponsiveDataListField>
                  {(row.isTest || row.qualityNotes) && (
                    <ResponsiveDataListField label="Revisar" className="col-span-2">
                      <span className="flex flex-wrap items-center gap-2">
                        {row.isTest && <Badge variant="warning">Posible prueba</Badge>}
                        {row.qualityNotes && <span className="text-[var(--color-warning-ink)]">{row.qualityNotes}</span>}
                      </span>
                    </ResponsiveDataListField>
                  )}
                  <ResponsiveDataListField label="Trabajo" className="col-span-2">
                    <span className="whitespace-pre-wrap break-words">{row.description || "No informado"}</span>
                  </ResponsiveDataListField>
                  {(!row.vehicleId || !row.worksiteId) && (
                    <ResponsiveDataListField label="Por completar" className="col-span-2">
                      <span className="text-[var(--color-warning-ink)]">
                        {[!row.vehicleId ? "Equipo sin identificar" : "", !row.worksiteId ? "Faena sin identificar" : ""].filter(Boolean).join(" · ")}
                      </span>
                    </ResponsiveDataListField>
                  )}
                </ResponsiveDataListCard>
              </li>
            ))}
          </ul>

          <div className="hidden md:block">
            <TableRoot aria-label="Trabajos del historial anterior">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha de ingreso</TableHead>
                    <TableHead>Equipo</TableHead>
                    <TableHead>Faena</TableHead>
                    <TableHead>Acción</TableHead>
                    <TableHead>Trabajo</TableHead>
                    <TableHead>Horas hombre</TableHead>
                    <TableHead>Contrato</TableHead>
                    <TableHead>Orden</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.rows.map((row) => (
                    <TableRow key={row.sourceKey}>
                      <TableCell className="whitespace-nowrap">{entryLabel(row)}</TableCell>
                      <TableCell>
                        <Link href={`${PATH}/${row.sourceKey}`} className="font-semibold text-[var(--color-primary-ink)] hover:underline">{row.equipmentText || "Sin equipo"}</Link>
                        {!row.vehicleId && <span className={`block ${WARNING_TEXT}`}>Equipo sin identificar</span>}
                        {row.isTest && <Badge variant="warning" className="mt-1">Posible prueba</Badge>}
                      </TableCell>
                      <TableCell>
                        {worksiteLabel(row) || "No informada"}
                        {!row.worksiteId && <span className={`block ${WARNING_TEXT}`}>Faena sin identificar</span>}
                      </TableCell>
                      <TableCell>{actionLabel(row)}</TableCell>
                      <TableCell className="max-w-sm">
                        <span className="line-clamp-2">{row.description || "No informado"}</span>
                        {row.qualityNotes && <span className={`line-clamp-1 ${WARNING_TEXT}`} title={row.qualityNotes}>Observación de calidad: {row.qualityNotes}</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{hoursLabel(row)}</TableCell>
                      <TableCell>{row.contractText || "—"}</TableCell>
                      <TableCell>{row.orderText || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableRoot>
          </div>
          <ServerPagination pagination={pagination} hrefForPage={(target) => buildPaginationHref(PATH, raw, target)} />
        </>
      )}
    </PageContainer>
  )
}
