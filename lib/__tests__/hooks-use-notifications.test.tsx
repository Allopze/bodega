// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { useNotifications, useMarkRead, useMarkAllRead } from "@/lib/hooks/use-notifications"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as React from "react"
import type { Mock } from "vitest"

const mockMarkReadAction = vi.fn()
const mockMarkAllReadAction = vi.fn()

vi.mock("@/app/(app)/notificaciones/actions", () => ({
  markReadAction: (id: string) => mockMarkReadAction(id),
  markAllReadAction: () => mockMarkAllReadAction(),
}))

const createWrapper = (queryClient: QueryClient) => {
  const QueryWrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  QueryWrapper.displayName = "QueryWrapper"
  return QueryWrapper
}

describe("useNotifications hooks", () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
        mutations: { retry: false },
      },
    })
    globalThis.fetch = vi.fn()
  })

  describe("useNotifications", () => {
    it("fetches notifications successfully", async () => {
      const mockData = {
        items: [
          { id: "1", type: "info", title: "Test", body: "Body", entityHref: "/href", isRead: false, createdAt: "2026-06-20" },
        ],
        unreadCount: 1,
      }

      const fetchMock = globalThis.fetch as unknown as Mock
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockData,
      } as never)

      const { result } = renderHook(() => useNotifications(), { wrapper: createWrapper(queryClient) })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      expect(globalThis.fetch).toHaveBeenCalledWith("/api/notifications")
      expect(result.current.data).toEqual(mockData)
    })

    it("handles fetch error", async () => {
      const fetchMock = globalThis.fetch as unknown as Mock
      fetchMock.mockResolvedValue({
        ok: false,
      } as never)

      const { result } = renderHook(() => useNotifications(), { wrapper: createWrapper(queryClient) })

      await waitFor(() => expect(result.current.isError).toBe(true))

      expect(result.current.error?.message).toBe("Error al cargar notificaciones")
    })
  })

  describe("useMarkRead", () => {
    it("performs optimistic update and calls action successfully", async () => {
      const initialData = {
        items: [
          { id: "1", type: "info", title: "Test 1", body: "Body 1", entityHref: "/href", isRead: false, createdAt: "2026-06-20" },
          { id: "2", type: "info", title: "Test 2", body: "Body 2", entityHref: "/href", isRead: false, createdAt: "2026-06-20" },
        ],
        unreadCount: 2,
      }

      queryClient.setQueryData(["notifications"], initialData)
      mockMarkReadAction.mockResolvedValue({ ok: true })

      const { result } = renderHook(() => useMarkRead(), { wrapper: createWrapper(queryClient) })

      await act(async () => {
        result.current.mutate("1")
      })

      // Verify cache immediately got updated optimistically
      const cachedData = queryClient.getQueryData<{ items: Array<{ isRead: boolean }>; unreadCount: number }>(["notifications"])
      expect(cachedData).toBeDefined()
      expect(cachedData!.items[0]!.isRead).toBe(true)
      expect(cachedData!.items[1]!.isRead).toBe(false)
      expect(cachedData!.unreadCount).toBe(1)
      expect(mockMarkReadAction).toHaveBeenCalledWith("1")
    })

    it("rolls back optimistic update on action failure", async () => {
      const initialData = {
        items: [
          { id: "1", type: "info", title: "Test 1", body: "Body 1", entityHref: "/href", isRead: false, createdAt: "2026-06-20" },
        ],
        unreadCount: 1,
      }

      queryClient.setQueryData(["notifications"], initialData)
      mockMarkReadAction.mockResolvedValue({ ok: false, error: "Database error" })

      const { result } = renderHook(() => useMarkRead(), { wrapper: createWrapper(queryClient) })

      await act(async () => {
        result.current.mutate("1")
      })

      // After failure, cache should roll back to initialData
      const cachedData = queryClient.getQueryData<{ items: Array<{ isRead: boolean }>; unreadCount: number }>(["notifications"])
      expect(cachedData).toBeDefined()
      expect(cachedData!.items[0]!.isRead).toBe(false)
      expect(cachedData!.unreadCount).toBe(1)
    })
  })

  describe("useMarkAllRead", () => {
    it("performs optimistic update and marks all as read", async () => {
      const initialData = {
        items: [
          { id: "1", type: "info", title: "Test 1", body: "Body 1", entityHref: "/href", isRead: false, createdAt: "2026-06-20" },
          { id: "2", type: "info", title: "Test 2", body: "Body 2", entityHref: "/href", isRead: false, createdAt: "2026-06-20" },
        ],
        unreadCount: 2,
      }

      queryClient.setQueryData(["notifications"], initialData)
      mockMarkAllReadAction.mockResolvedValue({ ok: true })

      const { result } = renderHook(() => useMarkAllRead(), { wrapper: createWrapper(queryClient) })

      await act(async () => {
        result.current.mutate()
      })

      const cachedData = queryClient.getQueryData<{ items: Array<{ isRead: boolean }>; unreadCount: number }>(["notifications"])
      expect(cachedData).toBeDefined()
      expect(cachedData!.items[0]!.isRead).toBe(true)
      expect(cachedData!.items[1]!.isRead).toBe(true)
      expect(cachedData!.unreadCount).toBe(0)
      expect(mockMarkAllReadAction).toHaveBeenCalled()
    })

    it("rolls back optimistic update on action failure", async () => {
      const initialData = {
        items: [
          { id: "1", type: "info", title: "Test 1", body: "Body 1", entityHref: "/href", isRead: false, createdAt: "2026-06-20" },
        ],
        unreadCount: 1,
      }

      queryClient.setQueryData(["notifications"], initialData)
      mockMarkAllReadAction.mockResolvedValue({ ok: false, error: "Action error" })

      const { result } = renderHook(() => useMarkAllRead(), { wrapper: createWrapper(queryClient) })

      await act(async () => {
        result.current.mutate()
      })

      const cachedData = queryClient.getQueryData<{ items: Array<{ isRead: boolean }>; unreadCount: number }>(["notifications"])
      expect(cachedData).toBeDefined()
      expect(cachedData!.items[0]!.isRead).toBe(false)
      expect(cachedData!.unreadCount).toBe(1)
    })
  })
})
