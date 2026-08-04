// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { NotificationBell } from "./notification-bell"

const markRead = vi.fn()
const markAllRead = vi.fn()

vi.mock("@/lib/hooks/use-notifications", () => ({
  useNotifications: () => ({
    isLoading: false,
    data: {
      unreadCount: 1,
      items: [{
        id: "notification-1",
        title: "Solicitud pendiente",
        body: "Requiere tu revisión",
        createdAt: "2026-08-02T14:00:00.000Z",
        isRead: false,
        entityHref: null,
      }],
    },
  }),
  useMarkRead: () => ({ mutate: markRead, isPending: false }),
  useMarkAllRead: () => ({ mutate: markAllRead, isPending: false }),
}))

describe("NotificationBell", () => {
  it("opens the notification content in a labelled mobile sheet", () => {
    render(<NotificationBell />)

    const triggers = screen.getAllByRole("button", { name: "Notificaciones (1 sin leer)" })
    fireEvent.click(triggers[1]!)

    const sheet = screen.getByRole("dialog", { name: "Notificaciones" })
    expect(within(sheet).getByText("Solicitud pendiente")).toBeInTheDocument()
    expect(within(sheet).getByRole("button", { name: "Marcar todas leídas" })).toBeInTheDocument()
  })
})
