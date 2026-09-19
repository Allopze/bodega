import { describe, expect, it } from "vitest"
import { flotaModule } from "@/modules/flota/manifest"

describe("flota document RBAC", () => {
  it("declara gestión documental separada de la lectura", () => {
    expect(flotaModule.permissions).toContain("flota:manage_documents")
    expect(flotaModule.permissionMeta).toHaveProperty("flota:manage_documents")
    // Por href y no por índice: lo que se afirma es que **entrar a Flota** sólo
    // exige lectura —gestionar documentos tiene permiso propio—, y eso no
    // depende de en qué posición del menú quede el item. El test rompió cuando
    // se insertó "Control operacional" antes, sin que nada de lo que afirma
    // hubiera cambiado.
    const flota = flotaModule.nav.flatMap((area) => area.items).find((item) => item.href === "/flota")
    expect(flota?.permissions).toEqual(["flota:view"])
  })

  it("mantiene el grant documental en los roles operativos que antes gestionaban con flota:view", () => {
    const roles = flotaModule.defaultGrants
      .filter((grant) => grant.permission === "flota:manage_documents")
      .map((grant) => grant.roleSlug)

    expect(roles).toEqual(expect.arrayContaining(["administrador", "jefe_mantencion", "jefa_chome"]))
  })
})
