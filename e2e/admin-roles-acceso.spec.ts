import { expect, test } from "@playwright/test"
import { login } from "./helpers"

/**
 * Acceso administrativo "rol primero" (TASK-UI-010).
 *
 * El hallazgo FORM-ADMIN-001 era que el alta de usuario exponía la lista de
 * permisos antes de resolver rol y alcance, de modo que quien administra
 * decidía sobre claves internas en lugar de sobre acceso. La implementación
 * quedó hecha hace pasadas y sin certificar: el criterio pide "flujo estándar
 * sin claves; overrides explícitos; no se crea combinación inválida; permisos
 * resultantes verificables", y nada de eso tenía prueba.
 *
 * Estas comprobaciones son de contrato, no de estilo: lo que fijan es que el
 * orden de decisión —rol, alcance, y sólo entonces excepciones— no se pueda
 * invertir sin que la suite lo diga.
 */
async function abrirAltaDeUsuario(page: import("@playwright/test").Page) {
  await login(page)
  await page.goto("/admin/usuarios")
  await expect(page.getByRole("heading", { name: /Usuarios/i }).first()).toBeVisible()
  await page.getByRole("button", { name: /Nuevo usuario|Invitar/i }).first().click()
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 })
}

test.describe("Administración — rol primero", () => {
  test("las excepciones de permisos llegan colapsadas, después del rol y el alcance", async ({ page }) => {
    await abrirAltaDeUsuario(page)

    const excepciones = page.locator("details").filter({ hasText: "Excepciones de permisos" }).first()
    await expect(excepciones).toBeVisible()
    // Colapsadas: el flujo estándar no obliga a mirar la lista de permisos.
    await expect(excepciones).not.toHaveAttribute("open", /.*/)
    // Y el contador arranca en cero: ningún permiso directo preseleccionado.
    await expect(excepciones).toContainText("Excepciones de permisos (0)")
  })

  test("el resumen de acceso habla de rol y faena, no de claves internas", async ({ page }) => {
    await abrirAltaDeUsuario(page)

    const dialogo = page.getByRole("dialog")
    // El criterio dice "claves internas fuera del flujo estándar": un permiso
    // como `purchasing:create_order` no debe leerse sin desplegar excepciones.
    const texto = await dialogo.innerText()
    const clavesVisibles = texto.match(/\b[a-z_]+:[a-z_]+\b/g) ?? []
    expect(clavesVisibles, "claves de permiso visibles en el flujo estándar").toEqual([])
  })

  test("abrir las excepciones es un gesto deliberado y las anuncia como región", async ({ page }) => {
    await abrirAltaDeUsuario(page)

    await page.locator("summary").filter({ hasText: "Excepciones de permisos" }).first().click()
    // `role="region"` con nombre: un lector de pantalla sabe dónde entró, y no
    // se encuentra una lista de casillas sin contexto.
    await expect(page.getByRole("region", { name: "Excepciones de permisos" })).toBeVisible()
    await expect(page.getByText(/El acceso del rol se conserva/i)).toBeVisible()
  })
})

test.describe("Administración — el servidor no confía en el formulario", () => {
  test("un POST manipulado sin sesión no crea ni modifica nada", async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    // El diff de permisos es una ayuda de la interfaz; la barrera es el
    // servidor. Sin sesión, la ruta administrativa no puede responder 200 con
    // contenido: eso sería confiar en que nadie salte el formulario.
    // `maxRedirects: 0` es imprescindible: por defecto Playwright sigue la
    // redirección y devuelve el 200 de la página de inicio de sesión, de modo
    // que una aserción sobre el estado da por buena una barrera que no se
    // comprobó. La primera versión de esta prueba cayó justo ahí.
    const respuesta = await page.request.post("/admin/usuarios", {
      failOnStatusCode: false,
      maxRedirects: 0,
      form: { roleIds: "admin", permissionIds: "admin:module_management" },
    })
    expect(respuesta.status(), "una ruta administrativa respondió sin sesión").toBeGreaterThanOrEqual(300)

    await page.goto("/admin/usuarios")
    await expect(page).toHaveURL(/\/login|\/forbidden/)
    await context.close()
  })

  test("un usuario sin permiso de administración no alcanza la pantalla", async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    /*
     * `scoped@e2e.chome.cl` tiene `rol-sol-faena`: un usuario legítimo sin
     * administración, que es el vector realista. `comprador@e2e.chome.cl`
     * **parece** un usuario de operaciones por el nombre, pero la semilla le
     * asigna `rol-admin`; usarlo daba un falso verde.
     */
    await login(page, "scoped@e2e.chome.cl", "chome2026").catch(() => undefined)
    await page.goto("/admin/usuarios")

    // Sea por redirección o por prohibido, lo que no puede ocurrir es que la
    // lista de usuarios se renderice para quien no debe verla.
    await expect(page.getByRole("heading", { name: "Usuarios", exact: true })).toHaveCount(0)
    await context.close()
  })
})
