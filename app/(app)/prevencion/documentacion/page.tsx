import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { listLegalDocuments } from "@/lib/services/prevention-legal-docs"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PreventionExportButton } from "@/components/prevention/export-button"

export const metadata: Metadata = { title: "Documentación legal" }

export default async function DocumentacionPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:legal_docs:view")) redirect("/forbidden")

  const docs = await listLegalDocuments()

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Documentación" }]} />
      <PageHeader title="Documentación legal" description="RIOHS, ODI, IRL, carpetas de arranque y programas (N° 15, 18, 19 PDTP)" actions={<PreventionExportButton href="/api/prevencion/documentacion/export" label="Exportar docs" />} />
      <div className="rounded border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-left">Código</th>
              <th className="px-3 py-2 text-left">Título</th>
              <th className="px-3 py-2 text-left">Obligatorio</th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">Sin documentos registrados.</td></tr>
            ) : docs.map((d) => (
              <tr key={d.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{d.type}</td>
                <td className="px-3 py-2">{d.code}</td>
                <td className="px-3 py-2">{d.title}</td>
                <td className="px-3 py-2">{d.mandatory ? "Sí" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageContainer>
  )
}
