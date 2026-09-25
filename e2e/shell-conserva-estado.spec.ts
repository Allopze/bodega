import { expect, test } from "@playwright/test"

import { login } from "./helpers"

/**
 * Una Server Action que revalida no vuelve a montar la plataforma.
 *
 * `AppShell` y `Breadcrumbs` se exportaban como el objeto `React.memo` tal
 * cual, y el layout y las páginas —Server Components— los usan como
 * referencia de cliente. Así, cada `revalidatePath` y cada `router.refresh()`
 * volvían a montar todo lo que está bajo `<body>`: se perdía el estado de
 * cliente y los avisos que dependen del resultado de la acción no salían.
 *
 * La prueba marca a mano un nodo del shell y uno de la página. Un nodo que
 * React conserva guarda la marca (React no toca atributos que no maneja); uno
 * que se volvió a montar llega sin ella.
 */
test("guardar en Almacenamiento conserva el shell y la página", async ({ page }) => {
  await login(page)
  await page.goto("/admin/almacenamiento")
  const card = page.getByRole("region", { name: "Documentos generados" })
  await expect(card).toBeVisible()

  await page.evaluate(() => {
    document.querySelector("[data-shell-scroll]")?.setAttribute("data-e2e-marca", "shell")
    document.getElementById("generated-docs-title")?.closest("section")?.setAttribute("data-e2e-marca", "pagina")
  })

  await card.getByRole("button", { name: "Guardar", exact: true }).click()
  await expect(page.getByText(/Archivado encendido|El archivado está apagado/).first()).toBeVisible({ timeout: 15_000 })
  // El aviso sale al volver la acción; el árbol revalidado se aplica en la
  // misma transición, que termina cuando el botón deja de estar pendiente.
  await expect(card.getByRole("button", { name: "Guardar", exact: true })).toBeEnabled()
  await page.waitForLoadState("networkidle")

  await expect(page.locator('[data-shell-scroll][data-e2e-marca="shell"]')).toHaveCount(1)
  await expect(page.locator('section[data-e2e-marca="pagina"]')).toHaveCount(1)
})
