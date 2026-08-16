import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  listGeneralLibrarySensitiveAccess,
  listPreventionSensitiveAccessAudit,
} from "@/lib/services/prevention-privacy"

export const metadata: Metadata = { title: "Auditoría sensible de Prevención" }

export default async function PreventionPrivacyAuditPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:privacy:audit")) redirect("/forbidden")
  const scope = resolveWorksiteScope(session)
  const [domainAudit, libraryAudit] = await Promise.all([
    listPreventionSensitiveAccessAudit(scope),
    listGeneralLibrarySensitiveAccess(scope),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Auditoría de accesos sensibles"
        description="Revisión de accesos, denegaciones y descargas sin exponer contenido clínico o testimonios."
        breadcrumb={<Breadcrumbs items={[
          { label: "Prevención", href: "/prevencion" },
          { label: "Datos personales", href: "/prevencion/privacidad" },
          { label: "Auditoría de accesos" },
        ]} />}
        actions={can(session, "prevention:privacy:manage_requests")
          ? <Link href="/prevencion/privacidad/solicitudes" className="inline-flex h-8 items-center rounded-md bg-[var(--color-primary)] px-3 text-sm font-medium text-white hover:opacity-90">Solicitudes de derechos</Link>
          : undefined}
      />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Dominio cifrado · salud y casos reservados</h2>
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Fecha</TableHead><TableHead>Dominio</TableHead><TableHead>Acción</TableHead>
              <TableHead>Resultado</TableHead><TableHead>Actor</TableHead><TableHead>Propósito</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {domainAudit.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="text-xs">{entry.createdAt.slice(0, 16).replace("T", " ")}</TableCell>
                  <TableCell className="font-mono text-xs">{entry.domain}</TableCell>
                  <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                  <TableCell><Badge variant={entry.outcome === "granted" ? "success" : "danger"}>{entry.outcome === "granted" ? "Permitido" : "Denegado"}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{entry.actorUserId ?? "sistema"}</TableCell>
                  <TableCell className="max-w-lg text-xs">{entry.purpose}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="mt-5 space-y-2">
        <h2 className="text-sm font-semibold">Biblioteca general · sensibles a revisar</h2>
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Fecha</TableHead><TableHead>Documento</TableHead><TableHead>Acción</TableHead>
              <TableHead>Actor</TableHead><TableHead>Clasificación</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {libraryAudit.map((entry) => (
                <TableRow key={entry.auditId}>
                  <TableCell className="text-xs">{entry.createdAt.slice(0, 16).replace("T", " ")}</TableCell>
                  <TableCell>
                    <Link href={`/prevencion/documentacion/${entry.documentId}`} className="text-sm font-medium text-[var(--color-primary)] hover:underline">
                      {entry.documentTitle}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                  <TableCell className="font-mono text-xs">{entry.actorUserId ?? "sistema"}</TableCell>
                  <TableCell className="text-xs">{entry.dataClass} · {entry.confidentiality}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </PageContainer>
  )
}
