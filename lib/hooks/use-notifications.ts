"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

export interface NotificationItem {
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

const NOTIFICATIONS_KEY = "notifications" as const

async function fetchNotifications(): Promise<ApiResponse> {
  const res = await fetch("/api/notifications")
  if (!res.ok) throw new Error("Error al cargar notificaciones")
  return res.json() as Promise<ApiResponse>
}

/**
 * Fetches notifications with automatic polling every 60s,
 * retry on failure, and cached data.
 */
export function useNotifications() {
  return useQuery({
    queryKey: [NOTIFICATIONS_KEY],
    queryFn:  fetchNotifications,
    refetchInterval: 60_000,       // poll every 60s (replaces setInterval)
    staleTime:        30_000,
    select:           (data) => data,
  })
}

/**
 * Marks a single notification as read (optimistic update).
 */
export function useMarkRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error("Error al marcar como leída")
    },
    onMutate: async (id) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: [NOTIFICATIONS_KEY] })
      const prev = queryClient.getQueryData<ApiResponse>([NOTIFICATIONS_KEY])
      if (prev) {
        queryClient.setQueryData<ApiResponse>([NOTIFICATIONS_KEY], {
          items: prev.items.map((n) =>
            n.id === id ? { ...n, isRead: true } : n
          ),
          unreadCount: Math.max(0, prev.unreadCount - 1),
        })
      }
      return { prev }
    },
    onError: (_err, _id, context) => {
      // Rollback on error
      if (context?.prev) {
        queryClient.setQueryData([NOTIFICATIONS_KEY], context.prev)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [NOTIFICATIONS_KEY] })
    },
  })
}

/**
 * Marks all notifications as read.
 */
export function useMarkAllRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      })
      if (!res.ok) throw new Error("Error al marcar todas como leídas")
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: [NOTIFICATIONS_KEY] })
      const prev = queryClient.getQueryData<ApiResponse>([NOTIFICATIONS_KEY])
      if (prev) {
        queryClient.setQueryData<ApiResponse>([NOTIFICATIONS_KEY], {
          items: prev.items.map((n) => ({ ...n, isRead: true })),
          unreadCount: 0,
        })
      }
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        queryClient.setQueryData([NOTIFICATIONS_KEY], context.prev)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [NOTIFICATIONS_KEY] })
    },
  })
}
