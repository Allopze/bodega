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
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
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

  const summaryStats: SummaryStat[] = [
    { key: "unread", label: "Sin leer", value: stats.unreadCount, tone: stats.unreadCount > 0 ? "signal" : undefined },
    { key: "total", label: "Recientes (≤1000)", value: stats.totalRecent },
    { key: "retention", label: "Retención (días)", value: ops.notificationRetentionDays },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Notificaciones"
        description="Audita y limpia las notificaciones internas del sistema. Solo se eliminan notificaciones leídas que superen la retención configurada."
        breadcrumb={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Notificaciones" },
        ]}
      />
      <SummaryBar className="mb-4" stats={summaryStats} />
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
