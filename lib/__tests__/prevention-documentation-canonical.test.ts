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
  it("uses Documentación (/prevencion/documentacion) as the navigation surface", () => {
    const hrefs = collectNavHrefs()

    expect(hrefs).toContain("/prevencion/documentacion")
    expect(hrefs).not.toContain("/prevencion/documentacion/revisiones")
    expect(hrefs).not.toContain("/prevencion/documentacion/vencimientos")
    expect(hrefs).not.toContain("/prevencion/biblioteca")
    expect(preventionModule.permissions.some((permission) => permission.startsWith("prevention:legal_docs:"))).toBe(false)
    expect(Object.keys(preventionModule.permissionMeta).some((permission) => permission.startsWith("prevention:legal_docs:"))).toBe(false)
    expect(preventionModule.defaultGrants?.some((seed) => seed.permission.startsWith("prevention:legal_docs:")) ?? false).toBe(false)
    expect(preventionModule.permissions).not.toContain("prevention:docs:export")
    expect(preventionModule.permissions).not.toContain("prevention:docs:approve")
    expect(preventionModule.permissions).not.toContain("prevention:docs:ack")
    expect(preventionModule.permissions).not.toContain("prevention:docs:link")
    expect(Object.keys(preventionModule.permissionMeta)).not.toContain("prevention:docs:export")
    expect(Object.keys(preventionModule.permissionMeta)).not.toContain("prevention:docs:approve")
    expect(Object.keys(preventionModule.permissionMeta)).not.toContain("prevention:docs:ack")
    expect(Object.keys(preventionModule.permissionMeta)).not.toContain("prevention:docs:link")
    expect(preventionModule.defaultGrants?.some((seed) => String(seed.permission) === "prevention:docs:export") ?? false).toBe(false)
    expect(preventionModule.defaultGrants?.some((seed) => String(seed.permission) === "prevention:docs:approve") ?? false).toBe(false)
    expect(preventionModule.defaultGrants?.some((seed) => String(seed.permission) === "prevention:docs:ack") ?? false).toBe(false)
    expect(preventionModule.defaultGrants?.some((seed) => String(seed.permission) === "prevention:docs:link") ?? false).toBe(false)
  })

  it("exposes the documentacion app routes and does not have legacy surfaces", () => {
    const root = process.cwd()

    expect(existsSync(path.join(root, "app/(app)/prevencion/documentacion/page.tsx"))).toBe(true)
    expect(existsSync(path.join(root, "app/(app)/prevencion/documentacion/actions.ts"))).toBe(true)
    expect(existsSync(path.join(root, "app/api/prevencion/documentacion/export/route.ts"))).toBe(false)
    expect(existsSync(path.join(root, "lib/services/prevention-legal-docs.ts"))).toBe(false)
    expect(readFileSync(path.join(root, "app/(app)/prevencion/documentacion/nuevo/page.tsx"), "utf8")).toContain('redirect("/prevencion/documentacion")')
    expect(readFileSync(path.join(root, "app/(app)/prevencion/documentacion/revisiones/page.tsx"), "utf8")).toContain('redirect("/prevencion/documentacion")')
    expect(readFileSync(path.join(root, "app/(app)/prevencion/documentacion/vencimientos/page.tsx"), "utf8")).toContain('redirect("/prevencion/documentacion")')
    expect(existsSync(path.join(root, "app/api/cron/sst-document-expiry/route.ts"))).toBe(false)

    const actionsSource = readFileSync(path.join(root, "app/(app)/prevencion/documentacion/actions.ts"), "utf8")
    expect(actionsSource).not.toContain("createSstDocumentAction")
    expect(actionsSource).not.toContain("updateSstDocumentAction")
    expect(actionsSource).not.toContain("approveSstDocumentAction")
    expect(actionsSource).not.toContain("observeSstDocumentAction")
    expect(actionsSource).not.toContain("changeSstDocumentStatusAction")
    expect(actionsSource).not.toContain("linkSstDocumentAction")
    expect(actionsSource).not.toContain("unlinkSstDocumentAction")
    expect(actionsSource).not.toContain("acknowledgeSstDocumentAction")
    expect(actionsSource).not.toContain("prevention:docs:approve")
    expect(actionsSource).not.toContain("prevention:docs:ack")
    expect(actionsSource).not.toContain("prevention:docs:link")

    const validationSource = readFileSync(path.join(root, "lib/validation/prevention.ts"), "utf8")
    expect(validationSource).not.toContain("legalDocumentCreateSchema")
    expect(validationSource).not.toContain("legalDocumentVersionAddSchema")
    expect(validationSource).not.toContain("documentDeliveryCreateSchema")
  })
})
