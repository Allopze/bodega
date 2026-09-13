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
 * El id del recurso en la URL actual, tomado del **pathname**.
 *
 * `page.url().split("/").pop()` parece equivalente y no lo es. Varias acciones
 * redirigen con un query param —`/compras/<id>?actualizada=creada` en
 * `create-order.ts`, `?actualizada=enviada` en `order-status.ts`— y la ficha
 * puede limpiarlo después de montar, así que la última porción de la URL cruda
 * sale a veces como `<id>?actualizada=creada`. El regex de `toHaveURL` que
 * precede a la lectura no lo detiene: `[^/]+$` acepta la query.
 *
 * Con ese id contaminado la petición siguiente da 404, y el test no se cae ahí:
 * se cae mucho más abajo, esperando un control de una página que nunca cargó.
 * Y como el limpiado del param es una carrera, falla de forma intermitente. Ya
 * costó una vez en `correlativos-secciones.spec.ts`, que pasó 150 s esperando un
 * botón de recepción con un "Recurso no encontrado" en pantalla.
 */
export function idFromUrl(page: Page): string {
  return new URL(page.url()).pathname.split("/").pop() ?? ""
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
export async function pickCurrentMonthDate(
  page: Page,
  triggerName: string | RegExp,
  isoDate?: string,
) {
  const day = isoDate ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" })
  await page.getByRole("button", { name: triggerName }).click()
  const cell = page.locator(`[data-day="${day}"]:not([data-outside]) button`)
  // Una fecha del mes anterior no tiene celda propia en la grilla: `fixedWeeks`
  // asoma unos días fuera de mes, y esos quedan excluidos por `data-outside`.
  // Retroceder un mes la convierte en celda del mes visible.
  if (await cell.count() === 0) {
    await page.getByRole("navigation").getByRole("button").first().click()
  }
  await cell.click()
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

/**
 * Rótulo del envío en `/recepcion/nueva`, que sigue a la etapa elegida.
 *
 * En oficina nada "se recibe" —esa etapa no suma stock ni cierra ítems—, así
 * que el botón dice qué hace de verdad. Cada spec debe pedir el rótulo de *su*
 * etapa: un texto único para las dos volvería a dejar pasar un clic en la etapa
 * equivocada.
 */
export function receiptSubmitName(stage: "Oficina" | "Faena"): string {
  return stage === "Oficina" ? "Registrar llegada a oficina" : "Registrar recepción en faena"
}

/**
 * La tarjeta que elige la etapa en `/recepcion/nueva`.
 *
 * El regex va anclado al inicio del nombre accesible por dos razones: la tarjeta
 * ahora incluye su avance en el nombre ("Recepción en faena 6 unidad"), y sin
 * ancla "Recepción en faena" es subcadena del rótulo del envío ("Registrar
 * recepción en faena"), que resolvía a dos elementos en modo estricto.
 */
export function receiptStageCard(page: Page, stage: "Oficina" | "Faena") {
  return page.getByRole("button", { name: new RegExp(`^Recepción en ${stage}`, "i") })
}

/** Los toast de Sonner tapan botones; esperar a que se vayan evita clics perdidos. */
export async function waitForToastsToClear(page: Page) {
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 })
}

/**
 * Cierra la etapa de faena de una OC `via_oficina` por su guía de despacho.
 *
 * Desde que existe la GDI, esa etapa **ya no se registra desde
 * `/recepcion/nueva`**: la recepción en oficina prepara la guía y el servidor
 * rechaza el atajo con "La recepción final debe cotejarse con la guía X". Son
 * dos eventos físicos distintos —el despacho saca stock de oficina, el cotejo
 * lo ingresa en faena— y esta función recorre ambos.
 *
 * Se entra desde la página que muestre el enlace `GDI-…`: el comprobante de la
 * recepción en oficina, o la fila de `/recepcion` con su botón "Completar
 * guía"/"Cotejar".
 */
