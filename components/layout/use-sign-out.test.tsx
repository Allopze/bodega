// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(async (): Promise<void> => {}),
  getSession: vi.fn(async () => null),
  clearAllInspectionDrafts: vi.fn(),
  lockAndPurgeIncidentQueues: vi.fn(async (): Promise<void> => {}),
  clearPpaQueue: vi.fn(async (): Promise<void> => {}),
  clearInspectionSubmissionQueue: vi.fn(async (): Promise<void> => {}),
}))

vi.mock("next-auth/react", () => ({ signOut: mocks.signOut, getSession: mocks.getSession }))
vi.mock("@/lib/prevention/inspection-draft-storage", () => ({ clearAllInspectionDrafts: mocks.clearAllInspectionDrafts }))
vi.mock("@/app/(app)/prevencion/incidentes/reportar/offline-incident-queue", () => ({
  lockAndPurgeIncidentQueues: mocks.lockAndPurgeIncidentQueues,
}))
vi.mock("@/lib/pwa/offline-queue", () => ({ clearPpaQueue: mocks.clearPpaQueue }))
vi.mock("@/app/(app)/prevencion/inspecciones/[runId]/offline-inspection-queue", () => ({
  clearInspectionSubmissionQueue: mocks.clearInspectionSubmissionQueue,
}))

import { useSignOut } from "@/components/layout/use-sign-out"

describe("useSignOut", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // La navegación final a /login no se puede ejecutar en jsdom.
    Object.defineProperty(window, "location", { configurable: true, value: { href: "" } })
  })

  /*
   * Las respuestas de una inspección sin enviar viven en claro en localStorage
   * (esquema v2 del espejo). En un equipo de faena compartido no pueden
   * sobrevivir al cambio de usuario.
   */
  it("vacía el espejo local de inspecciones junto con las colas offline, antes de cerrar la sesión", async () => {
    const order: string[] = []
    mocks.clearAllInspectionDrafts.mockImplementation(() => { order.push("drafts") })
    mocks.clearInspectionSubmissionQueue.mockImplementation(async () => { order.push("cola") })
    mocks.signOut.mockImplementation(async () => { order.push("signOut") })

    const { result } = renderHook(() => useSignOut())
    await act(async () => { await result.current.handleSignOut() })

    expect(mocks.clearAllInspectionDrafts).toHaveBeenCalledTimes(1)
    expect(mocks.clearInspectionSubmissionQueue).toHaveBeenCalledTimes(1)
    expect(mocks.lockAndPurgeIncidentQueues).toHaveBeenCalledTimes(1)
    expect(mocks.clearPpaQueue).toHaveBeenCalledTimes(1)
    expect(order.indexOf("drafts")).toBeLessThan(order.indexOf("signOut"))
    expect(order.indexOf("cola")).toBeLessThan(order.indexOf("signOut"))
    expect(window.location.href).toBe("/login")
  })

  it("si la limpieza del espejo falla, igual cierra la sesión y navega a /login", async () => {
    mocks.clearAllInspectionDrafts.mockImplementation(() => { throw new Error("bloqueado") })
    const { result } = renderHook(() => useSignOut())
    await act(async () => { await result.current.handleSignOut() })
    expect(mocks.signOut).toHaveBeenCalled()
    expect(window.location.href).toBe("/login")
  })
})
