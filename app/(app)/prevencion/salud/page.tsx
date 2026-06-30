import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { listMinsalProtocols } from "@/lib/services/prevention-health"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"

export const metadata: Metadata = { title: "Salud ocupacional" }

export default async function SaludPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:health:view")) redirect("/forbidden")

  const protocols = await listMinsalProtocols()

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Salud ocupacional" }]} />
      <PageHeader title="Salud ocupacional" description="Exámenes, aptitudes, restricciones y protocolos MINSAL (N° 44-50 PDTP)" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded border p-4">
          <h3 className="text-sm font-medium mb-3">Protocolos MINSAL</h3>
          {protocols.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin protocolos cargados. Ejecutar seed.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2">Código</th>
                  <th className="pb-2">Nombre</th>
                  <th className="pb-2">Marco legal</th>
                </tr>
              </thead>
              <tbody>
                {protocols.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="py-1.5">{p.code}</td>
                    <td className="py-1.5">{p.name}</td>
                    <td className="py-1.5 text-xs text-muted-foreground">{p.legalFramework}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="rounded border p-4">
          <h3 className="text-sm font-medium mb-3">Acciones</h3>
          <p className="text-sm text-muted-foreground">Seleccione un trabajador para ver su ficha de salud, exámenes, aptitudes y restricciones vigentes.</p>
        </div>
      </div>
    </PageContainer>
  )
}
