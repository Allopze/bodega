/**
 * E2E: navegación por rol y estado activo (TASK-UI-005).
 *
 * Los criterios de aceptación de esa tarea son de navegador, no de árbol: que
 * ninguna opción quede indistinguible, que el destino activo y su ancestro se
 * mantengan visibles al entrar en una ruta profunda, y que un rol restringido
 * no vea —ni pueda alcanzar— destinos que su permiso no autoriza. La cobertura
 * unitaria de `getVisibleAreas` demuestra el filtrado; esto demuestra lo que el
 * usuario ve.
 *
 * Usa las fixtures de e2e/setup-db.ts: `scoped@e2e.chome.cl` tiene el rol
 * `solicitante_faena` y `admin@e2e.chome.cl` es administrador.
 */
import { test, expect, type Page } from "@playwright/test"
import { clearRateLimits, login } from "./helpers"

const NAV = 'nav[aria-label="Navegación"], nav[aria-label="Áreas"]'

async function loginAs(page: Page, email: string, password: string) {
  await clearRateLimits()
  await page.goto("/login")
  await page.getByLabel("Correo electrónico").fill(email)
  await page.getByLabel("Contraseña").fill(password)
  await page.getByRole("button", { name: "Ingresar" }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
}

test.describe("Navegación — estado activo y ancestro", () => {
  test("una ruta profunda deja marcado su destino y mantiene visible el área que lo contiene", async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/capa")

    const nav = page.locator(NAV).first()
    // `aria-current` es lo que anuncia el lector de pantalla; sin él, el
    // resaltado es sólo color y no comunica nada a quien no lo ve.
    const current = nav.locator('[aria-current="page"]')
    await expect(current).toHaveCount(1)
    await expect(current).toBeVisible()

    // El ancestro que agrupa al destino tiene que estar desplegado: si la rama
    // queda cerrada, el usuario pierde de vista dónde está dentro del módulo.
    await expect(nav.getByRole("button", { name: "Prevención" })).toBeVisible()
  })

  test("ninguna etiqueta del panel queda vacía o recortada a un guion", async ({ page }) => {
    await login(page)
    // Desde una ruta profunda: en el panel las áreas van plegadas y sólo el
    // área activa expone sus destinos como enlaces.
    await page.goto("/prevencion/capa")

    // Se consulta por rol y no por etiqueta CSS: lo que importa es lo que el
    // lector de pantalla enumera como destinos, no cómo estén maquetados.
    const links = page.locator(NAV).first().getByRole("link")
    const labels = await links.allInnerTexts()
    expect(labels.length).toBeGreaterThan(5)
    for (const label of labels) {
      const text = label.trim()
      // Un destino sin texto legible es indistinguible de cualquier otro.
      expect(text.length, `etiqueta "${text}"`).toBeGreaterThan(1)
      expect(text).not.toBe("…")
    }
  })
})

test.describe("Navegación — rol restringido", () => {
  test("no ofrece administración ni privacidad, y esas rutas siguen protegidas", async ({ page }) => {
    await loginAs(page, "scoped@e2e.chome.cl", "scoped2026")

    const nav = page.locator(NAV).first()
    await expect(nav).toBeVisible()

    // El panel no debe ofrecer lo que el rol no puede abrir.
    await expect(nav.getByRole("link", { name: "Usuarios" })).toHaveCount(0)
    await expect(nav.getByRole("link", { name: /Privacidad/ })).toHaveCount(0)

    // Y el filtrado no puede ser sólo visual: la ruta escrita a mano tampoco
    // debe abrirse. Cae en la pantalla de sin permisos, que además ofrece la
    // vuelta a la sección de origen.
    await page.goto("/admin/usuarios")
    await expect(page).toHaveURL(/\/forbidden/)
    await expect(page.getByRole("heading", { name: "Sin permisos suficientes" })).toBeVisible()
  })

  test("el mismo panel a 390 px sigue dando acceso a sus áreas", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAs(page, "scoped@e2e.chome.cl", "scoped2026")

    // En móvil la navegación vive tras un disparador; lo que importa es que
    // exista y abra el catálogo completo, no que el panel esté siempre visible.
    const opener = page.getByRole("button", { name: "Abrir menú" })
    await expect(opener).toBeVisible()
    await opener.click()

    // No se afirma qué contenedor lo aloja —el catálogo móvil vive en su propia
    // hoja—, sino que el usuario alcanza sus destinos: eso es lo que el
    // criterio de 320/390 px pide de verdad.
    await expect(page.getByRole("link", { name: "Inicio" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Mis pendientes" })).toBeVisible()
  })
})
