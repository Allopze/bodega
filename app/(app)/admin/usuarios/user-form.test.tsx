// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { UserForm } from "./user-form"
import { INITIAL_STATE } from "@/components/admin/form-state"

vi.mock("./actions/create", () => ({
  createUser: vi.fn(async () => INITIAL_STATE),
}))

vi.mock("./actions/update", () => ({
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
  emailNotifications: true,
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

  it("exposes the email-notifications toggle when editing, reflecting the saved value", () => {
    render(
      <UserForm
        open
        onClose={vi.fn()}
        editUser={{ ...editUser, emailNotifications: false }}
        allRoles={roles}
        allPermissions={permissions}
        allWorksites={[]}
      />,
    )

    const toggle = screen.getByLabelText("Recibe notificaciones por correo") as HTMLInputElement
    expect(toggle).toHaveAttribute("name", "emailNotifications")
    expect(toggle.checked).toBe(false)
  })

  it("hides the email-notifications toggle when creating a user", () => {
    render(
      <UserForm
        open
        onClose={vi.fn()}
        editUser={null}
        allRoles={roles}
        allPermissions={permissions}
        allWorksites={[]}
      />,
    )

    expect(screen.queryByLabelText("Recibe notificaciones por correo")).not.toBeInTheDocument()
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

  it("keeps direct permissions in an explicit exception section without technical keys", () => {
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

    expect(screen.getByText("Excepciones de permisos (1)")).toBeInTheDocument()
    const permissionsRegion = screen.getByRole("region", { name: "Excepciones de permisos" })
    expect(within(permissionsRegion).getByText("Gestionar usuarios")).toBeInTheDocument()
    expect(within(permissionsRegion).queryByText("reports:view")).not.toBeInTheDocument()
  })

  it("blocks submission with a clear cause until the access definition is valid", () => {
    render(
      <UserForm
        open
        onClose={vi.fn()}
        editUser={null}
        allRoles={roles}
        allPermissions={permissions}
        allWorksites={[]}
      />,
    )

    const submit = screen.getByRole("button", { name: "Crear usuario" })
    expect(screen.getByRole("alert")).toHaveTextContent("Selecciona al menos un rol")
    expect(submit).toBeDisabled()

    fireEvent.click(screen.getByRole("button", { name: "Administrador" }))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(submit).toBeEnabled()
  })

  it("requires a worksite before enabling a worksite-scoped role", () => {
    render(
      <UserForm
        open
        onClose={vi.fn()}
        editUser={null}
        allRoles={[
          ...roles,
          { id: "rol-prevencion", name: "prevencionista_faena", label: "Prevencionista de faena", requiresWorksiteAssignment: true },
        ]}
        allPermissions={permissions}
        allWorksites={[{ id: "ws-1", name: "Faena Norte", code: "FN-01" }]}
      />,
    )

    const submit = screen.getByRole("button", { name: "Crear usuario" })
    fireEvent.click(screen.getByRole("button", { name: "Prevencionista de faena" }))
    expect(screen.getByRole("alert")).toHaveTextContent("Prevencionista de faena requiere al menos una faena")
    expect(submit).toBeDisabled()

    fireEvent.click(screen.getByRole("checkbox", { name: "Seleccionar Faena Norte (FN-01)" }))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(submit).toBeEnabled()
  })
})
