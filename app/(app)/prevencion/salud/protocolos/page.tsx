import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { listMinsalProtocols } from "@/lib/services/prevention-health"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"

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
      <div className="rounded border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left">Código</th>
              <th className="px-3 py-2 text-left">Nombre</th>
              <th className="px-3 py-2 text-left">Marco legal</th>
              <th className="px-3 py-2 text-left">Periodicidad</th>
              <th className="px-3 py-2 text-left">Aplica a cargos</th>
            </tr>
          </thead>
          <tbody>
            {protocols.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{p.code}</td>
                <td className="px-3 py-2">{p.name}</td>
                <td className="px-3 py-2 text-xs">{p.legalFramework}</td>
                <td className="px-3 py-2">{p.periodicityMonths} meses</td>
                <td className="px-3 py-2 text-xs">{JSON.stringify(p.appliesToPositions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageContainer>
  )
}
