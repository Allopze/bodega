import { test, expect, type Page } from "@playwright/test"
import ExcelJS from "exceljs"
import { expectPageTitle, login, pickCurrentMonthDate } from "./helpers"
import { openAddDataSelector } from "./combustibles-control-helpers"

/**
 * Combustible tras el rediseño «El mes como hilo» (2026-10-31). Cada prueba
 * apunta a la pantalla nueva que heredó lo que antes se probaba aquí:
 *
 *   /combustibles                 → Panel de combustible (tira de cinco pasos)
 *   /combustibles/consumo/litros  → «Consumo y rendimiento › Consumo» (antes el tablero de /combustibles)
 *   /combustibles/pagos           → Pagos › Facturas (antes /combustibles/facturas)
 *   /combustibles/pagos/nueva     → Nueva factura (antes /combustibles/nueva)
 *   /combustibles/pagos/estados   → Estados de cuenta (antes /combustibles/cuenta-corriente)
 *   /combustibles/fuentes         → Fuentes de datos (antes /combustibles/importar y su historial)
 *   /combustibles/fuentes/agregar/{tarjeta,planilla,sellos} → los importadores con pantalla propia
 *   /combustibles/ajustes/integraciones → integraciones disponibles
 *
 * Las URL de antes siguen vivas como páginas puente; `combustibles-rediseno.spec.ts`
 * recorre una muestra de cada una.
 */

