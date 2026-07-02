import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { preventionModule } from "@/modules/prevention/manifest"

type NavItem = {
  href: string
  children?: NavItem[]
}

function collectNavHrefs() {
  const hrefs: string[] = []
  for (const group of preventionModule.nav) {
    for (const item of group.items as readonly NavItem[]) {
      hrefs.push(item.href)
      for (const child of item.children ?? []) {
        hrefs.push(child.href)
      }
    }
  }
  return hrefs
}

describe("prevention documentation canonical surface", () => {
  it("uses Biblioteca SST as the only documentation navigation surface", () => {
    const hrefs = collectNavHrefs()

    expect(hrefs).toContain("/prevencion/biblioteca")
    expect(hrefs).not.toContain("/prevencion/documentacion")
    expect(preventionModule.permissions.some((permission) => permission.startsWith("prevention:legal_docs:"))).toBe(false)
    expect(Object.keys(preventionModule.permissionMeta).some((permission) => permission.startsWith("prevention:legal_docs:"))).toBe(false)
    expect(preventionModule.defaultGrants?.some((seed) => seed.permission.startsWith("prevention:legal_docs:")) ?? false).toBe(false)
  })

  it("does not expose the legacy documentacion app or export routes", () => {
    const root = process.cwd()

    expect(existsSync(path.join(root, "app/(app)/prevencion/documentacion/page.tsx"))).toBe(false)
    expect(existsSync(path.join(root, "app/(app)/prevencion/documentacion/actions.ts"))).toBe(false)
    expect(existsSync(path.join(root, "app/api/prevencion/documentacion/export/route.ts"))).toBe(false)
    expect(existsSync(path.join(root, "lib/services/prevention-legal-docs.ts"))).toBe(false)

    const validationSource = readFileSync(path.join(root, "lib/validation/prevention.ts"), "utf8")
    expect(validationSource).not.toContain("legalDocumentCreateSchema")
    expect(validationSource).not.toContain("legalDocumentVersionAddSchema")
    expect(validationSource).not.toContain("documentDeliveryCreateSchema")
  })
})
