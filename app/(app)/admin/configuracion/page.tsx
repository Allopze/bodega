import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { ConfigForm } from "./config-form"

export const metadata: Metadata = { title: "Configuración del Sistema" }

export default async function ConfiguracionPage() {
  try {
    await requirePermission("admin:config")
  } catch {
    redirect("/dashboard")
  }

  const pdfMaxSizeMb = await getPdfMaxSizeMb()

  return (
    <>
      <PageHeader
        title="Configuración del Sistema"
        description="Ajustar parámetros globales de Chome Solicitudes y Bodega."
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Administración", href: "/admin" },
              { label: "Configuración" },
            ]}
          />
        }
      />
      <ConfigForm initialPdfMaxSizeMb={pdfMaxSizeMb} />
    </>
  )
}