export async function dispatchAndReceiveGuide(page: Page) {
  const guideLink = page.getByRole("link", { name: /^GDI-\d{6}$/ }).first()
  await expect(guideLink).toBeVisible({ timeout: 30_000 })
  await guideLink.click()
  await expect(page).toHaveURL(/\/bodega\/guias\/[^/?]+$/, { timeout: 15_000 })
  await dispatchGuideAndConfirm(page)
}

/** Los dos eventos, ya estando en `/bodega/guias/<id>`. */
export async function dispatchGuideAndConfirm(page: Page) {
  await waitForToastsToClear(page)
  await page.getByRole("button", { name: /^Despachar$/ }).click()
  await page.getByRole("dialog").getByRole("button", { name: /^Despachar$/ }).click()
  await expect(page.getByText("Despachada").first()).toBeVisible({ timeout: 15_000 })

  await waitForToastsToClear(page)
  await page.getByRole("button", { name: /Confirmar recepción/i }).click()
  await page.getByRole("dialog").getByRole("button", { name: /Confirmar recepción/i }).click()
  await expect(page.getByText("Recibida").first()).toBeVisible({ timeout: 15_000 })
}

/**
 * Coteja **todas** las guías activas de una OC entrando desde `/recepcion`.
 *
 * Cada recepción en oficina prepara su propia GDI, así que una entrega parcial
 * más su saldo dejan dos, y la OC no abandona la cola hasta cerrarlas ambas.
 * Mientras haya guía activa la fila ofrece "Completar guía"/"Cotejar" en lugar
 * de "Recibir".
 */
export async function clearGuidesFromReceptionQueue(page: Page, orderCode: string, guias: number) {
  for (let vuelta = 1; vuelta <= guias; vuelta++) {
    await page.goto(`/recepcion?q=${orderCode}`)
    const accion = page.getByRole("link", { name: /Completar guía|Cotejar/ }).first()
    // `toBeVisible` y no `count()`: la tabla la pinta un componente de cliente,
    // así que `page.goto` resuelve antes de que existan las filas. Un `count()`
    // ahí devuelve 0 y el bucle se saltaba las guías **en silencio**, dejándolas
    // en borrador; el test moría mucho después, en una aserción de historial.
    await expect(accion, `sin guía activa de ${orderCode} en la vuelta ${vuelta} de ${guias}`)
      .toBeVisible({ timeout: 30_000 })
    await accion.click()
    await expect(page).toHaveURL(/\/bodega\/guias\/[^/?]+$/, { timeout: 15_000 })
    await dispatchGuideAndConfirm(page)
  }
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

/**
 * PNG mínimo válido (1×1, cabecera real).
 *
 * `validateFileBuffer` valida por magic bytes, no por extensión, así que un
 * archivo de mentira se rechaza en el servidor; y en el cliente, sin bytes de
 * imagen de verdad el navegador no le da dimensiones al `<img>`.
 */
export const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
)

/** La plantilla aprobada del fixture: Anexo 2 de extintores, cinco ítems puntuables. */
export const PLANTILLA_INSPECCION = "Inspección de Estado de Extintores"

/** Un token por proceso para que dos corridas no colisionen en la misma base sembrada. */
const RUN_INSPECCION = Date.now().toString(36).toUpperCase().slice(-5)
let contadorInspeccion = 0

/**
 * Da de alta una inspección desde el diálogo "Nueva inspección" y la deja abierta.
 *
 * Estaba copiado literalmente en cinco specs, y por eso un cambio de una línea en la UI
 * rompió los cinco: `inspection-run-list.tsx` empezó a anteponer el tipo a cada opción de
 * plantilla —"Inspección · Inspección de Estado de Extintores · E2E"— y las cinco copias
 * la buscaban con una regex anclada que ya no calzaba. Vive acá para que el próximo
 * cambio de ese estilo sea una línea y no cinco.
 *
 * El match es por **sufijo** (`nombre · versión`) a propósito: identifica la plantilla sin
 * depender de cómo la UI decore el prefijo.
 */
