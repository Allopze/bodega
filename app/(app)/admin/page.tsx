import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import Link from "next/link"
import {
  Users, MapPin, Cube, Buildings, ShieldCheck, UserCircle, Gear, FileText, ArrowRight, EnvelopeSimple, ToggleLeft, HardDrives, Receipt, Package, ShippingContainer,
} from "@phosphor-icons/react/dist/ssr"

export const metadata: Metadata = { title: "Panel de Administración" }

const modules = [
  {
    title:       "Usuarios",
    description: "Gestionar usuarios, roles y permisos de acceso del sistema.",
    href:        "/admin/usuarios",
    icon:        Users,
    permission:  "admin:users",
    group:       "personas",
  },
  {
    title:       "Faenas",
    description: "Crear y editar obras, faenas y asociación de usuarios.",
    href:        "/admin/faenas",
    icon:        MapPin,
    permission:  "admin:worksites",
    group:       "personas",
  },
  {
    title:       "Trabajadores",
    description: "Administrar personal de obra para despachos de EPP y equipos.",
    href:        "/admin/trabajadores",
    icon:        UserCircle,
    permission:  "admin:workers",
    group:       "personas",
  },
  {
    title:       "Roles",
    description: "Gestionar roles base, alcance global y permisos incluidos por rol.",
    href:        "/admin/roles",
    icon:        ShieldCheck,
    permission:  "admin:roles",
    group:       "personas",
  },
  {
    title:       "Productos",
    description: "Catálogo de productos, SKU y precios de referencia.",
    href:        "/admin/productos",
    icon:        Cube,
    permission:  "admin:products",
    group:       "catalogos",
  },
  {
    title:       "Catálogos de productos",
    description: "Unidades de medida, atributos reutilizables y reglas auxiliares del catálogo.",
    href:        "/admin/catalogos-productos",
    icon:        Cube,
    permission:  "admin:product_catalogs",
    group:       "catalogos",
  },
  {
    title:       "Inventario de faena",
    description: "Extintores, kits de derrame y otros recursos instalados en terreno. Prevención los inspecciona; el padrón se carga acá.",
    href:        "/admin/inventario-faena",
    icon:        Package,
    permission:  "admin:worksite_inventory",
    group:       "catalogos",
  },
  {
    title:       "Contenedores",
    description: "Padrón de contenedores por faena. Prevención los inspecciona eligiéndolos del catálogo; el alta y el traslado se hacen acá.",
    href:        "/admin/contenedores",
    icon:        ShippingContainer,
    permission:  "admin:containers",
    group:       "catalogos",
  },
  {
    title:       "Equipos de servicio",
    description: "Monogás, alcotest y otros instrumentos que se mandan a mantener o calibrar.",
    href:        "/admin/equipos",
    icon:        Cube,
    permission:  "admin:service_equipment",
    group:       "catalogos",
  },
  {
    title:       "Proveedores",
    description: "Registro de proveedores y sus condiciones comerciales.",
    href:        "/admin/proveedores",
    icon:        Buildings,
    permission:  "admin:suppliers",
    group:       "catalogos",
  },
  {
    title:       "Centros de costo",
    description: "Crear y mantener centros de costo asociados a faenas e imputaciones.",
    href:        "/admin/centros-costo",
    icon:        Buildings,
    permission:  "admin:cost_centers",
    group:       "catalogos",
  },
  {
    title:       "Taxonomía documental SST",
    description: "Categorías, tipos, vigencias y reglas de documentos preventivos.",
    href:        "/admin/taxonomia-sst",
    icon:        FileText,
    permission:  "admin:document_taxonomy",
    group:       "prevencion",
  },
  {
    title:       "Catálogos PDTP",
    description: "Responsables, hojas, actividades base y plantillas del programa preventivo.",
    href:        "/admin/pdtp-catalogos",
    icon:        FileText,
    permission:  "admin:pdtp_catalog",
    group:       "prevencion",
  },
  {
    title:       "Catálogos de flota",
    description: "Vehículos, proveedores de combustible, documentos y tipos de mantención.",
    href:        "/admin/flota-catalogos",
    icon:        Gear,
    permission:  "admin:fleet_catalog",
    group:       "control-operacional",
  },
  {
    title:       "Configuración",
    description: "Ajustar parámetros globales del sistema, como el límite de subida de archivos PDF.",
    href:        "/admin/configuracion",
    icon:        Gear,
    permission:  "admin:config",
    group:       "gobierno",
  },
  {
    title:       "Parámetros operativos",
    description: "Límites de exportación, carga de archivos, retención y limpieza operativa.",
    href:        "/admin/parametros-operativos",
    icon:        Gear,
    permission:  "admin:ops_settings",
    group:       "gobierno",
  },
  {
    title:       "Folios",
    description: "Revisar secuencias de códigos y registrar correcciones controladas.",
    href:        "/admin/folios",
    icon:        FileText,
    permission:  "admin:folios",
    group:       "gobierno",
  },
  {
    title:       "Seguridad y bloqueos",
    description: "Ver y liberar bloqueos por intentos fallidos en login y formularios públicos.",
    href:        "/admin/seguridad",
    icon:        ShieldCheck,
    permission:  "admin:security",
    group:       "gobierno",
  },
  {
    title:       "Notificaciones",
    description: "Auditar, limpiar y diagnosticar notificaciones internas del sistema.",
    href:        "/admin/notificaciones",
    icon:        EnvelopeSimple,
    permission:  "admin:notifications",
    group:       "gobierno",
  },
  {
    title:       "Log de Auditoría",
    description: "Historial completo de acciones y auditoría de cambios del sistema.",
    href:        "/admin/auditoria",
    icon:        ShieldCheck,
    permission:  "admin:audit_log",
    group:       "gobierno",
  },
  {
    title:       "Módulos del sistema",
    description: "Activar o desactivar módulos y submódulos completos del sistema.",
    href:        "/admin/modulos",
    icon:        ToggleLeft,
    permission:  "admin:module_management",
    group:       "gobierno",
  },
  {
    title:       "Respaldos",
    description: "Monitorear, ejecutar y verificar respaldos automáticos del sistema.",
    href:        "/admin/backups",
    icon:        HardDrives,
    permission:  "admin:backups",
    group:       "gobierno",
  },
  {
    title:       "Sincronización DTE",
    description: "Documentos tributarios recibidos de proveedores vía el portal DTE FacturaEnLínea.",
    href:        "/admin/dte",
    icon:        Receipt,
    permission:  "admin:dte_sync",
    group:       "gobierno",
  },
  {
    title:       "Correo SMTP",
    description: "Configurar el servidor de correo saliente y el interruptor global de envíos.",
    href:        "/admin/correo-smtp",
    icon:        EnvelopeSimple,
    permission:  "admin:smtp",
    group:       "correo",
  },
  {
    title:       "Plantillas de correo",
    description: "Personalizar asunto y cuerpo HTML de los correos del sistema.",
    href:        "/admin/plantillas",
    icon:        FileText,
    permission:  "admin:email_templates",
    group:       "correo",
  },
]

