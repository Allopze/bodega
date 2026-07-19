import { beforeEach, describe, expect, it, vi } from "vitest"

const rows = vi.hoisted(() => [] as Array<Array<Record<string, unknown>>>)
let selectIndex = 0

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => {
      const current = rows[selectIndex] ?? []
      selectIndex += 1
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn(async () => current) })),
        })),
      }
    }),
  },
}))

import { getDocumentIntegrityFindings } from "@/lib/services/prevention-documents/integrity"

describe("document integrity inventory", () => {
  beforeEach(() => {
    rows.length = 0
    selectIndex = 0
  })

  it("lists inconsistent evidence without mutating historical state", async () => {
    rows.push(
      [
        {
          id: "sdoc-1", title: "Procedimiento crítico", status: "borrador",
          currentVersionId: "sdv-1", confidentiality: "publico_interno",
          worksiteId: "ws-1", requiresAcknowledgment: true,
        },
        {
          id: "sdoc-2", title: "Matriz legal", status: "vigente",
          currentVersionId: "sdv-missing", confidentiality: "publico_interno",
          worksiteId: "ws-1", requiresAcknowledgment: false,
        },
      ],
      [
        {
          id: "sdv-0", documentId: "sdoc-1", version: 0, status: "reemplazado",
          supersedesId: null, approvedBy: "approver", approvedAt: "2026-01-01T00:00:00Z",
        },
        {
          id: "sdv-1", documentId: "sdoc-1", version: 1, status: "vigente",
          supersedesId: null, approvedBy: null, approvedAt: null,
        },
        {
          id: "sdv-2", documentId: "sdoc-1", version: 2, status: "vigente",
          supersedesId: null, approvedBy: "approver", approvedAt: "2026-02-01T00:00:00Z",
        },
      ],
      [],
    )

    const findings = await getDocumentIntegrityFindings(
      { mode: "some", ids: ["ws-1"] },
      ["prevention:docs:publish"],
    )

    expect(findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      "DRAFT_WITH_PUBLISHED_VERSION",
      "PUBLISHED_WITHOUT_APPROVER",
      "MULTIPLE_PUBLISHED_VERSIONS",
      "REPLACED_WITHOUT_SUCCESSOR",
      "ACK_WITHOUT_DISTRIBUTION",
      "CURRENT_VERSION_MISSING",
    ]))
    expect(findings.every((finding) => finding.evidenceUsable === false)).toBe(true)
  })
})
