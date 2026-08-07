import { afterEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

const selectChains: Array<Record<string, ReturnType<typeof vi.fn>>> = []

function createChain() {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.then = (resolve: (value: unknown[]) => void, reject?: (error: unknown) => void) =>
    Promise.resolve([{ value: 0 }]).then(resolve, reject)
  selectChains.push(chain as Record<string, ReturnType<typeof vi.fn>>)
  return chain
}

vi.mock("@/db", () => ({ db: { select: () => createChain() } }))

import { getMaintenanceDashboardSummary } from "@/lib/services/dashboard-fleet-maintenance"

/** Trozos literales y parámetros de un predicado de Drizzle. */
function sqlChunks(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node)
    return out
  }
  if (!node || typeof node !== "object") return out
  if (Array.isArray(node)) {
    for (const item of node) sqlChunks(item, out)
    return out
  }
  const candidate = node as { queryChunks?: unknown[]; value?: unknown }
  if (Array.isArray(candidate.queryChunks)) {
    for (const chunk of candidate.queryChunks) sqlChunks(chunk, out)
    return out
  }
  if (typeof candidate.value === "string") out.push(candidate.value)
  else if (Array.isArray(candidate.value)) {
    for (const part of candidate.value) if (typeof part === "string") out.push(part)
  }
  return out
}

afterEach(() => {
  selectChains.length = 0
  vi.useRealTimers()
})

describe("getMaintenanceDashboardSummary", () => {
  // HALLAZGO 34: 2026-08-08T01:30Z son las 21:30 del 07-08 en Chile (UTC−4).
  // Con `toISOString()` las mantenciones de hoy sumaban a "vencidas".
  it("separa programadas de vencidas por el día chileno, no por el UTC", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-08T01:30:00Z"))
    const session = { user: { id: "user-1", isGlobal: true, worksiteIds: [] } } as unknown as Session

    await getMaintenanceDashboardSummary(session)

    // Las dos primeras consultas son scheduledCount (>= hoy) y overdueCount (< hoy).
    for (const chain of selectChains.slice(0, 2)) {
      const where = sqlChunks(chain.where!.mock.calls[0]![0])
      expect(where).toContain("2026-08-07")
      expect(where).not.toContain("2026-08-08")
    }
  })
})
