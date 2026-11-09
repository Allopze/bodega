import { expect, test } from "@playwright/test"
import { login, textoVisible } from "./helpers"

/**
 * Catálogo de repuestos (fase 2), pantalla `/mantencion/repuestos`.
 *
 * Lo que cubre este archivo es la pantalla misma: alta, N° de parte repetido, ficha, edición, baja y alta de nuevo, y
 * que la autorización viva en el servidor y no sólo en el menú. Los pasos que cruzan solicitud, OC y recepción
 * (pedir con el buscador, catalogar al armar la OC, precio al emitir, recepción en faena) se suman en este mismo archivo.
 *
 * Los datos llevan el prefijo `QA_` y un N° de parte distinto en cada corrida: el catálogo no se vacía entre ellas.
 */

test("la jefatura de mantención crea un repuesto, uno repetido se rechaza bajo su campo y puede darlo de baja y de alta", async ({ page }) => {
  const partNumber = `QA-${Date.now().toString(36).toUpperCase()}`
  const name = `QA_Filtro de aceite ${partNumber}`

  await login(page, "jefe.mant@e2e.chome.cl")
  await page.goto("/mantencion/repuestos")
  await expect(page.getByRole("link", { name: "Catálogo de repuestos", exact: true }).first()).toBeVisible()

  // Alta.
  await page.getByRole("button", { name: "Nuevo repuesto" }).first().click()
  const alta = page.getByRole("dialog", { name: "Nuevo repuesto" })
  await alta.getByLabel("Nombre del repuesto").fill(name)
  await alta.getByLabel("N° de parte").fill(partNumber)
  await alta.getByLabel("Marca del repuesto").fill("Caterpillar")
  await alta.getByLabel("Precio de referencia (CLP)").fill("18990")
  await alta.getByRole("button", { name: "Crear repuesto" }).click()
  await expect(alta).toBeHidden()
  const fila = page.getByRole("link", { name, exact: true })
  await expect(fila).toBeVisible()
  await expect(textoVisible(page, `N° ${partNumber} · Caterpillar`)).toBeVisible()

  // El mismo N° de parte y marca (sin distinguir mayúsculas) se rechaza y el error queda bajo «N° de parte», sin perder lo escrito.
  await page.getByRole("button", { name: "Nuevo repuesto" }).first().click()
  const repetido = page.getByRole("dialog", { name: "Nuevo repuesto" })
  await repetido.getByLabel("Nombre del repuesto").fill("QA_Otro filtro")
  await repetido.getByLabel("N° de parte").fill(partNumber.toLowerCase())
  await repetido.getByLabel("Marca del repuesto").fill("caterpillar")
  await repetido.getByRole("button", { name: "Crear repuesto" }).click()
  await expect(repetido.getByRole("alert").filter({ hasText: /Ya existe el repuesto RPT-\d+ con ese N° de parte/ })).toBeVisible()
  await expect(repetido.getByLabel("Nombre del repuesto")).toHaveValue("QA_Otro filtro")
  await repetido.getByRole("button", { name: "Cancelar" }).click()
  await expect(repetido).toBeHidden()

  // Un formulario sin nombre dice qué falta.
  await page.getByRole("button", { name: "Nuevo repuesto" }).first().click()
  const vacio = page.getByRole("dialog", { name: "Nuevo repuesto" })
  await vacio.getByRole("button", { name: "Crear repuesto" }).click()
  await expect(vacio.getByRole("alert").filter({ hasText: "Escribe el nombre del repuesto" })).toBeVisible()
  await vacio.getByRole("button", { name: "Cancelar" }).click()

  // La búsqueda de la barra superior filtra la lista por N° de parte.
  await page.getByPlaceholder("Filtrar en esta página...").fill(partNumber.toLowerCase())
  await expect(fila).toBeVisible()
  await page.getByPlaceholder("Filtrar en esta página...").fill("zzz-no-existe")
  await expect(textoVisible(page, "Ningún repuesto coincide")).toBeVisible()
  await page.getByPlaceholder("Filtrar en esta página...").fill("")

  // Ficha: sin compras todavía, con una sola explicación; se edita desde ahí.
  await fila.click()
  await expect(page).toHaveURL(/\/mantencion\/repuestos\/[^/?]+$/)
  await expect(textoVisible(page, "Todavía no se ha comprado")).toBeVisible()
  await page.getByRole("button", { name: "Editar" }).first().click()
  const edicion = page.getByRole("dialog", { name: "Editar repuesto" })
  await edicion.getByLabel("Precio de referencia (CLP)").fill("20500")
  await edicion.getByRole("button", { name: "Guardar cambios" }).click()
  await expect(edicion).toBeHidden()
  await expect(textoVisible(page, "$20.500")).toBeVisible()

  // Baja con confirmación: el repuesto pasa a «Inactivos» y puede activarse de nuevo.
  await page.getByRole("button", { name: "Desactivar" }).first().click()
  const confirmar = page.getByRole("dialog", { name: /Desactivar QA_/ })
  await expect(confirmar.getByText(/Su historial de compras y de precios se conserva/)).toBeVisible()
  await confirmar.getByRole("button", { name: "Desactivar", exact: true }).click()
  await expect(page.getByRole("button", { name: "Activar", exact: true }).first()).toBeVisible()
  await page.goto("/mantencion/repuestos?estado=inactivos")
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible()
  await page.getByRole("link", { name, exact: true }).click()
  await page.getByRole("button", { name: "Activar", exact: true }).first().click()
  await expect(page.getByRole("button", { name: "Desactivar" }).first()).toBeVisible()
})

test("quien no tiene repuestos:catalog no ve el ítem del menú y el servidor le cierra la pantalla y la ficha", async ({ page }) => {
  await login(page, "supervisor@e2e.chome.cl")
  // El supervisor de mantención ve el resto del grupo, pero no el catálogo.
  await page.goto("/mantencion/ot")
  await expect(page.getByRole("link", { name: "Órdenes de trabajo", exact: true }).first()).toBeVisible()
  await expect(page.getByRole("link", { name: "Catálogo de repuestos", exact: true })).toHaveCount(0)

  // La autorización es del servidor: por URL tampoco entra, ni a la lista ni a una ficha.
  for (const url of ["/mantencion/repuestos", "/mantencion/repuestos/cualquier-id"]) {
    await page.goto(url)
    await expect(page.getByRole("heading", { name: "Sin permisos suficientes", level: 1 }), `${url} debe quedar bloqueada`).toBeVisible()
  }
})
