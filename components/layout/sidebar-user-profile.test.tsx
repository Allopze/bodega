// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import { SidebarUserProfile } from "./sidebar-user-profile"

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
  // `useSignOut` confirma contra el servidor que la sesión murió antes de salir.
  getSession: vi.fn(async () => null),
}))

function makeSession(permissions: string[] = []): Session {
  return {
    expires: "2026-12-31T00:00:00.000Z",
    user: {
      id: "user-1",
      name: "Admin Chome",
      email: "admin@chome.cl",
      roles: ["administrador"],
      permissions,
      worksiteIds: [],
      primaryWorksiteId: null,
      avatarColor: null,
      isActive: true,
      isGlobal: true,
    },
  }
}

describe("SidebarUserProfile", () => {
  it("opens the admin user menu without React key warnings", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      render(<SidebarUserProfile session={makeSession(["admin:users"])} />)

      fireEvent.pointerDown(await screen.findByRole("button", { name: "Abrir menú de usuario" }), {
        button: 0,
        ctrlKey: false,
      })

      expect(screen.getByRole("menuitem", { name: /Administración/i })).toBeInTheDocument()
      expect(consoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('Each child in a list should have a unique "key" prop.'),
        expect.anything(),
      )
    } finally {
      consoleError.mockRestore()
    }
  })
})