export async function crearInspeccion(page: Page, opciones: {
  /** Prefijo del identificador, para distinguir el origen en la bandeja. */
  prefijo?: string
  /** Identificación completa, cuando el test necesita fijarla. */
  identificacion?: string
  origen?: string
  sujetoInventario?: string
} = {}): Promise<{ identificacion: string; url: string }> {
  const identificacion = opciones.identificacion
    ?? `${opciones.prefijo ?? "E2E"}-${RUN_INSPECCION}-${++contadorInspeccion}`

  await page.goto("/prevencion/inspecciones")
  await expectPageTitle(page, "Inspecciones")

  await page.getByRole("button", { name: "Nueva inspección" }).click()
  const dialog = page.getByRole("dialog", { name: "Nueva inspección" })
  await dialog.getByLabel("Plantilla").click()
  await page.getByRole("option", { name: `${PLANTILLA_INSPECCION} · E2E` }).click()
  await dialog.getByLabel("Faena de la inspección").click()
  await page.getByRole("option", { name: "Faena E2E", exact: true }).click()

  if (opciones.origen) {
    await dialog.getByLabel("Origen").click()
    await page.getByRole("option", { name: opciones.origen, exact: true }).click()
  }
  if (opciones.sujetoInventario) {
    await dialog.getByLabel("Sujeto inspeccionado").click()
    await page.getByRole("option", { name: opciones.sujetoInventario }).click()
  } else {
    await dialog.locator('input[name="subjectType"]').fill("extintor")
    await dialog.locator('input[name="subjectLabel"]').fill(identificacion)
  }

  await dialog.getByRole("button", { name: "Crear" }).click()
  await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

  // Crear ahora abre la inspección: `inspection-run-list.tsx:506` hace `router.push` al
  // detalle. Las copias de este helper seguían buscando la fila en la bandeja y esperaban
  // 30 s por algo que ya no se renderiza, porque la navegación ya había ocurrido. Se
  // tolera cualquiera de los dos flujos en vez de fijar el actual: la bandeja sigue siendo
  // el camino cuando la creación no redirige.
  const detalle = /\/prevencion\/inspecciones\/[^/?]+$/
  if (!detalle.test(new URL(page.url()).pathname)) {
    const fila = page.getByRole("row").filter({ hasText: identificacion }).first()
    await expect(fila).toBeVisible({ timeout: 30_000 })
    await fila.getByRole("link").first().click()
  }
  await expect(page).toHaveURL(detalle, { timeout: 30_000 })

  return { identificacion, url: page.url() }
}

/**
 * Responde un ítem de la inspección abierta.
 *
 * Estaba copiado en cuatro specs con la misma omisión: `inspection-run-detail.tsx` pinta
 * **dos** veces cada ítem —tarjetas para móvil (`item-mobile-*`, línea 1292) y tabla para
 * escritorio (1381)— con idéntico `aria-label`, y esconde una de las dos por CSS según el
 * breakpoint. Ambas siguen en el DOM, así que `getByLabel` resolvía a dos elementos y
 * Playwright abortaba por strict mode. Se filtra por visibilidad en vez de tomar `.first()`:
 * el primero del DOM es la tarjeta móvil, que en escritorio está oculta y no se puede
 * clickear.
 */
export async function responderItemInspeccion(
  page: Page,
  item: string,
  resultado: string,
  comentario?: string,
) {
  await campoInspeccion(page, `Resultado de ${item}`).click()
  await page.getByRole("option", { name: resultado, exact: true }).click()
  if (comentario !== undefined) {
    await campoInspeccion(page, `Comentario de ${item}`).fill(comentario)
  }
}

/**
 * El control de un ítem, sólo el que está realmente pintado.
 *
 * `inspection-run-detail.tsx` documenta en I-06 que el árbol móvil y el de escritorio
 * coexisten en el DOM —uno oculto por `md:hidden`/`hidden md:*`— y trae su propio
 * `visibleItemElement` para distinguirlos. Los specs no lo hacían: `getByLabel` resolvía a
 * los dos y Playwright abortaba por strict mode. Se filtra por visibilidad en vez de tomar
 * `.first()` porque el primero del DOM es la tarjeta móvil, que en escritorio está oculta.
 */
export function campoInspeccion(page: Page, label: string) {
  return page.getByLabel(label, { exact: false }).filter({ visible: true })
}
