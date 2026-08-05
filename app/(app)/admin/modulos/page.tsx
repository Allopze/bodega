import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { getAllModuleToggles } from "@/lib/services/module-toggles"
import { getPlatformHealth } from "@/lib/services/platform-health"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { ModuleToggleList } from "./module-toggle-list"
import { PlatformHealthCard } from "./platform-health-card"

export const metadata: Metadata = { title: "Módulos del sistema" }

export default async function ModulosPage() {
  try {
    await requirePermission("admin:module_management")
  } catch {
    redirect("/forbidden")
  }

  const [moduleToggles, health] = await Promise.all([
    getAllModuleToggles(),
    getPlatformHealth(),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Módulos del sistema"
        description="Activa o desactiva módulos y submódulos completos. El interruptor controla qué aparece en la navegación de todos los usuarios, incluidos los administradores; no mide si el módulo funciona ni sustituye a los permisos."
        breadcrumb={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Módulos" },
        ]}
      />
      <PlatformHealthCard health={health} />
      <ModuleToggleList moduleToggles={moduleToggles} />
    </PageContainer>
  )
}
