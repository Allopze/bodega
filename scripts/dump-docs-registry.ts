import { registry } from "@/modules/registry"
import type { ModuleManifest } from "@/modules/manifest-types"

const out = registry.map(m => ({
  id: m.id,
  permissions: [...(m.permissions ?? [])],
  permissionMeta: (m as ModuleManifest).permissionMeta ?? null,
  nav: (m as ModuleManifest).nav ?? null,
  hasSeed: typeof (m as ModuleManifest).seed === "function",
  defaultGrants: (m as ModuleManifest).defaultGrants ?? null,
}))
console.log(JSON.stringify(out, null, 2))
