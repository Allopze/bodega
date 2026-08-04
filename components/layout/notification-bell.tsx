"use client"

import * as React from "react"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Sheet, SheetBody, SheetCloseButton, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import Link from "next/link"
import { Bell, CheckCircle } from "@phosphor-icons/react"
import { cn, formatDate } from "@/lib/utils"
import { useNotifications, useMarkRead, useMarkAllRead } from "@/lib/hooks/use-notifications"
import type { NotificationItem } from "@/lib/hooks/use-notifications"

export function NotificationBell() {
  const { data, isLoading } = useNotifications()
  const markRead   = useMarkRead()
  const markAllRead = useMarkAllRead()
  const [sheetOpen, setSheetOpen] = React.useState(false)

  const hasUnread = (data?.unreadCount ?? 0) > 0

  return (
    <>
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative hidden items-center justify-center sm:flex",
            "sm:min-h-0 sm:min-w-0",
            "h-8 w-8 rounded-[var(--radius-lg)]",
            "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            "hover:bg-(--color-chrome-hover)",
            "transition-[background-color,color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          )}
          aria-label={`Notificaciones${hasUnread ? ` (${data?.unreadCount} sin leer)` : ""}`}
        >
          <Bell size={16} />
          {hasUnread && data && (
            <>
              <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-primary)] text-[9px] font-bold text-white animate-in fade-in zoom-in-95 duration-[var(--duration-fast)]">
                {data.unreadCount > 9 ? "9+" : data.unreadCount}
              </span>
              <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-[var(--color-primary)] animate-ping opacity-50" />
            </>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 overflow-hidden"
      >
        <NotificationPanel
          data={data}
          isLoading={isLoading}
          hasUnread={hasUnread}
          markRead={markRead}
          markAllRead={markAllRead}
        />
      </PopoverContent>
    </Popover>

    <button
      type="button"
      onClick={() => setSheetOpen(true)}
      className={cn(
        "relative flex min-h-11 min-w-11 items-center justify-center sm:hidden",
        "h-11 w-11 rounded-[var(--radius-lg)] text-[var(--color-text-muted)]",
        "hover:bg-(--color-chrome-hover) hover:text-[var(--color-text)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
      )}
      aria-label={`Notificaciones${hasUnread ? ` (${data?.unreadCount} sin leer)` : ""}`}
    >
      <Bell size={18} />
      {hasUnread && data && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-primary)] px-1 text-[9px] font-bold text-white">{data.unreadCount > 9 ? "9+" : data.unreadCount}</span>}
    </button>

    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      <SheetContent className="sm:hidden">
        <SheetHeader>
          <SheetTitle>Notificaciones</SheetTitle>
          <SheetCloseButton />
        </SheetHeader>
        <SheetBody className="min-h-0 p-0">
          <NotificationPanel
            data={data}
            isLoading={isLoading}
            hasUnread={hasUnread}
            markRead={markRead}
            markAllRead={markAllRead}
            showTitle={false}
            mobile
            onNavigate={() => setSheetOpen(false)}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
    </>
  )
}

function NotificationPanel({
  data,
  isLoading,
  hasUnread,
  markRead,
  markAllRead,
  showTitle = true,
  mobile = false,
  onNavigate,
}: {
  data: ReturnType<typeof useNotifications>["data"]
  isLoading: boolean
  hasUnread: boolean
  markRead: ReturnType<typeof useMarkRead>
  markAllRead: ReturnType<typeof useMarkAllRead>
  showTitle?: boolean
  mobile?: boolean
  onNavigate?: () => void
}) {
  return (
    <>
      <div className={cn("flex items-center gap-3 border-b border-[var(--color-border)] px-3 py-2.5", showTitle ? "justify-between" : "justify-end")}>
        {showTitle && <span className="text-sm font-semibold text-[var(--color-text)]">Notificaciones</span>}
        {hasUnread && (
          <button
            type="button"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            className="min-h-11 inline-flex items-center gap-1 text-xs text-[var(--color-primary)] transition-colors hover:text-[var(--color-primary-ink)] disabled:opacity-50 sm:min-h-0"
          >
            <CheckCircle size={14} />
            Marcar todas leídas
          </button>
        )}
      </div>
      <div className={cn("divide-y divide-[var(--color-border)] overflow-y-auto", mobile ? "max-h-none" : "max-h-80")}>
        {!data || data.items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Bell size={24} className="text-[var(--color-text-subtle)]" />
            <p className="text-sm text-[var(--color-text-muted)]">{isLoading ? "Cargando..." : "Sin notificaciones"}</p>
          </div>
        ) : data.items.map((notif) => (
          <NotificationRowItem key={notif.id} notification={notif} markRead={markRead} onNavigate={onNavigate} />
        ))}
      </div>
    </>
  )
}

const NotificationRowItem = React.memo(function NotificationRowItem({
  notification,
  markRead,
  onNavigate,
}: {
  notification: NotificationItem
  markRead: ReturnType<typeof useMarkRead>
  onNavigate?: () => void
}) {
  return (
    <NotificationRow
      notification={notification}
      onRead={() => markRead.mutate(notification.id)}
      onNavigate={onNavigate}
    />
  )
})

function NotificationRow({
  notification,
  onRead,
  onNavigate,
}: {
  notification: NotificationItem
  onRead:       () => void
  onNavigate?: () => void
}) {
  function handleClick() {
    if (!notification.isRead) onRead()
    onNavigate?.()
  }

  const rowClassName = cn(
    "flex min-h-11 w-full items-start gap-3 px-3 py-2.5 text-left sm:min-h-0",
    "transition-[background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "hover:bg-[var(--color-surface-2)] focus-visible:bg-[var(--color-surface-2)]",
    "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]",
    "",
    !notification.isRead && "bg-[var(--color-primary-tint)]",
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
