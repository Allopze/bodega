import { describe, expect, it } from "vitest"
import type { OperationalWorkItem, OperationalWorkItemBase } from "./operational-work-queue"
import { sql } from "drizzle-orm"
import { buildOperationalWorkItem, paginateOperationalWorkItems, probeOperationalSourceBranches } from "./operational-work-queue"

function item(id: string, priority: OperationalWorkItem["priority"], createdAt: string): OperationalWorkItem {
  return {
    id,
    sourceType: "purchase_request",
    sourceId: id,
    actionKey: "follow_up",
    module: "solicitudes",
    title: id,
    subtitle: "Faena Norte",
    worksiteId: "ws-norte",
    worksiteName: "Faena Norte",
    status: "submitted",
    statusLabel: "Enviada",
    priority,
    blocked: false,
    createdAt,
    sourceDueAt: null,
    assignee: null,
    href: `/solicitudes/${id}`,
    ctaLabel: "Revisar solicitud",
  }
}

function baseItem(id: string, priority: OperationalWorkItem["priority"], createdAt: string): OperationalWorkItemBase {
  const { id: _id, assignee: _assignee, ...base } = item(id, priority, createdAt)
  return base
}

describe("paginateOperationalWorkItems", () => {
  it("continues after the cursor even if the previous row was resolved", () => {
    const critical = item("critical", "critical", "2026-07-01T10:00:00.000Z")
    const high = item("high", "high", "2026-07-02T10:00:00.000Z")
    const normal = item("normal", "normal", "2026-07-03T10:00:00.000Z")
    const firstPage = paginateOperationalWorkItems([critical, high, normal], { sort: "priority", limit: 1 })

    const secondPage = paginateOperationalWorkItems([high, normal], {
      sort: "priority",
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
    })

    expect(secondPage.items.map((entry) => entry.id)).toEqual(["high"])
  })

  it("does not reuse a cursor produced for another order", () => {
    const older = item("older", "normal", "2026-07-01T10:00:00.000Z")
    const newer = item("newer", "normal", "2026-07-03T10:00:00.000Z")
    const priorityPage = paginateOperationalWorkItems([older, newer], { sort: "priority", limit: 1 })

    const newestPage = paginateOperationalWorkItems([older, newer], {
      sort: "newest",
      limit: 1,
      cursor: priorityPage.nextCursor ?? undefined,
    })

    expect(newestPage.items.map((entry) => entry.id)).toEqual(["newer"])
  })
})

describe("buildOperationalWorkItem", () => {
  it("preserves the date supplied by the source stage", () => {
    const result = buildOperationalWorkItem({
      ...baseItem("approval", "high", "2026-07-01T10:00:00.000Z"),
      sourceDueAt: "2026-07-10",
    })

    expect(result).toMatchObject({
      id: "purchase_request:approval:follow_up",
      sourceDueAt: "2026-07-10",
      assignee: null,
    })
  })
})

describe("probeOperationalSourceBranches", () => {
  it("keeps healthy modules and reports only the failed source", async () => {
    const branches = [
      { module: "compras" as const, query: sql`SELECT 1` },
      { module: "recepciones" as const, query: sql`SELECT 2` },
      { module: "pdtp" as const, query: sql`SELECT 3` },
    ]
    let calls = 0
    const recovery = await probeOperationalSourceBranches(branches, async () => {
      calls += 1
      if (calls === 2) throw new Error("fuente no disponible")
    })

    expect(calls).toBe(3)
    expect(recovery.healthy.map((branch) => branch.module)).toEqual(["compras", "pdtp"])
    expect(recovery.sourceErrors).toEqual([{
      module: "recepciones",
      message: "No fue posible cargar las tareas de recepciones. El resto de la cola permanece disponible.",
    }])
  })
})