const moduleGroups = [
  {
    key:         "personas",
    title:       "Personas y acceso",
    description: "Cuentas, permisos y dotación asociada a faenas.",
  },
  {
    key:         "catalogos",
    title:       "Catálogos operativos",
    description: "Datos maestros que alimentan solicitudes y compras.",
  },
  {
    key:         "prevencion",
    title:       "Prevención",
    description: "Catálogos maestros para documentación, SST y programa preventivo.",
  },
  {
    key:         "control-operacional",
    title:       "Control operacional",
    description: "Datos maestros de flota, combustible y mantenciones.",
  },
  {
    key:         "gobierno",
    title:       "Control del sistema",
    description: "Parámetros globales, trazabilidad y auditoría.",
  },
  {
    key:         "correo",
    title:       "Correo SMTP",
    description: "Servidor de envío, plantillas y configuración de notificaciones por correo.",
  },
]

export default async function AdminPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const userPerms = session.user.permissions ?? []
  const hasAdminAccess = userPerms.some((p) => p.startsWith("admin:"))
  if (!hasAdminAccess) redirect("/forbidden")

  const visibleModules = modules.filter((m) => can(session, m.permission as never))

  return (
    <PageContainer>
      <PageHeader
        title="Panel de Administración"
        description="Configura los parámetros, catálogos y accesos de Plataforma Chome."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Administración" },
          ]} />
        }
      />
      <div className="w-full space-y-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {moduleGroups.map((group) => {
            const groupModules = visibleModules.filter((m) => m.group === group.key)
            if (groupModules.length === 0) return null

            return (
              <section
                key={group.key}
                className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]"
              >
                <div className="border-b border-[var(--color-border)] px-4 py-3">
                  <h2 className="text-sm font-semibold text-[var(--color-text)]">{group.title}</h2>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-text-subtle)]">{group.description}</p>
                </div>
                <div className="divide-y divide-[var(--color-border)]">
                  {groupModules.map((m) => {
                    const Icon = m.icon
                    return (
                      <Link
                        key={m.href}
                        href={m.href}
                        className="group flex items-start gap-3 px-4 py-3 transition-[background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-primary-tint)] "
                      >
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--color-surface-2)] text-[var(--color-text-subtle)] transition-[background-color,color] duration-[var(--duration-fast)] group-hover:bg-[var(--color-primary-tint)] group-hover:text-[var(--color-primary)]">
                          <Icon size={18} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-[var(--color-text)] transition-colors duration-[var(--duration-fast)] group-hover:text-[var(--color-primary)]">
                            {m.title}
                          </span>
                          <span className="mt-0.5 block text-xs leading-relaxed text-[var(--color-text-muted)]">
                            {m.description}
                          </span>
                        </span>
                        <ArrowRight
                          size={15}
                          className="mt-2 shrink-0 text-[var(--color-text-faint)] transition-[color,transform] duration-[var(--duration-fast)] group-hover:translate-x-0.5 group-hover:text-[var(--color-primary)]"
                          aria-hidden
                        />
                      </Link>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>

        {visibleModules.length === 0 && (
          <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-8 text-center shadow-[var(--shadow-card)]">
            <h2 className="text-h3 text-[var(--color-text)]">Sin accesos administrativos</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Tu cuenta tiene acceso al panel, pero no hay secciones administrativas habilitadas.
            </p>
          </section>
        )}
      </div>
    </PageContainer>
  )
}
