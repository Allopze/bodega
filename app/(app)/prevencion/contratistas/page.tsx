import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"

export const metadata: Metadata = { title: "Contratistas" }

export default async function ContratistasPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:contractors:view")) redirect("/forbidden")

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Contratistas" }]} />
      <PageHeader title="Contratistas" description="Padrón de contratistas, trabajadores y documentación (N° 20 PDTP, Ley 20.123)" />
      <div className="flex items-center justify-center border rounded p-12">
        <p className="text-muted-foreground text-sm">Padrón de contratistas — próximamente.</p>
      </div>
    </PageContainer>
  )
}
