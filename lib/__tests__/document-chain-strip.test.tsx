import { renderToStaticMarkup } from "react-dom/server"
import type { Session } from "next-auth"
import { describe, expect, it, vi } from "vitest"
import type { DocumentChain } from "@/lib/services/document-chain"

const authMock = vi.fn<() => Promise<Session | null>>()
vi.mock("@/lib/auth/auth", () => ({ auth: () => authMock() }))

const { DocumentChainStrip } = await import("@/components/documents/document-chain-strip")

const CHAIN: DocumentChain = {
  requests: [{ kind: "request", id: "req-1", code: "SOL-0001", href: "/solicitudes/req-1", status: "approved", at: null, worksiteId: "ws-1" }],
  orders: [{ kind: "order", id: "oc-1", code: "OC-2026-0001", href: "/compras/oc-1", status: "issued", at: null, worksiteId: "ws-1" }],
  receipts: [],
  dispatchGuides: [],
  deliveries: [],
}

function session(permissions: string[]): Session {
  return { user: { id: "u-1", permissions, worksiteIds: [] } } as unknown as Session
}

async function markup(permissions: string[]) {
  authMock.mockResolvedValue(session(permissions))
  return renderToStaticMarkup(await DocumentChainStrip({ chain: CHAIN, currentCode: "REC-2026-0001" }))
}

/**
 * El expediente completo exige `traceability:view`, permiso que no tienen los
 * roles de faena que sí ven solicitudes y recepciones: sin el gate el enlace
 * los mandaba a /forbidden.
 */
describe("DocumentChainStrip", () => {
  it("enlaza al expediente cuando la persona tiene traceability:view", async () => {
    expect(await markup(["receiving:view", "traceability:view"])).toContain("Ver expediente")
  })

  it("oculta el enlace al expediente sin traceability:view", async () => {
    const html = await markup(["receiving:view"])
    expect(html).not.toContain("Ver expediente")
    expect(html).toContain("SOL-0001")
  })
})
