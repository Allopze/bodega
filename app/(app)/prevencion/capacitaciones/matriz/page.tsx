import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getTrainingMatrix } from "@/lib/services/prevention-training"
import { todayLocalISO } from "@/lib/sst/date"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { Badge } from "@/components/ui/badge"

export const metadata: Metadata = { title: "Matriz de capacitación por cargo" }

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function CapacitacionMatrizPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:training:view")) redirect("/forbidden")

  const rows = await getTrainingMatrix(scopeToIds(resolveWorksiteScope(session)), todayLocalISO())

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Capacitaciones", href: "/prevencion/capacitaciones" }, { label: "Matriz por cargo" }]} />
      <PageHeader title="Matriz de capacitación por cargo" description="Cobertura de cursos requeridos por cargo vs. trabajadores al día." />
      <TableRoot>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cargo</TableHead>
              <TableHead>Curso requerido</TableHead>
              <TableHead className="text-right">Requeridos</TableHead>
              <TableHead className="text-right">Al día</TableHead>
              <TableHead className="text-right">Cobertura</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <EmptyState compact title="Sin cursos por cargo" description="No hay cursos con cargos requeridos configurados en tu alcance." />
                </TableCell>
              </TableRow>
            ) : rows.map((r) => {
              const pct = r.requiredCount > 0 ? Math.round((r.compliantCount / r.requiredCount) * 100) : 0
              const variant = pct >= 100 ? "success" : pct >= 50 ? "warning" : "danger"
              return (
                <TableRow key={`${r.courseId}-${r.cargo}`}>
                  <TableCell className="font-medium">{r.cargo}</TableCell>
                  <TableCell>{r.courseName}</TableCell>
                  <TableCellNum>{r.requiredCount}</TableCellNum>
                  <TableCellNum>{r.compliantCount}</TableCellNum>
                  <TableCell className="text-right"><Badge variant={variant}>{pct}%</Badge></TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableRoot>
    </PageContainer>
  )
}
