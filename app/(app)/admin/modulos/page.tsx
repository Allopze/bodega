import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { getAllModuleToggles } from "@/lib/services/module-toggles"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { ModuleToggleList } from "./module-toggle-list"

export const metadata: Metadata = { title: "Módulos del sistema" }

export default async function ModulosPage() {
  try {
    await requirePermission("admin:module_management")
  } catch {
    redirect("/forbidden")
  }

  const moduleToggles = await getAllModuleToggles()

  return (
    <PageContainer>
      <PageHeader
        title="Módulos del sistema"
        description="Activa o desactiva módulos y submódulos completos. Los cambios afectan la navegación de todos los usuarios, incluidos los administradores."
        breadcrumb={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Módulos" },
        ]}
      />
      <ModuleToggleList moduleToggles={moduleToggles} />
    </PageContainer>
  )
}
