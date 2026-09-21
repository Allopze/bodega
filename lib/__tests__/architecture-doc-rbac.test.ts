import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { SYSTEM_ROLES } from "@/lib/auth/system-rbac"
import { registry } from "@/modules/registry"

/**
 * ARCHITECTURE.md afirmaba 11 roles (eran 15) y se contradecía sola sobre los permisos:
 * 223 en la tabla de módulos y 109 más abajo, contra 273 reales. Una documentación de
 * RBAC equivocada induce errores de administración y de auditoría, que es justamente lo
 * que nadie revisa a mano. Esto la ata al código en vez de confiar en que alguien la
 * actualice: si cambia un rol o un permiso, falla acá y no en producción.
 */
const doc = fs.readFileSync(path.join(process.cwd(), "ARCHITECTURE.md"), "utf8")

describe("ARCHITECTURE.md · RBAC declarado vs. código", () => {
  it("declara el número real de roles y los nombra a todos", () => {
    expect(doc).toContain(`### RBAC — ${SYSTEM_ROLES.length} roles`)
    for (const role of SYSTEM_ROLES) {
      expect(doc, `falta el rol ${role.name}`).toContain(`\`${role.name}\``)
    }
  })

  it("declara el número real de permisos, sin contradecirse entre secciones", () => {
    const total = registry.reduce((sum, module) => sum + module.permissions.length, 0)
    const declared = [...doc.matchAll(/(\d+) permisos/g)].map((match) => Number(match[1]))

    expect(declared.length).toBeGreaterThan(0)
    expect(new Set(declared)).toEqual(new Set([total]))
  })

  /**
   * El total sólo miraba las dos frases "N permisos"; la tabla por módulo usa
   * celdas sin esa palabra y quedó fuera del contrato. Así derivó a 35/5/12/120
   * cuando el registry decía 36/6/13/118: la tabla sumaba 265 mientras el total
   * declaraba otra cifra, que es justo la contradicción que este archivo vigila.
   */
  it("declara los permisos de cada módulo en la tabla", () => {
    for (const entry of registry) {
      const row = doc.match(new RegExp(`^\\| \`${entry.id}\` \\| (\\d+) \\|`, "m"))
      expect(row, `falta la fila del módulo ${entry.id}`).not.toBeNull()
      expect(Number(row![1]), `la tabla declara ${row![1]} permisos para ${entry.id}`)
        .toBe(entry.permissions.length)
    }
  })

  it("declara el número real de módulos registrados", () => {
    expect(doc).toContain(`### Módulos registrados (${registry.length})`)
  })
})