/** Abre un Radix Select (o el combobox de equipos) por su `id` y elige la opción; reintenta si el clic llegó antes de hidratar. */
async function pickOption(page: Page, triggerId: string, option: string | RegExp) {
  await expect(async () => {
    await page.locator(`#${triggerId}`).click()
    await page.getByRole("option", { name: option }).first().click({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

test.describe("Combustibles module", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("el Panel abre con la tira de cinco pasos y el período en tres cifras", async ({ page }) => {
    await page.goto("/combustibles")
    await expectPageTitle(page, "Panel de combustible")

    // La firma del Panel de jefatura: «N de 5 pasos listos» y un paso por cada cosa que falta para cerrar el período.
    await expect(page.getByRole("progressbar", { name: /de 5 pasos listos$/ })).toBeVisible()
    const pasos = page.getByRole("region", { name: "Pasos para cerrar el período" })
    await expect(pasos.locator("li[data-step]")).toHaveCount(5)
    /** Cada paso es un enlace al lugar donde se trabaja; el período puede viajar en el `href`. */
    const destinos: ReadonlyArray<readonly [string, RegExp]> = [
      ["fuentes", /^\/combustibles\/fuentes(\?|$)/],
      ["revisar", /^\/combustibles\/revisar(\?|$)/],
      ["cuadratura", /^\/combustibles\/cuadratura(\?|$)/],
      ["equipos", /^\/combustibles\/consumo(\?|$)/],
      ["pagos", /^\/combustibles\/pagos(\/estados)?(\?|$)/],
    ]
    for (const [clave, destino] of destinos) {
      await expect.soft(pasos.locator(`li[data-step="${clave}"]`).getByRole("link"), `paso «${clave}»`).toHaveAttribute("href", destino)
    }
    await expect(page.getByRole("heading", { name: "El período en tres cifras", level: 2 })).toBeVisible()
  })

  test("Consumo y rendimiento › Consumo muestra los litros por mes, de dónde vinieron y las patentes para mirar", async ({ page }) => {
    await page.goto("/combustibles/consumo/litros")
    await expectPageTitle(page, "Consumo y rendimiento")
    const pestanas = page.getByRole("navigation", { name: "Vistas de consumo y rendimiento" })
    await expect(pestanas.getByRole("link", { name: "Consumo", exact: true })).toHaveAttribute("aria-current", "page")
    for (const titulo of [
      "Litros por mes, según de dónde salió",
      "De dónde vino lo cargado",
      // CHART-016: la tasa (km/L, L/h) mes a mes, de las lecturas de medidor de Copec; las barras de abajo siguen siendo las de cargas.
      "Rendimiento por mes",
      "Kilómetros contra litros",
      "Horas contra litros",
      "Patentes para mirar",
    ]) {
      await expect.soft(page.getByRole("heading", { name: titulo, level: 2 }), `sección «${titulo}»`).toBeVisible()
    }
    // Los análisis pesados viven plegados en la URL (`?seccion=`): cerrados traen su enlace «Ver».
    await expect(page.getByRole("link", { name: /^Ver Más análisis de tarjetas/ })).toBeVisible()
  })

  test("Pagos › Facturas (la facturación relocalizada) carga con su barra de vistas y sus acciones", async ({ page }) => {
    await page.goto("/combustibles/pagos")
    await expectPageTitle(page, "Pagos")
    const pestanas = page.getByRole("navigation", { name: "Pagos", exact: true })
    await expect(pestanas.getByRole("link", { name: "Facturas", exact: true })).toHaveAttribute("aria-current", "page")
    await expect(pestanas.getByRole("link", { name: "Estados de cuenta", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Agregar datos", exact: true })).toBeVisible()
    // Sin facturas el estado vacío repite el enlace de la cabecera: ambos están a la vista.
    await expect(page.getByRole("link", { name: "Nueva factura" }).first()).toBeVisible()
  })

  test("Fuentes de datos lista cada fuente con su estado y los archivos importados", async ({ page }) => {
    await page.goto("/combustibles/fuentes")
    await expectPageTitle(page, "Fuentes de datos")
    // Una ficha por fuente, nombrada por su título (`SourceRow`: <article aria-labelledby>).
    for (const fuente of ["Copec", "Planilla de cargas", "Telemetría de equipos", "Surtidores sin integración", "Formulario en terreno", "Histórico de sellos", "Facturas en Excel"]) {
      await expect.soft(page.getByRole("article", { name: fuente, exact: true }), `fuente «${fuente}»`).toBeVisible()
    }
    await expect(page.getByRole("heading", { name: "Archivos importados", level: 2 })).toBeVisible()
    await expect(page.getByRole("button", { name: "Agregar datos", exact: true })).toBeVisible()
  })

  test("agregar un reporte de tarjeta abre su asistente de carga manual", async ({ page }) => {
    await page.goto("/combustibles/fuentes/agregar/tarjeta")
    await expectPageTitle(page, "Agregar reporte de tarjeta")
    await expect(page.getByText("Subir un archivo", { exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: "Ver archivos importados" })).toBeVisible()
  })

  test("Aramco no aparece en fuentes ni en integraciones", async ({ page }) => {
    await page.goto("/combustibles/fuentes")
    await expect(page.getByRole("article", { name: "Aramco", exact: true })).toHaveCount(0)
    await page.goto("/combustibles/ajustes/integraciones")
    await expectPageTitle(page, "Integraciones")
    await expect(page.getByRole("region", { name: "Aramco", exact: true })).toHaveCount(0)
  })

  test("copec anuncia que la sincronización incluye el mes en curso", async ({ page }) => {
    await page.goto("/combustibles/fuentes")
    const fuente = page.getByRole("article", { name: "Copec", exact: true })
    await expect(fuente).toBeVisible()
    await expect(fuente.getByRole("button", { name: /Actualizar ahora/ })).toBeVisible()
    await fuente.locator("summary").filter({ hasText: "Detalle técnico" }).click()
    await expect(fuente.getByText(/Incluye el mes en curso/)).toBeVisible()
  })

  test("registrar una nueva factura vuelve a Pagos", async ({ page }) => {
    await page.goto("/combustibles/pagos/nueva")
    await expectPageTitle(page, "Nueva factura")

    // Fill form
    await pickCurrentMonthDate(page, "Seleccionar fecha")
    await pickOption(page, "serviceType", "Tarjeta Copec de equipos")
    await pickOption(page, "vehicleCombobox", /E2E-FUEL-1/)
    await pickOption(page, "fuelSupplierId", "Proveedor Combustible E2E")
    await pickOption(page, "worksiteId", "Faena E2E")
    await pickOption(page, "product", "Petróleo diésel")
    await page.fill('input[name="receiptNumber"]', "TEST-001")
    await page.fill('input[name="liters"]', "1000")
    await page.fill('input[name="baseAmount"]', "1000000")

    // Submit
    await page.getByRole("button", { name: "Registrar factura" }).click()
    // Una carga facturada vuelve a su listado natural, Pagos › Facturas.
    await expect(page).toHaveURL(/\/combustibles\/pagos$/, { timeout: 15_000 })
  })

  test("importar la planilla de cargas: subir, revisar, confirmar y abrir el archivo importado", async ({ page }) => {
    // Genera un Excel con los encabezados reales del "CONSOLIDADO COMBUSTIBLES
    // CHOME" (con anotaciones "(AUTOMATICO)"/"(DIGITAR)" pegadas al título),
    // para validar también el manejo de esos encabezados en el parser.
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Hoja 1")
    sheet.addRow([
      "CODIGO\n(DIGITAR)", "PATENTE\n(AUTOMATICO)", "FECHA\n(DIGITAR)", "HORA CARGA",
      "FAENA\n(SELECCIONAR LISTA DESPLEGABLE)", "TIPO EQUIPO\n(AUTOMATICO)", "MARCA\n(AUTOMATICO)",
      "MODELO\n(AUTOMATICO)", "AÑO", "HOROMETRO / ODOMETRO", "MEDIDO POR HORA O KM",
      "LT\n(DIGITAR)", "OPERADOR\nCONDUCTOR\n(DIGITAR)", "SUPERVISOR TURNO\n(DESPLEGABLE)",
      "SUMINISTRO ENTREGADO POR:\n(DESPLEGABLE)", "RENDIMIENTO\n", "TIPO DE RENDIMIENTO", "$/lt", "Monto ($)",
    ])
    sheet.addRow([
      "E2E-01", "E2E-FUEL-1", new Date("2026-06-01"), null,
      "Faena E2E", "CAMIONETA", "Toyota", "Hilux", 2024, 32000, "KM",
      40, "E2E Operador", null, "Proveedor Combustible E2E", 12.5, "KM/LT", 981, 39240,
    ])
    const xlsxBuffer = Buffer.from(await workbook.xlsx.writeBuffer())

    await page.goto("/combustibles/fuentes/agregar/planilla")
    await expectPageTitle(page, "Agregar planilla de cargas")
    await expect(page.getByText("Subir la planilla de cargas")).toBeVisible()

    await page.locator('input[type="file"]').last().setInputFiles({
      name: "combustibles-e2e-test.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsxBuffer,
    })
    await page.getByRole("button", { name: "Revisar", exact: true }).click()

    await expect(page.getByText("Revisar antes de importar")).toBeVisible()
    await expect(page.getByText("Filas válidas")).toBeVisible()
    await expect(page.getByText("Con vehículo")).toBeVisible()

    await page.getByRole("button", { name: /^Confirmar/ }).click()
    await expect(page.getByText(/cargas de la planilla importadas exitosamente/)).toBeVisible({ timeout: 30_000 })

    // «Ver lote» pasó a «Ver archivo»: cada archivo importado tiene su ficha bajo Fuentes de datos.
    const batchHref = await page.getByRole("link", { name: "Ver archivo y filas rechazadas", exact: true }).getAttribute("href", { timeout: 30_000 })
    expect(batchHref).toMatch(/\/combustibles\/fuentes\/archivos\/planilla\//)
    await page.goto(batchHref!)
    await expectPageTitle(page, "Planilla de cargas")
    await expect(page.getByRole("heading", { name: "Resumen del archivo", level: 2 })).toBeVisible()
  })

  test("vehicles catalog page loads", async ({ page }) => {
    await page.goto("/combustibles/vehiculos")
    await expect(page).toHaveURL(/\/admin\/flota-catalogos\/vehiculos$/)
    await expect(page.locator("h1").first()).toContainText("Vehículos")
    await expect(page.getByText("Patente")).toBeVisible()
  })

  test("suppliers catalog page loads", async ({ page }) => {
    await page.goto("/combustibles/proveedores-combustible")
    await expect(page).toHaveURL(/\/admin\/flota-catalogos\/proveedores-combustible$/)
    await expect(page.locator("h1").first()).toContainText("Proveedores")
    await expect(page.getByRole("button", { name: "Ordenar por Proveedor" })).toBeVisible()
  })

  test("Pagos › Estados de cuenta carga", async ({ page }) => {
    await page.goto("/combustibles/pagos/estados")
    await expectPageTitle(page, "Estados de cuenta")
    const pestanas = page.getByRole("navigation", { name: "Pagos", exact: true })
    await expect(pestanas.getByRole("link", { name: "Estados de cuenta", exact: true })).toHaveAttribute("aria-current", "page")
  })

  // Reportes y Análisis de rendimiento se fusionaron en «Consumo y rendimiento»
  // (2026-10-22) y, con el rediseño (2026-10-31), esas vistas son «Consumo» (con el
  // análisis de tarjetas plegado en `?seccion=tarjetas`) y «Rendimiento». Las URL
  // viejas siguen vivas en marcadores y correos.
  test("retired fuel report and analysis routes redirect into Consumo y rendimiento", async ({ page }) => {
    await page.goto("/combustibles/reportes?desde=2026-07-01&hasta=2026-07-31")
    await expect(page).toHaveURL((url) => url.pathname === "/combustibles/consumo/litros" && url.searchParams.get("seccion") === "tarjetas" && url.searchParams.get("desde") === "2026-07-01")
    await expect(page.getByRole("navigation", { name: "Vistas de consumo y rendimiento" })
      .getByRole("link", { name: "Consumo", exact: true })).toHaveAttribute("aria-current", "page")

    await page.goto("/combustibles/analisis")
    await expect(page).toHaveURL(/\/combustibles\/consumo\/rendimiento\/camiones/)
  })

  test("el importador de facturas se abre desde «Agregar datos» en Pagos", async ({ page }) => {
    await page.goto("/combustibles/pagos")
    // El importador de facturas es una opción del único botón «Agregar datos»: abre «Fuentes de datos» con su diálogo.
    const selector = await openAddDataSelector(page)
    await selector.getByRole("link", { name: /Tengo facturas en Excel/ }).click()
    await expect(page).toHaveURL(/\/combustibles\/fuentes\?agregar=facturas/)
    const dialog = page.getByRole("dialog", { name: "Importar cargas desde Excel" })
    await expect(dialog).toBeVisible({ timeout: 20_000 })
    await expect(dialog.getByText("Importar cargas desde Excel")).toBeVisible()
    await expect(dialog.getByText("Subir archivo")).toBeVisible()
    await expect(dialog.getByText("Revisar datos")).toBeVisible()
    await expect(dialog.getByText("Completado")).toBeVisible()
  })
})
