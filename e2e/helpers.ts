import { expect, type Page } from "@playwright/test"
import postgres from "postgres"

export async function clearRateLimits() {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) return
  const client = postgres(databaseUrl, { max: 1 })
  try {
    await client`delete from rate_limits`
  } finally {
    await client.end()
  }
}

/** Log in as an E2E user (admin by default) and verify we land on dashboard. */
export async function login(page: Page, email = "admin@e2e.chome.cl", password = "chome2026") {
  // Todos los workers comparten la misma IP y la misma tabla `rate_limits`, así
  // que mientras `negative-flows.spec.ts` acumula fallos a propósito para
  // verificar el bloqueo, el login de otro worker en paralelo puede quedar
  // bloqueado por IP y terminar en /login. Limpiar antes no alcanza: es una
  // carrera, el otro spec vuelve a llenar la tabla. Se reintenta una vez.
  for (const attempt of [1, 2]) {
    await clearRateLimits()
    await page.goto("/login")
    await page.getByLabel("Correo electrónico").fill(email)
    await page.getByLabel("Contraseña").fill(password)
    await page.getByRole("button", { name: "Ingresar" }).click()
    try {
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
      return
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
}

/**
 * Asserts the page title, siempre acotado al `h1`.
 *
 * `getByRole("heading", { name })` a secas es ambiguo en cualquier pantalla del
 * shell, por dos motivos independientes:
 *
 * 1. El título se renderiza dos veces — la copia `lg:sr-only` de `PageHeader` y
 *    la del TopBar (que además es un `<p>`, no un heading).
 * 2. El nombre del módulo suele ser substring del `h2` de su estado vacío
 *    ("Recepción" ⊂ "Sin OCs pendientes de recepción"), así que la pantalla
 *    empieza a fallar por strict mode justo cuando se queda sin datos.
 *
 * El subtítulo NO se asserta: en el TopBar es `display:none` bajo 1536px y en la
 * página es `sr-only` en desktop, así que afirmar que "está visible" no dice
 * nada del usuario real.
 */
export async function expectPageTitle(page: Page, name: string | RegExp) {
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible()
}

/** Select an option inside a Radix Select identified by `id`. */
export async function selectRadixById(page: Page, id: string, option: string | RegExp) {
  await page.locator(`#${id}`).click()
  await page.getByRole("option", { name: option }).first().click()
}

/** Avanza el formulario público PPA al siguiente bloque sin acoplar el spec al layout. */
export async function continuePpaStep(page: Page) {
  await page.getByRole("button", { name: "Continuar", exact: true }).click()
}

/** Pick the current visible-month day in the shared DatePicker component. */
/**
 * Elige HOY en un `DatePicker`.
 *
 * Antes buscaba el primer botón cuyo texto fuera el día del mes, y eso rompe en
 * cuanto la grilla del mes arranca con días del mes anterior: en julio de 2026
 * (el 1 cae miércoles) la primera fila muestra 28, 29 y 30 de **junio**, así que
 * con `.first()` el 29 seleccionado era el 29-06 y el servidor lo rechazaba con
 * "La fecha requerida no puede estar en el pasado". Falla dependiente del
 * calendario, no del código de la aplicación (detectado el 2026-07-29).
 *
 * `react-day-picker` expone la fecha ISO de cada celda en `data-day`, así que se
 * selecciona por valor exacto en vez de por texto. La fecha se calcula en la
 * zona de operación, que es contra la que valida el servidor (`todayInChile`).
 */
export async function pickCurrentMonthDate(page: Page, triggerName: string | RegExp) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" })
  await page.getByRole("button", { name: triggerName }).click()
  await page.locator(`[data-day="${today}"]:not([data-outside]) button`).click()
}

/**
 * Set the "Responsable principal" field of the PDTP guided activity form
 * (`guided-activity-form.tsx`). It renders a plain text Input while
 * `pdtpResponsibleCatalog` is empty, but becomes a Select once any row
 * exists there — which other PDTP e2e specs populate as a side effect
 * (e.g. applying an Excel import writes to that shared catalog table), so
 * which one renders depends on suite-wide execution order, not on this
 * test alone. When it's a Select, the specific option doesn't matter to
 * these tests, so just pick the first one.
 */
export async function setPdtpResponsable(page: Page, name = "Prevencionista E2E") {
  const field = page.getByLabel("Responsable principal")
  const tagName = await field.evaluate((el) => el.tagName)
  if (tagName === "INPUT") {
    await field.fill(name)
  } else {
    await field.click()
    await page.getByRole("option").first().click()
  }
}

/**
 * Fill the PPA form using manual identification (no RUT verification).
 * This is the only reliable path for offline tests since the server
 * worker lookup requires network. Shared by e2e/ppa-offline.spec.ts and
 * e2e/tae-ppa-coexistence.spec.ts.
 */
export async function fillManualPpaForm(page: Page, faena = "Faena E2E") {
  await page.getByRole("button", { name: "No estoy en la lista" }).click()

  await page.locator("#worksite").click()
  await page.getByRole("option", { name: faena }).first().click()

  await page.locator("#wname").fill("Trabajador Offline E2E")

  await selectRadixById(page, "tipo", "Conductor Batea")
  await continuePpaStep(page)

  await page.getByTestId("cambio-no").click()
  await page.getByTestId("peligro-no").click()

  await page.getByRole("checkbox", { name: "Elementos de protección personal" }).check()
  await page.getByRole("checkbox", { name: "Herramientas adecuadas y en buen estado" }).check()
  await continuePpaStep(page)

  await page.getByTestId("seguro-si").click()
}

/**
 * ¿Puede este navegador respaldar un `Blob`?
 *
 * Existe por un diagnóstico que casi se publica como defecto de la aplicación.
 * En la primera corrida en WebKit, el escenario offline del TAE fallaba: la
 * carga no llegaba a la cola. La conclusión fácil —"el TAE offline no funciona
 * en Safari"— era **falsa**, y habría mandado a alguien a buscar un fallo que
 * no existe en un flujo de terreno.
 *
 * La causa real es del entorno: en el WebKit que Playwright instala aquí,
 * `await new Blob(["hola"]).text()` lanza `NotReadableError: The I/O read
 * operation failed`. No es IndexedDB ni el Service Worker: un `Blob` en memoria
 * **no se puede releer**, así que nada que adjunte fotos puede funcionar. No
 * dice nada sobre Safari real en un iPhone.
 *
 * Se comprueba en tiempo de ejecución en vez de anotarse en una lista: el día
 * que el binario se arregle, los escenarios vuelven solos.
 */
export async function blobStorageWorks(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    try {
      return (await new Blob(["probe"]).text()) === "probe"
    } catch {
      return false
    }
  })
}

