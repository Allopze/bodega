import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { readCloudreveAdminStatus } from "@/lib/services/cloudreve/settings"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { CloudreveStorageForm } from "./credentials-form"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Almacenamiento de documentos" }

const BREADCRUMBS = (
  <Breadcrumbs items={[
    { label: "Inicio", href: "/dashboard" },
    { label: "Administración", href: "/admin" },
    { label: "Almacenamiento de documentos" },
  ]} />
)

export default async function AlmacenamientoPage() {
  try { await requirePermission("admin:storage") }
  catch { redirect("/forbidden") }

  const status = await readCloudreveAdminStatus()

  return (
    <PageContainer>
      <PageHeader
        title="Almacenamiento de documentos"
        description="Dónde se guardan los archivos de la biblioteca SST de Prevención: el filesystem local o la carpeta compartida de Chome en Cloudreve."
        breadcrumb={BREADCRUMBS}
      />
      <CloudreveStorageForm status={status} />
    </PageContainer>
  )
}
