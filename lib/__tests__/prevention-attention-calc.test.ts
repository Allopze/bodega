import { describe, expect, it } from "vitest"
import { pickAttention, type PreventionAttentionItem } from "@/lib/services/prevention-attention"

/**
 * I-11 (auditoría UI/UX 2026-08-25): el `.slice(0, limit)` se aplicaba sobre
 * el ranking global sin repartir por tipo — un origen ruidoso (12 acciones
 * PDTP vencidas, algo normal) se comía los 12 cupos y las inspecciones
 * pendientes de revisión no aparecían nunca, aunque hubiera diez esperando.
 */

let seq = 0
const item = (over: Partial<PreventionAttentionItem> = {}): PreventionAttentionItem => ({
  id: `id-${seq++}`,
  kind: "action",
  title: "t",
  detail: "d",
  worksiteName: "w",
  dueDate: "2026-08-01",
  href: "/x",
  tone: "danger",
  ...over,
})

describe("pickAttention", () => {
  it("reparte por tipo: 12 acciones vencidas no ahogan una inspección pendiente", () => {
    const actions = Array.from({ length: 12 }, (_, i) => item({ id: `a${i}`, kind: "action", dueDate: `2026-08-${String(i + 1).padStart(2, "0")}` }))
    const inspection = item({ id: "insp-1", kind: "inspection", tone: "warning", dueDate: "2026-08-05" })
    const picked = pickAttention([...actions, inspection], 12)
    expect(picked.some((entry) => entry.kind === "inspection")).toBe(true)
  })

  it("dentro de lo elegido, la urgencia sigue mandando (danger antes que warning, luego por fecha)", () => {
    const picked = pickAttention([
      item({ id: "warn-early", kind: "action", tone: "warning", dueDate: "2026-08-01" }),
      item({ id: "danger-late", kind: "evaluation", tone: "danger", dueDate: "2026-08-20" }),
      item({ id: "danger-early", kind: "ppa", tone: "danger", dueDate: "2026-08-05" }),
    ], 3)
    expect(picked.map((entry) => entry.id)).toEqual(["danger-early", "danger-late", "warn-early"])
  })

  it("sin exceder el pool real, el resultado no supera el total de ítems", () => {
    const picked = pickAttention([item({ id: "a" }), item({ id: "b", kind: "evaluation" })], 12)
    expect(picked).toHaveLength(2)
  })

  it("con un solo tipo, se comporta como el orden global de siempre", () => {
    const picked = pickAttention([
      item({ id: "b", tone: "warning", dueDate: "2026-08-02" }),
      item({ id: "a", tone: "danger", dueDate: "2026-08-10" }),
    ], 5)
    expect(picked.map((entry) => entry.id)).toEqual(["a", "b"])
  })
})