/**
 * Un registro de lista, sea fila o tarjeta.
 *
 * `DataTable` renderiza **las dos representaciones** y oculta una por CSS según
 * el ancho (contrato de TASK-UI-004). Las pruebas escritas con
 * `getByRole("row")` sólo veían la de escritorio, así que bajo un proyecto móvil
 * fallaban por construcción — y ese fallo se leyó, la primera vez, como si la
 * pantalla estuviera rota en el teléfono.
 *
 * Los roles de Playwright respetan `display:none`, de modo que en cada ancho
 * sólo una de las dos ramas resuelve: la unión localiza el registro en ambos sin
 * que la prueba tenga que saber en qué viewport corre.
 */
export function listRecord(page: Page, text: RegExp | string) {
  const filter = typeof text === "string" ? { hasText: text } : { hasText: text }
  return page.getByRole("row").filter(filter).or(page.getByRole("article").filter(filter))
}

/** PDF mínimo válido: `validateFileBuffer` valida por magic bytes, no por extensión. */
export const QUOTATION_PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1")

/**
 * Adjunta una cotización al primer ítem del formulario de solicitud.
 *
 * Enviar repuestos/servicios exige **al menos una** cotización: sin ninguna, la
 * solicitud quedaba sin salida (aprobar exige elegir una ganadora y adjuntarlas
 * exige estado borrador, al que ya no se vuelve). La justificación en notas sólo
 * releva del mínimo de 3.
 *
 * `persistDraft` descarta en silencio los archivos sin proveedor o sin monto, así
 * que ambos campos se llenan aquí.
 */
export async function attachQuotation(page: Page, amount: string, supplier = "Proveedor E2E") {
  await page.locator('input[type="file"][id^="cot-"]').first().setInputFiles({
    name: "cotizacion-e2e.pdf",
    mimeType: "application/pdf",
    buffer: QUOTATION_PDF,
  })
  // La fila recién agregada es la última. Con proveedores sembrados el campo es
  // un Select de Radix (un <button>, no un input), así que se elige del listado.
  const supplierField = page.locator('[id^="cot-sup-"]').last()
  await expect(supplierField).toBeVisible()
  await supplierField.click()
  await page.getByRole("option", { name: supplier, exact: true }).click()
  await expect(supplierField).toContainText(supplier)
  await page.locator('[id^="cot-amt-"]').last().fill(amount)
}

/**
 * Espera a que el borrador termine de guardar. Los archivos se suben en ese
 * paso, así que continuar antes dejaría la solicitud sin cotizaciones.
 *
 * La señal es la desaparición de la cotización pendiente del formulario: al
 * guardar con éxito el servidor se queda con el archivo y el cliente lo saca de
 * la lista (y, si además el árbol se remonta por la revalidación, tampoco está).
 * El indicador "Guardado HH:MM" no sirve: es efímero y depende del reloj.
 */
export async function waitForDraftSaved(page: Page) {
  await expect(page.getByText("cotizacion-e2e.pdf")).toBeHidden({ timeout: 30_000 })
}

/**
 * Abre el borrador más reciente del tipo indicado desde el listado.
 *
 * Con reintento porque el clic puede caer antes de que la lista hidrate y
 * entonces no navega (la causa recurrente de fallas sólo-en-CI de este repo), y
 * porque el server action que crea el borrador puede no haber commiteado cuando
 * llegamos al listado.
 */
export async function openLatestDraft(page: Page, prefix: "REP" | "SER") {
  const link = page.getByRole("link", { name: new RegExp(`^Ver solicitud ${prefix}-`) })
  await expect(async () => {
    await page.goto("/solicitudes?estado=draft")
    await expect(link.first()).toBeVisible({ timeout: 5_000 })
    await link.first().click()
    await expect(page).toHaveURL(/\/solicitudes\/(?!nueva$)[^/]+$/, { timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
}
