import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { listMinsalProtocols } from "@/lib/services/prevention-health"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"

export const metadata: Metadata = { title: "Protocolos MINSAL" }

export default async function ProtocolosPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:health:view")) redirect("/forbidden")

  const protocols = await listMinsalProtocols()

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Salud", href: "/prevencion/salud" }, { label: "Protocolos" }]} />
      <PageHeader title="Protocolos MINSAL" description="Cumplimiento de protocolos por faena y trabajador" />
      <TableRoot>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Marco legal</TableHead>
              <TableHead>Periodicidad</TableHead>
              <TableHead>Aplica a cargos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {protocols.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <EmptyState compact title="Sin protocolos" description="No hay protocolos MINSAL registrados." />
                </TableCell>
              </TableRow>
            ) : protocols.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.code}</TableCell>
                <TableCell>{p.name}</TableCell>
                <TableCell className="text-xs text-[var(--color-text-subtle)]">{p.legalFramework}</TableCell>
                <TableCell>{p.periodicityMonths} meses</TableCell>
                <TableCell className="text-xs text-[var(--color-text-subtle)]">{JSON.stringify(p.appliesToPositions)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </PageContainer>
  )
}
