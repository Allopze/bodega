import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { listPdtpPrograms } from "@/lib/services/prevention-pdtp"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PdtpCreateProgramForm } from "./create-form"

export const metadata: Metadata = { title: "Nuevo programa PDTP" }

export default async function PdtpCreateProgramPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:manage")) redirect("/forbidden")

  const existingPrograms = await listPdtpPrograms()

  return (
    <PageContainer width="form">
      <PageHeader
        title="Nuevo programa preventivo"
        description="Crea un nuevo programa de trabajo preventivo para un año específico."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Programas PDTP", href: "/prevencion/pdtp" },
            { label: "Nuevo" },
          ]} />
        }
      />
      <PdtpCreateProgramForm
        userId={session.user.id}
        existingPrograms={existingPrograms.map((p) => ({ id: p.id, title: p.title, year: p.year, version: p.version }))}
      />
    </PageContainer>
  )
}
