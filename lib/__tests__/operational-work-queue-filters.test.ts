import { describe, expect, it, vi } from "vitest"

vi.mock("@/db", () => ({ db: {} }))

import { parseOperationalQueueFilters } from "@/lib/services/operational-work-queue"

describe("parseOperationalQueueFilters", () => {
  it("conserva el filtro del módulo CPHS", () => {
    expect(parseOperationalQueueFilters({ module: "cphs" }).module).toBe("cphs")
  })
})
