"use client"

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import Link from "next/link"
import { Bell, CheckCircle } from "@phosphor-icons/react"
import { cn, formatDate } from "@/lib/utils"

interface NotificationItem {
  id:         string
  type:       string
  title:      string
  body:       string | null
  entityHref: string | null
  isRead:     boolean
  createdAt:  string
}

interface ApiResponse {
  items:       NotificationItem[]
  unreadCount: number
}

export function NotificationBell() {
  const [data,    setData]    = React.useState<ApiResponse>({ items: [], unreadCount: 0 })
  const [loading, setLoading] = React.useState(false)

  const fetchNotifications = React.useCallback(async () => {
    try {
      const res = await fetch("/api/notifications")
      if (res.ok) {
        const json = await res.json() as ApiResponse
        setData(json)
      }
    } catch { /* ignore */ }
  }, [])

  React.useEffect(() => {
    const firstFetch = setTimeout(() => {
      void fetchNotifications()
    }, 0)
    const interval = setInterval(fetchNotifications, 60_000)
    return () => {
      clearTimeout(firstFetch)
      clearInterval(interval)
    }
  }, [fetchNotifications])

  async function markAllRead() {
    setLoading(true)
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      })
      await fetchNotifications()
    } finally {
      setLoading(false)
    }
  }

  async function markRead(id: string) {
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      setData((prev) => ({
        unreadCount: Math.max(0, prev.unreadCount - 1),
        items: prev.items.map((n) => n.id === id ? { ...n, isRead: true } : n),
      }))
    } catch { /* ignore */ }
  }

  const hasUnread = data.unreadCount > 0

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          className={cn(
            "relative flex items-center justify-center",
            "min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0",
            "h-8 w-8 rounded-[var(--radius-sm)]",
            "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            "hover:bg-[var(--color-surface-2)]",
            "transition-colors duration-[var(--duration-fast)]",
            "active:scale-[0.95]",
          )}
          aria-label={`Notificaciones${hasUnread ? ` (${data.unreadCount} sin leer)` : ""}`}
        >
          <Bell size={16} />
          {hasUnread && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-primary)] text-[9px] font-bold text-white">
              {data.unreadCount > 9 ? "9+" : data.unreadCount}
            </span>
          )}
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={8}
          className={cn(
            "z-50 w-80 rounded-[var(--radius-lg)]",
            "border border-[var(--color-border)]",
            "bg-[var(--color-surface)] shadow-[var(--shadow-md)]",
            "overflow-hidden",
            // Animate in/out via Radix data-state
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
            "duration-[var(--duration-fast)]",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)]">
            <span className="text-sm font-semibold text-[var(--color-text)]">Notificaciones</span>
            {hasUnread && (
              <button
                onClick={markAllRead}
                disabled={loading}
                className="flex items-center gap-1 text-xs text-[var(--color-primary)] hover:text-[var(--color-primary-600)] transition-colors disabled:opacity-50"
              >
                <CheckCircle size={12} />
                Marcar todas leídas
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-[var(--color-border)]">
            {data.items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Bell size={24} className="text-[var(--color-text-subtle)]" />
                <p className="text-sm text-[var(--color-text-muted)]">Sin notificaciones</p>
              </div>
            ) : (
              data.items.map((notif) => (
                <NotificationRow
                  key={notif.id}
                  notification={notif}
                  onRead={() => markRead(notif.id)}
                />
              ))
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

function NotificationRow({
  notification,
  onRead,
}: {
  notification: NotificationItem
  onRead:       () => void
}) {
  function handleClick() {
    if (!notification.isRead) onRead()
  }

  const rowClassName = cn(
    "flex w-full items-start gap-3 px-3 py-2.5 text-left",
    "transition-[background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "hover:bg-[var(--color-surface-2)] focus-visible:bg-[var(--color-surface-2)]",
    "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]",
    "active:scale-[0.99]",
    !notification.isRead && "bg-[var(--color-primary-50)]",
  )

  const content = (
    <>
      <div className="mt-1.5 shrink-0">
        {!notification.isRead
          ? <span className="block h-2 w-2 rounded-full bg-[var(--color-primary)]" />
          : <span className="block h-2 w-2 rounded-full bg-transparent" />}
      </div>

      <div className="min-w-0 flex-1">
        <p className={cn(
          "text-sm leading-snug text-[var(--color-text)]",
          !notification.isRead && "font-medium",
        )}>
          {notification.title}
        </p>
        {notification.body && (
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)] line-clamp-2">
            {notification.body}
          </p>
        )}
        <p className="mt-1 text-[10px] text-[var(--color-text-subtle)]">
          {formatDate(notification.createdAt)}
        </p>
      </div>
    </>
  )

  if (notification.entityHref) {
    return (
      <Link href={notification.entityHref} onClick={handleClick} className={rowClassName}>
        {content}
      </Link>
    )
  }

  return (
    <button type="button" onClick={handleClick} className={rowClassName}>
      {content}
    </button>
  )
}
