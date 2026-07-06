/**
 * In-app notification service — barrel.
 *
 * Re-exports from:
 *   - notification-create.ts     (createNotification, createNotifications, notifySafe, etc.)
 *   - notification-read.ts        (getNotificationsForUser, markNotificationRead, etc.)
 *   - notification-targeting.ts   (getUserIdsWithPermission, getUserIdsWithPermissionForWorksite)
 *
 * Design: fire-and-forget — notification creation never blocks the main action.
 */

export {
  createNotification,
  createNotifications,
  notifySafe,
  notifySafeWithRetry,
  notifyManyUser,
  notifyAfterCommit,
} from "./notification-create"
export type { CreateNotificationInput } from "./notification-create"

export {
  getNotificationsForUser,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  cleanupOldNotifications,
} from "./notification-read"
export type { NotificationRow } from "./notification-read"

export {
  getUserIdsWithPermission,
  getUserIdsWithPermissionForWorksite,
} from "./notification-targeting"
