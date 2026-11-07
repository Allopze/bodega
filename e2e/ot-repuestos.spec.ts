import { expect, test, type Page } from "@playwright/test"
import { cerrarSesion, clearRateLimits, pickCurrentMonthDate, selectRadixById, textoVisible } from "./helpers"
import { withSql } from "./mantencion-3-helpers"

/**
 * Repuestos pedidos desde la OT (plan 2026-11-07, Task 19).
 *
 *   la jefatura de mantención crea una OT asignada a un mecánico → desde
 *   «Más acciones» pide repuestos → el formulario de solicitud llega con la
 *   faena, el equipo y la OT precargados → guarda el borrador → la OT muestra
 *   «Repuestos pedidos» con la línea, y la lista de OT dice «Esperando repuesto».
 *   El mecánico asignado ve la OT pero no puede pedir repuestos.
 *
 * Usuarios de `e2e/fixtures/mantencion-setup.ts` (contraseña `chome2026`).
 * Locators según «Locators in this repository» de AGENTS.md.
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(180_000)

const JEFE = "jefe.mant@e2e.chome.cl"
const MECANICO = "mecanico1@e2e.chome.cl"
const NOMBRE_MECANICO = "Mecánico Uno E2E"
const REPUESTO = "QA_ Manguera hidráulica de alta presión"

let otId = ""
let folio = ""
let equipo = { code: "", plate: "" }

async function entrarPlataforma(page: Page, email: string) {
  for (const intento of [1, 2]) {
    await clearRateLimits()
    await page.goto("/login")
    await page.getByLabel("Correo electrónico", { exact: true }).fill(email)
    await page.getByLabel("Contraseña", { exact: true }).fill("chome2026")
    await page.getByRole("button", { name: "Ingresar", exact: true }).click()
    try {
      await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
      return
    } catch (error) {
      if (intento === 2) throw error
    }
  }
}

async function equipoDePrueba(): Promise<{ code: string; plate: string }> {
  return withSql(async (sql) => {
    const [row] = await sql`
      select v.code as code, v.plate as plate
      from mant_equipment_profiles p
      join fuel_vehicles v on v.id = p.vehicle_id
      join worksites w on w.id = v.worksite_id
      where w.name = 'Biodiversa' and v.is_active = true and v.code is not null
      order by v.code asc
      limit 1`
    expect(row, "Biodiversa necesita un equipo con ficha de mantención").toBeTruthy()
    return { code: row!.code as string, plate: row!.plate as string }
  })
}

test.describe("OT · repuestos pedidos", () => {
  test.beforeAll(async () => {
    equipo = await equipoDePrueba()
  })

  test("jefatura pide repuestos desde la OT y la OT los muestra como pedidos", async ({ page }) => {
    await entrarPlataforma(page, JEFE)

    // OT asignada al mecánico de Biodiversa, para que el segundo test la vea.
    await page.goto("/mantencion/ot")
    await page.getByRole("button", { name: /^(Nueva OT|Crear la primera orden)$/ }).first().click()
    const hoja = page.getByRole("dialog", { name: "Nueva orden de trabajo" })
    await expect(hoja).toBeVisible()
    await hoja.locator("#ot-equipo").click()
    await hoja.locator("#ot-equipo").fill(equipo.code)
    await page.getByRole("option", { name: new RegExp(equipo.code) }).first().click()
    await selectRadixById(page, "ot-mecanico", NOMBRE_MECANICO)
    await hoja.locator("#ot-reparacion-desc").fill("QA_ Fuga en el circuito hidráulico")
    await hoja.getByRole("button", { name: "Crear OT", exact: true }).click()
    await expect(page).toHaveURL(/\/mantencion\/ot\/[^/]+$/, { timeout: 30_000 })
    otId = new URL(page.url()).pathname.split("/").pop() ?? ""
    const titulo = await page.getByRole("heading", { level: 1 }).first().innerText()
    folio = /OT-[A-Z]+-\d{4}/.exec(titulo)?.[0] ?? ""
    expect(folio, "el título de la OT lleva su folio").not.toBe("")

    // Sin solicitudes todavía: la sección lo dice y ofrece pedir.
    await expect(page.getByRole("heading", { name: "Repuestos pedidos" })).toBeVisible()

    await page.getByRole("button", { name: "Más acciones" }).click()
    await page.getByRole("menuitem", { name: "Pedir repuestos" }).click()
    await expect(page).toHaveURL(new RegExp(`/solicitudes/nueva\\?tipo=repuestos&ot=${otId}`))
    await page.waitForLoadState("networkidle").catch(() => undefined)

    // Precargado: el aviso nombra la OT y el equipo, y el combobox trae el vehículo.
    await expect(textoVisible(page, new RegExp(`Repuestos para la OT ${folio}`))).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Equipo de flota" })).toHaveValue(new RegExp(equipo.plate))

    await page.getByPlaceholder("Describe el ítem requerido...").fill(REPUESTO)
    await page.getByLabel("Precio unitario estimado (CLP)").fill("25000")
    await pickCurrentMonthDate(page, "Seleccionar fecha")
    await page.getByRole("button", { name: /Guardar borrador/ }).click()
    await expect(textoVisible(page, /^Borrador guardado/).first()).toBeVisible({ timeout: 30_000 })

    // El borrador queda vinculado: la OT lo lista, pero un borrador todavía no es
    // un pedido y no la deja «esperando repuesto» (decisión 2026-11-07).
    await page.goto(`/mantencion/ot/${otId}`)
    await expect(textoVisible(page, REPUESTO)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("heading", { name: "Repuestos pedidos" })).toBeVisible()
    await expect(textoVisible(page, /^REP-/).first()).toBeVisible()
    await page.goto("/mantencion/ot?repuestos=pendientes")
    await expect(page.getByRole("row").filter({ hasText: folio })).toHaveCount(0)

    // Enviado a aprobación (bajo el umbral basta el precio estimado), sí espera.
    // Se abre la solicitud desde la propia OT: la jefatura ve TODAS las de
    // repuestos, y «el último borrador» de la lista puede ser el de otro test.
    await page.goto(`/mantencion/ot/${otId}`)
    await textoVisible(page, /^REP-/).first().click()
    await expect(page).toHaveURL(/\/solicitudes\/(?!nueva)[^/?]+$/, { timeout: 30_000 })
    await expect(textoVisible(page, REPUESTO).first()).toBeVisible({ timeout: 30_000 })
    const enviar = page.getByRole("button", { name: /Enviar a aprobación/ })
    await expect(enviar).toBeVisible()
    await enviar.click()
    await expect(enviar).toHaveCount(0, { timeout: 30_000 })
    // El botón desaparece al empezar el envío, no al confirmarlo: la lista se
    // reintenta hasta que el servidor haya guardado la solicitud enviada.
    const fila = page.getByRole("row").filter({ hasText: folio })
    await expect(async () => {
      await page.goto("/mantencion/ot?repuestos=pendientes")
      await expect(fila).toBeVisible({ timeout: 5_000 })
    }).toPass({ timeout: 60_000 })
    await expect(fila.getByText("Esperando repuesto")).toBeVisible()
  })

  test("el mecánico asignado ve la OT pero no puede pedir repuestos", async ({ page }) => {
    expect(otId, "depende del test anterior").not.toBe("")
    await cerrarSesion(page)
    await entrarPlataforma(page, MECANICO)
    await page.goto(`/mantencion/ot/${otId}`)
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^${folio}`) })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Repuestos pedidos" })).toBeVisible()
    const masAcciones = page.getByRole("button", { name: "Más acciones" })
    if (await masAcciones.count()) {
      await masAcciones.click()
      await expect(page.getByRole("menuitem", { name: "Pedir repuestos" })).toHaveCount(0)
    }
    await expect(page.getByRole("link", { name: "Pedir repuestos" })).toHaveCount(0)
  })
})
