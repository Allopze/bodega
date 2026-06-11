/**
 * core/notifications — In-app notification service
 *
 * Forward shim. Fuente de verdad: lib/services/notifications.ts
 * En Fase 3 el contenido se moverá aquí.
 *
 * Uso en módulos:
 *   import { notifySafe, notifyManyUser, getUserIdsWithPermission } from "@/core/notifications"
 */
export {
  createNotification,
  createNotifications,
  notifySafe,
  notifyManyUser,
  getUserIdsWithPermission,
  getNotificationsForUser,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  cleanupOldNotifications,
} from "@/lib/services/notifications"
export type { CreateNotificationInput, NotificationRow } from "@/lib/services/notifications"
