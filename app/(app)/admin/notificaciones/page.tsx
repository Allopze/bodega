import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import {
  getNotificationMaintenanceStats,
  listNotificationsForAdmin,
} from "@/lib/services/notification-read"
import { getOperationalSettings } from "@/lib/services/system-settings"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { HeaderSignals, type HeaderSignal } from "@/components/ui/header-signals"
import { NotificationAdminList } from "./notification-admin-list"

export const metadata: Metadata = { title: "Notificaciones" }

export default async function AdminNotificationsPage() {
  try {
    await requirePermission("admin:notifications")
  } catch {
    redirect("/forbidden")
  }

  const [rows, stats, ops] = await Promise.all([
    listNotificationsForAdmin({ limit: 500 }),
    getNotificationMaintenanceStats(),
    getOperationalSettings(),
  ])

  // "Sin leer" es la señal accionable (revisar). El total reciente y la
  // retención son config/info: van en la descripción del título.
  const headerSignals: HeaderSignal[] = [
    { key: "unread", label: "Sin leer", value: stats.unreadCount, tone: "signal" },
  ]
  const description = `${stats.totalRecent} recientes · retención ${ops.notificationRetentionDays} días · las leídas se eliminan al superar la retención.`

  return (
    <PageContainer>
      <PageHeader
        title="Notificaciones"
        description={description}
        breadcrumb={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Notificaciones" },
        ]}
        headerActions={<HeaderSignals signals={headerSignals} />}
      />
      <NotificationAdminList
        rows={rows.map((r) => ({
          id: r.id,
          type: r.type,
          title: r.title,
          body: r.body ?? "",
          isRead: r.isRead,
          createdAt: r.createdAt,
          userEmail: r.userEmail ?? "",
          userName: r.userName ?? "",
          entityHref: r.entityHref,
        }))}
        oldestReadDate={stats.oldestReadDate}
        retentionDays={ops.notificationRetentionDays}
      />
    </PageContainer>
  )
}
