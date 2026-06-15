// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { UserForm } from "./user-form"
import { INITIAL_STATE } from "@/components/admin/form-state"

vi.mock("./actions", () => ({
  createUser: vi.fn(async () => INITIAL_STATE),
  updateUser: vi.fn(async () => INITIAL_STATE),
}))

afterEach(() => cleanup())

const roles = [
  { id: "rol-admin", name: "administrador", label: "Administrador" },
  { id: "rol-jefatura", name: "jefatura", label: "Jefatura" },
]

const permissions = [
  {
    id: "p-admin-users",
    name: "admin:users",
    module: "admin",
    description: "Gestionar usuarios",
    roleIds: ["rol-admin"],
  },
  {
    id: "p-reports-view",
    name: "reports:view",
    module: "reports",
    description: "Ver reportes",
    roleIds: [],
  },
]

const editUser = {
  id: "user-1",
  name: "Alejandro Lopez Zelaya",
  email: "allopze@gmail.com",
  isActive: true,
  roleIds: ["rol-admin"],
  permissionIds: ["p-reports-view"],
  worksiteAssignments: [],
}

describe("UserForm permissions layout", () => {
  it("makes selected roles visually and semantically distinct", () => {
    render(
      <UserForm
        open
        onClose={vi.fn()}
        editUser={editUser}
        allRoles={roles}
        allPermissions={permissions}
        allWorksites={[]}
      />,
    )

    const selectedRole = screen.getByRole("button", { name: "Administrador" })
    expect(selectedRole).toHaveAttribute("aria-pressed", "true")
    expect(selectedRole).toHaveClass("bg-[var(--color-primary)]")
  })

  it("keeps role chip dimensions stable between selected and unselected states", () => {
    render(
      <UserForm
        open
        onClose={vi.fn()}
        editUser={editUser}
        allRoles={roles}
        allPermissions={permissions}
        allWorksites={[]}
      />,
    )

    const selectedRole = screen.getByRole("button", { name: "Administrador" })
    const unselectedRole = screen.getByRole("button", { name: "Jefatura" })

    expect(selectedRole).toHaveClass("font-medium")
    expect(unselectedRole).toHaveClass("font-medium")
    expect(selectedRole.querySelector("[data-role-selection-slot='true']")).toBeInTheDocument()
    expect(unselectedRole.querySelector("[data-role-selection-slot='true']")).toBeInTheDocument()
  })

  it("renders permissions as a labelled scroll region with a precise direct grant counter", () => {
    render(
      <UserForm
        open
        onClose={vi.fn()}
        editUser={editUser}
        allRoles={roles}
        allPermissions={permissions}
        allWorksites={[]}
      />,
    )

    expect(screen.getByText("1 permiso directo")).toBeInTheDocument()

    const permissionsRegion = screen.getByRole("region", { name: "Permisos de usuario" })
    // Inherited permission shows its description (not the technical name)
    expect(within(permissionsRegion).getByText("Gestionar usuarios")).toBeInTheDocument()
    // Directly granted permission shows the technical name in the font-mono label
    expect(within(permissionsRegion).getByText("reports:view")).toBeInTheDocument()
  })
})
