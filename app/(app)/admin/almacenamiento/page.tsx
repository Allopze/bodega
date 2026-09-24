import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { readCloudreveAdminStatus } from "@/lib/services/cloudreve/settings"
import { getGeneratedArchiveQueueOverview } from "@/lib/services/generated-documents/admin"
import { readGeneratedArchiveSettings } from "@/lib/services/generated-documents/settings"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { CloudreveStorageForm } from "./credentials-form"
import { GeneratedDocumentsCard } from "./generated-documents-card"

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

  const [status, generatedSettings, generatedQueue] = await Promise.all([
    readCloudreveAdminStatus(),
    readGeneratedArchiveSettings(),
    getGeneratedArchiveQueueOverview(),
  ])
  const credentialsConfigured = status.baseUrl.configured
    && status.fields.username.configured
    && status.fields.password.configured

  return (
    <PageContainer>
      <PageHeader
        title="Almacenamiento de documentos"
        description="Dónde se guardan los archivos de la biblioteca SST de Prevención y los documentos que genera la plataforma: el filesystem local o la carpeta compartida de Chome en Cloudreve."
        breadcrumb={BREADCRUMBS}
      />
      <div className="space-y-6">
        <CloudreveStorageForm status={status} />
        <GeneratedDocumentsCard
          settings={{
            envEnabled: generatedSettings.envEnabled,
            switchOn: generatedSettings.switchOn,
            basePath: generatedSettings.basePath,
            basePathInvalid: generatedSettings.basePathInvalid,
            layout: generatedSettings.layout,
          }}
          credentialsConfigured={credentialsConfigured}
          overview={generatedQueue}
        />
      </div>
    </PageContainer>
  )
}
