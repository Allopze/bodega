import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import Link from "next/link"
import {
  Users, MapPin, Cube, Buildings, ShieldCheck, UserCircle, Gear,
} from "@phosphor-icons/react/dist/ssr"

export const metadata: Metadata = { title: "Panel de Administración" }

export default async function AdminPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const userPerms = session.user.permissions ?? []
  const hasAdminAccess = userPerms.some((p) => p.startsWith("admin:"))
  if (!hasAdminAccess) redirect("/dashboard")

  const modules = [
    {
      title:       "Usuarios",
      description: "Gestionar usuarios, roles y permisos de acceso del sistema.",
      href:        "/admin/usuarios",
      icon:        Users,
      permission:  "admin:users",
    },
    {
      title:       "Faenas",
      description: "Crear y editar obras, faenas y asociación de usuarios.",
      href:        "/admin/faenas",
      icon:        MapPin,
      permission:  "admin:worksites",
    },
    {
      title:       "Trabajadores",
      description: "Administrar personal de obra para despachos de EPP y equipos.",
      href:        "/admin/trabajadores",
      icon:        UserCircle,
      permission:  "admin:workers",
    },
    {
      title:       "Productos",
      description: "Catálogo de productos, SKU y precios de referencia.",
      href:        "/admin/productos",
      icon:        Cube,
      permission:  "admin:products",
    },
    {
      title:       "Proveedores",
      description: "Registro de proveedores y sus condiciones comerciales.",
      href:        "/admin/proveedores",
      icon:        Buildings,
      permission:  "admin:suppliers",
    },
    {
      title:       "Configuración",
      description: "Ajustar parámetros globales del sistema, como el límite de subida de archivos PDF.",
      href:        "/admin/configuracion",
      icon:        Gear,
      permission:  "admin:config",
    },
    {
      title:       "Log de Auditoría",
      description: "Historial completo de acciones y auditoría de cambios del sistema.",
      href:        "/admin/auditoria",
      icon:        ShieldCheck,
      permission:  "admin:audit_log",
    },
  ]

  const visibleModules = modules.filter((m) => can(session, m.permission as never))

  return (
    <>
      <PageHeader
        title="Panel de Administración"
        description="Configura los parámetros, catálogos y accesos de Chome Solicitudes y Bodega."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Administración" },
          ]} />
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
        {visibleModules.map((m) => {
          const Icon = m.icon
          return (
            <Link
              key={m.href}
              href={m.href}
              className="flex items-start gap-4 p-5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)] hover:border-[var(--color-primary-line)] hover:shadow-sm transition-all duration-[var(--duration-fast)] group cursor-pointer"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--color-surface-2)] text-[var(--color-text-subtle)] group-hover:bg-[var(--color-primary-tint)] group-hover:text-[var(--color-primary)] transition-colors duration-[var(--duration-fast)]">
                <Icon size={20} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[var(--color-text)] group-hover:text-[var(--color-primary)] transition-colors duration-[var(--duration-fast)]">
                  {m.title}
                </h3>
                <p className="mt-1 text-xs text-[var(--color-text-muted)] leading-relaxed">
                  {m.description}
                </p>
              </div>
            </Link>
          )
        })}
      </div>
    </>
  )
}
