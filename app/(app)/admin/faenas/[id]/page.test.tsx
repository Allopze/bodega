// @vitest-environment jsdom
import type * as React from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  getView: vi.fn(),
  mandantes: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  redirect: (href: string) => { throw new Error(`REDIRECT ${href}`) },
  notFound: () => { throw new Error("NOT_FOUND") },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/faenas/ws-1",
}))
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock("@/lib/auth/can", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/can")>("@/lib/auth/can")
  return { ...actual, requirePermission: (...args: unknown[]) => mocks.requirePermission(...args) }
})
vi.mock("@/lib/services/contracts/worksite-view", () => ({ getWorksiteContractView: (...args: unknown[]) => mocks.getView(...args) }))
vi.mock("@/lib/services/contracts/contracts", () => ({ listMandanteOptions: (...args: unknown[]) => mocks.mandantes(...args) }))
vi.mock("./contract-actions", () => ({ saveOperationalContractAction: vi.fn(), createMandanteAction: vi.fn(), assignVehiclesAction: vi.fn() }))
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) => (
    <header><h1>{title}</h1><p>{description}</p>{actions}</header>
  ),
}))

import Page from "./page"

const view = {
  worksite: { id: "ws-1", name: "Cholguan - Arauco", code: "CHO" },
  contracts: [],
  unassignedVehicles: [],
  assignableVehicles: [],
}

function sessionWith(permissions: string[], worksiteIds: string[], isGlobal = false) {
  return { user: { id: "u1", permissions, worksiteIds, isGlobal } }
}

const open = () => Page({ params: Promise.resolve({ id: "ws-1" }) })

beforeEach(() => {
  mocks.getView.mockResolvedValue(view)
  mocks.mandantes.mockResolvedValue({ clients: [], suggestions: [] })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("/admin/faenas/[id]", () => {
  it("redirige a /forbidden sin admin:worksites", async () => {
    mocks.requirePermission.mockRejectedValue(new Error("FORBIDDEN"))
    await expect(open()).rejects.toThrow("REDIRECT /forbidden")
    expect(mocks.requirePermission).toHaveBeenCalledWith("admin:worksites")
  })

  it("404 fuera del alcance de faena", async () => {
    mocks.requirePermission.mockResolvedValue(sessionWith(["admin:worksites"], ["ws-otra"]))
    await expect(open()).rejects.toThrow("NOT_FOUND")
    expect(mocks.getView).not.toHaveBeenCalled()
  })

  it("404 si la faena no existe", async () => {
    mocks.requirePermission.mockResolvedValue(sessionWith(["admin:worksites"], [], true))
    mocks.getView.mockResolvedValue(null)
    await expect(open()).rejects.toThrow("NOT_FOUND")
  })

  it("con alcance sobre la faena muestra su nombre y la descripción", async () => {
    mocks.requirePermission.mockResolvedValue(sessionWith(["admin:worksites"], ["ws-1"]))
    render(await open())
    expect(screen.getByRole("heading", { name: "Cholguan - Arauco" })).toBeInTheDocument()
    expect(screen.getByText("CHO · 0 equipos · 0 contratos")).toBeInTheDocument()
  })
})
