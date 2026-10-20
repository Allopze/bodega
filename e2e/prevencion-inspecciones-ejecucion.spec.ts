import { test, expect, type Page } from "@playwright/test"
import { MINIMAL_PNG, abrirComentarioInspeccion, confirmarDeclararEjecutada, crearInspeccion as crearInspeccionE2E, grupoDeResultado, login, responderItemInspeccion, textoVisible, campoInspeccion } from "./helpers"
import { esperarGuardado } from "./inspecciones-captura-helpers"

/**
 * E2E: ejecución de una inspección, de alta a acta firmada
 * (`/prevencion/inspecciones` → `/prevencion/inspecciones/<runId>`).
 *
 * Es el flujo de terreno del módulo y no tenía ni un solo test de navegador:
 * las 16 acciones de `app/(app)/prevencion/inspecciones/actions.ts` sólo se
 * ejercitaban desde `lib/__tests__/prevention-inspections-postgres.test.ts`,
 * que llama al servicio sin pasar por el formulario. Justo ahí vivían B-01
 * (el gate se evaluaba contra el borrador en memoria mientras el servidor
 * puntuaba lo último guardado) y B-08 (a un relato libre se le ofrecía
 * "Cumple / No cumple" y su texto no tenía dónde guardarse).
 *
 * El instrumento es la plantilla aprobada del fixture (`insptpl-insp-e2e`,
 * Anexo 2 de extintores): cinco ítems puntuables con daño potencial declarado
 * —`manometro` es 'grave' → hallazgo Alto— y cinco que sólo registran
 * contenido, más un acta de cierre con dos firmas obligatorias.
 *
 * Cada test crea **su propia** inspección: declarar ejecutada es terminal, y
 * compartir una fila obligaría a fijar el orden entre tests.
 */

/** Los cinco ítems que puntúan. El resto de la plantilla no cuenta para el %. */
const PUNTUABLES = ["Manómetro", "Sello", "Rótulo", "Manguera", "Certificado CECMEC"] as const

/**
 * Da de alta una inspección y abre su detalle.
 *
 * La identificación del sujeto lleva la marca de la corrida porque es lo único
 * con lo que se puede localizar la fila recién creada: el código lo genera el
 * servidor (`INSP-<año>-<8 al azar>`).
 */
const nuevaInspeccion = async (page: Page, opciones: { origen?: string; sujetoInventario?: string } = {}) =>
  (await crearInspeccionE2E(page, opciones)).identificacion

/** Responde un ítem puntuable. Los rótulos son largos: basta un prefijo único. */
const responder = responderItemInspeccion

/**
 * Deja los cinco puntuables conformes salvo el que se pida incumpliendo.
 *
 * El "Malo" va siempre con motivo: un no conforme genera un hallazgo y dispara CAPA en
 * criticidad alta, así que el formulario exige justificarlo por escrito —mismo piso que
 * un "No aplica" o un "Regular"—. Sin el motivo el guardado queda bloqueado y el botón
 * de declarar ejecutada nunca se habilita.
 */
async function responderTodo(page: Page, incumple?: string) {
  for (const item of PUNTUABLES) {
    const malo = item === incumple
    await responder(page, item, malo ? "Malo" : "Bueno", malo ? `Hallazgo E2E en ${item}.` : undefined)
  }
}

/** El acta que declara la plantilla: resultado + las dos firmas obligatorias. */
async function firmarActa(page: Page, resultado = "Con observaciones") {
  await page.getByLabel("Resultado del acta").click()
  await page.getByRole("option", { name: resultado, exact: true }).click()
  await page.getByLabel("Firma de prevencionista").fill("Admin E2E")
  await page.getByLabel("Firma de supervisor").fill("Comprador E2E")
}

/** La cabecera de trabajo: faena, sujeto, avance, estado de guardado y las acciones del teléfono. */
const resumenDeLaInspeccion = (page: Page) => page.getByRole("region", { name: "Resumen de la inspección" })

/**
 * Lo que falta para declarar ejecutada, tal como lo pinta la pantalla (no el diálogo, que
 * vive en un portal fuera de `<main>`): en vez de un muro, el avance resume «5 sin responder ·
 * acta incompleta» y «Ver lista (n)» despliega una línea por ítem o por acta. Devuelve esas líneas.
 *
 * Es una cosa distinta de lo que «todavía no se guarda», que va en su propio aviso: guardar
 * ya no se detiene por una fila mala, sólo el cierre.
 */
async function faltantesParaDeclarar(page: Page) {
  const resumen = resumenDeLaInspeccion(page)
  const ver = resumen.getByRole("button", { name: /^Ver lista \(\d+\)$/ })
  await expect(ver).toBeVisible()
  if ((await ver.getAttribute("aria-expanded")) !== "true") await ver.click()
  return resumen.getByRole("listitem")
}

/** El origen, el tipo y el resto del contexto de la inspección viven plegados en «Ver más datos». */
async function abrirMasDatos(page: Page) {
  const resumen = resumenDeLaInspeccion(page)
  const detalle = resumen.locator("details").filter({ has: page.getByText("Ver más datos", { exact: true }) })
  if ((await detalle.getAttribute("open")) === null) await detalle.locator(":scope > summary").click()
  return detalle
}

async function declararEjecutada(page: Page) {
  await page.getByRole("button", { name: "Declarar ejecutada" }).click()
  await confirmarDeclararEjecutada(page)
}

test.describe("Inspecciones — ejecución en terreno", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  /**
   * B-05: sin poder marcar el origen, ninguna inspección podía acreditar como
   * originada por el comité paritario, que es lo que distingue la
   * certificación Mutual. Y función #11: el sujeto dejó de ser texto libre, de
   * modo que su etiqueta queda congelada desde el inventario.
   */
  test("crear una inspección congela su origen y el sujeto elegido del inventario", async ({ page }) => {
    await nuevaInspeccion(page, { origen: "Comité Paritario", sujetoInventario: "Recurso · Extintor PQS Pañol E2E" })

    await expect(textoVisible(page, "Pendiente de ejecución").first()).toBeVisible()
    await expect(page.getByText("Extintor PQS Pañol E2E").first()).toBeVisible()
    await expect(textoVisible(page, "0 de 5 obligatorios")).toBeVisible()
    // El origen es un dato de contexto: está en «Ver más datos», no en la cabecera.
    const masDatos = await abrirMasDatos(page)
    await expect(masDatos.getByText("Comité Paritario")).toBeVisible()
  })

  /**
   * El gate no dice "faltan datos": nombra cada ítem pendiente y el acta que
   * falta, y mantiene el envío deshabilitado dentro del propio diálogo.
   */
  test("el gate nombra cada ítem sin responder y el acta que falta", async ({ page }) => {
    await nuevaInspeccion(page)

    // El resumen dice cuántos faltan y de qué clase, y cada parte salta al primer ítem.
    const resumen = resumenDeLaInspeccion(page)
    await expect(resumen.getByRole("button", { name: "5 sin responder" })).toBeVisible()
    await expect(resumen.getByRole("button", { name: "acta incompleta" })).toBeVisible()
    // «Ver lista» nombra cada ítem pendiente y el acta que falta.
    const faltantes = await faltantesParaDeclarar(page)
    for (const item of PUNTUABLES) {
      await expect(faltantes.filter({ hasText: item })).toHaveCount(1)
    }
    // El acta entra al gate por su resultado: `validateClosingAct` corta en el
    // primer problema, y con el resultado sin declarar ése es el que aparece.
    await expect(faltantes
      .filter({ hasText: "El resultado del acta no corresponde a las opciones de la plantilla." })).toHaveCount(1)

    await page.getByRole("button", { name: "Declarar ejecutada" }).click()
    const dialog = page.getByRole("dialog")
    // El diálogo repite el resumen y bloquea su propio envío: el botón homónimo del
    // disparador queda fuera del diálogo, así que se acota con `dialog`.
    await expect(dialog.getByText("Para declarar ejecutada falta:")).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Declarar ejecutada" })).toBeDisabled()
  })

  test("guardar respuestas deja la inspección en ejecución y no muestra un cumplimiento mientras se edita", async ({ page }) => {
    await nuevaInspeccion(page)

    await responder(page, "Manómetro", "Bueno")
    await responder(page, "Sello", "Bueno")
    await expect(textoVisible(page, "2 de 5 obligatorios")).toBeVisible()
    // Con 2 de 24 respondidos «100%» era una promesa falsa: el cumplimiento se muestra sólo
    // después de declarar ejecutada, cuando el servidor lo firma.
    await expect(textoVisible(page, "100%")).toHaveCount(0)
    await expect(resumenDeLaInspeccion(page).getByText("Resultado normalizado")).toHaveCount(0)

    // El aviso "Guardado correctamente." no sirve de señal: `saveAnswers` le
    // pasa a `useOperation` un `onSuccess` propio, y en ese caso el hook no
    // guarda ese texto, así que nunca aparece.
    // El efecto persistido sí es estable — la ejecución arranca al guardar.
    await page.getByRole("button", { name: "Guardar respuestas" }).click()
    await expect(textoVisible(page, "En ejecución").first()).toBeVisible({ timeout: 30_000 })

    await page.reload()
    await expect(textoVisible(page, "2 de 5 obligatorios")).toBeVisible({ timeout: 15_000 })
    await expect(textoVisible(page, "En ejecución").first()).toBeVisible()
  })

  /**
   * B-03: la misma regla del CHECK `prevention_inspection_answer_requires_comment`,
   * evaluada antes de enviar. Sin esto Postgres reventaba el lote entero y el
   * usuario veía el texto crudo de la violación.
   *
   * P1-1: y la fila mala ya no frena el guardado de las demás. Se queda en el
   * dispositivo, se nombra aparte («Respuestas que todavía no se guardan») y lo que
   * bloquea es el cierre, no el botón «Guardar respuestas».
   */
  test("un \"Malo\" sin motivo queda retenido sin frenar el guardado y bloquea el cierre", async ({ page }) => {
    await nuevaInspeccion(page)

    // La escala del ítem manda: los puntuables de esta plantilla son `bueno_malo_obs` y
    // no ofrecen escape. `validateAnswerRow` exige el mismo mínimo a "Malo" que a un
    // "No aplica" o un "Regular", así que la regla bajo prueba es la misma.
    await responder(page, "Certificado CECMEC", "Malo")
    const retenida = page.getByRole("button", { name: /Certificado CECMEC.*exige indicar el motivo/ })
    await expect(textoVisible(page, "Respuestas que todavía no se guardan")).toBeVisible()
    await expect(retenida).toBeVisible()
    // El pliegue del comentario se abrió solo porque la respuesta exige motivo, y el problema se dice en el ítem.
    await expect(campoInspeccion(page, "Comentario de Certificado CECMEC")).toBeVisible()
    await expect(textoVisible(page, "Falta el motivo: escribe al menos 3 caracteres.")).toBeVisible()
    // Guardar sigue disponible: guarda lo que sí se puede y deja esta fila donde está.
    await expect(page.getByRole("button", { name: "Guardar respuestas" })).toBeEnabled()

    // El cierre, en cambio, se bloquea y dice cuál es la fila.
    await page.getByRole("button", { name: "Declarar ejecutada" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText(/Certificado CECMEC.*exige indicar el motivo/)).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Declarar ejecutada" })).toBeDisabled()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)

    await (await abrirComentarioInspeccion(page, "Certificado CECMEC")).fill("Certificado vencido hace ocho meses.")
    await expect(retenida).toHaveCount(0)
    await expect(textoVisible(page, "Falta el motivo: escribe al menos 3 caracteres.")).toHaveCount(0)
    await expect(textoVisible(page, "Respuestas que todavía no se guardan")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Guardar respuestas" })).toBeEnabled()

    await page.getByRole("button", { name: "Guardar respuestas" }).click()
    await expect(textoVisible(page, "En ejecución").first()).toBeVisible({ timeout: 30_000 })

    // El motivo es parte de la evidencia del hallazgo: tiene que sobrevivir.
    await page.reload()
    // Con el motivo escrito el pliegue ya no se abre solo: se abre como lo haría una persona.
    await expect(await abrirComentarioInspeccion(page, "Certificado CECMEC"))
      .toHaveValue("Certificado vencido hace ocho meses.", { timeout: 15_000 })
  })

  /**
   * El recorrido completo: se declara ejecutada, el servidor puntúa 4 de 5
   * (los ítems de inventario no cuentan para el cumplimiento) y materializa un
   * hallazgo cuya criticidad sale del daño potencial de la plantilla, no del
   * criterio de quien la ejecuta.
   */
  test("declarar ejecutada calcula el cumplimiento y materializa el hallazgo con su criticidad", async ({ page }) => {
    await nuevaInspeccion(page)

    await responderTodo(page, "Manómetro")
    await firmarActa(page)
    await declararEjecutada(page)

    await page.reload()
    await expect(textoVisible(page, "Pendiente de revisión").first()).toBeVisible({ timeout: 15_000 })
    await expect(textoVisible(page, "80%").first()).toBeVisible()

    await expect(page.getByRole("heading", { name: "Hallazgos (1)" })).toBeVisible()
    const hallazgo = page.getByRole("row").filter({ hasText: "Manómetro: aguja en zona verde." })
    await expect(hallazgo.getByText("Alta")).toBeVisible()
    await expect(hallazgo.getByText("Abierto")).toBeVisible()

    // El acta queda firmada y en modo lectura junto al resultado declarado: una fila por dato,
    // rótulo («Resultado», «Prevencionista») y valor («Admin E2E · fecha y hora de la firma»).
    const acta = page.locator("section#acta-cierre")
    await expect(acta.getByText("Con observaciones", { exact: true })).toBeVisible()
    await expect(acta.getByText(/^Admin E2E · \d{2}-\d{2}-\d{4}/)).toBeVisible()
  })

  /**
   * B-08: un ítem que no expresa conformidad (`select`, `text`, `date`) se
   * responde con su contenido y queda como 'recorded'. Antes se le ofrecía
   * "Cumple / No cumple" sobre un relato libre, lo que además inflaba el
   * cumplimiento; ahora no entra al denominador.
   */
  test("los ítems que sólo registran contenido se guardan sin mover el cumplimiento", async ({ page }) => {
    await nuevaInspeccion(page)

    await campoInspeccion(page, "Respuesta de Tipo de extintor").click()
    await page.getByRole("option", { name: "PQS (Polvo Químico Seco)" }).click()
    await campoInspeccion(page, "Respuesta de Peso (kg)").fill("6")
    await campoInspeccion(page, "Respuesta de Observaciones adicionales").fill("Ubicado junto a la puerta del pañol.")

    // Tres ítems respondidos y aún así no hay cumplimiento que calcular: lo
    // registrado no puntúa.
    await expect(textoVisible(page, "0 de 5 obligatorios")).toBeVisible()
    await expect(resumenDeLaInspeccion(page).getByText("Resultado normalizado")).toHaveCount(0)
    // Y el gate sigue exigiendo los cinco puntuables.
    await expect(page.getByRole("button", { name: "Declarar ejecutada" })).toBeVisible()
    const faltantes = await faltantesParaDeclarar(page)
    await expect(faltantes.filter({ hasText: "Manómetro" })).toHaveCount(1)

    await responderTodo(page, "Manómetro")
    await firmarActa(page)
    await declararEjecutada(page)

    await page.reload()
    await expect(textoVisible(page, "80%").first()).toBeVisible({ timeout: 15_000 })
    await expect(textoVisible(page, "Ubicado junto a la puerta del pañol.").first()).toBeVisible()
  })

  /**
   * Función #9: en terreno la conexión falla justo al cerrar. El cierre queda en
   * IndexedDB y se envía solo al volver la señal; la idempotencia del reintento la da
   * el servidor (devuelve éxito si el run ya quedó ejecutado por la misma persona).
   *
   * Ya no hay un botón siempre visible para «encolar»: sin conexión, el diálogo de
   * cierre ofrece guardarlo en el dispositivo. Para llegar ahí se corta la red de verdad
   * (`context.setOffline`), no se aprieta un atajo.
   */
  test("sin conexión el cierre se guarda en el dispositivo y se entrega solo al volver la señal", async ({ page, context }) => {
    await nuevaInspeccion(page)

    await responderTodo(page, "Sello")
    await firmarActa(page, "Operativo")
    // Lo último ya está en el servidor: así el único envío pendiente al cortar la red es el cierre.
    await esperarGuardado(page)

    await context.setOffline(true)
    await page.getByRole("button", { name: "Declarar ejecutada" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText(/Sin conexión\. Puedes guardar el cierre en este dispositivo/)).toBeVisible()
    // Declarar de verdad no se puede sin red; lo que se ofrece es guardarlo.
    await expect(dialog.getByRole("button", { name: "Declarar ejecutada" })).toBeDisabled()
    await dialog.getByRole("button", { name: "Guardar cierre en este dispositivo" }).click()

    await expect(page.getByText("Cierre guardado en este dispositivo", { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("button", { name: "Enviar ahora" })).toBeDisabled()
    // Con un cierre pendiente la edición queda bloqueada: lo guardado es una foto del trabajo.
    await expect((await grupoDeResultado(page, "Manómetro")).getByRole("radio", { name: "Bueno", exact: true })).toBeDisabled()

    // Al volver la señal se envía solo; el aviso se retira sin que nadie toque nada.
    await context.setOffline(false)
    await expect(page.getByText("Cierre guardado en este dispositivo", { exact: true })).toBeHidden({ timeout: 30_000 })

    await page.reload()
    await expect(textoVisible(page, "Pendiente de revisión").first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("heading", { name: "Hallazgos (1)" })).toBeVisible()
  })

  /**
   * La planilla física del turno: se sube, queda como evidencia del run y el
   * visor la deja al lado de las respuestas para poder cotejarlas. Exige
   * `prevention:inspections:ingest`, permiso aparte de ejecutar.
   */
  test("subir la planilla física la deja junto a las respuestas", async ({ page }) => {
    await nuevaInspeccion(page)

    await expect(page.getByRole("heading", { name: "Subir la planilla física" })).toBeVisible()
    // El input real es `sr-only` y lo dispara el botón; se alimenta directo.
    await page.locator('input[type="file"][accept*="image/jpeg"]').setInputFiles({
      name: "planilla-e2e.png",
      mimeType: "image/png",
      buffer: MINIMAL_PNG,
    })

    // La subida recarga la página: el servidor es quien lee la planilla.
    await expect(page.getByRole("heading", { name: "Planilla original" })).toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole("button", { name: "Ampliar la planilla" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Agregar otra hoja" })).toBeVisible()
  })
})

test.describe("Inspecciones — traspaso físico por jefe de faena", () => {
  test("el jefe de faena sube el papel, digita y ejecuta, pero no revisa", async ({ page }) => {
    await login(page, "jefe.faena@e2e.chome.cl", "chome2026")
    await nuevaInspeccion(page)

    await expect(page.getByRole("heading", { name: "Subir la planilla física" })).toBeVisible()
    await page.locator('input[type="file"][accept*="image/jpeg"]').setInputFiles({
      name: "reporte-fisico-jefe-faena.png",
      mimeType: "image/png",
      buffer: MINIMAL_PNG,
    })
    await expect(page.getByRole("heading", { name: "Planilla original" })).toBeVisible({ timeout: 60_000 })

    await responderTodo(page, "Sello")
    await firmarActa(page, "Con observaciones")
    await declararEjecutada(page)
    await page.reload()

    await expect(textoVisible(page, "Pendiente de revisión").first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("heading", { name: "Hallazgos (1)" })).toBeVisible()
    await expect(page.getByRole("button", { name: /revisar/i })).toHaveCount(0)
  })
})

/**
 * Función #8: `locationLatitude/Longitude` se aceptaban en el servicio desde el
 * principio y ninguna pantalla los enviaba nunca.
 *
 * La captura en sí **no se certifica acá, y no por falta de ganas**:
 * `next.config.ts` envía `Permissions-Policy: camera=(), microphone=(),
 * geolocation=()`, que apaga la API para todo el origen. Con esa cabecera
 * `getCurrentPosition` entra siempre por el callback de error, conceda el
 * navegador el permiso o no — de ahí que el test lo conceda explícitamente:
 * así queda demostrado que lo que falta no es el permiso del navegador.
 *
 * Lo que sí se certifica es la mitad que hoy corre en producción, y que es la
 * decisión de diseño: la ubicación es un dato de apoyo, así que su negativa
 * degrada en silencio y jamás bloquea el registro de la inspección. El día que
 * la cabecera admita `geolocation=(self)`, la aserción positiva entra sola.
 */
test.describe("Inspecciones — ubicación de la ejecución", () => {
  test("no poder ubicar el equipo se avisa y no bloquea el registro", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"])
    await context.setGeolocation({ latitude: -33.447487, longitude: -70.673676 })
    await login(page)
    await nuevaInspeccion(page)

    // La ubicación es un dato de apoyo: vive en «Ver más datos», no ocupa la cabecera.
    await abrirMasDatos(page)
    await page.getByRole("button", { name: "Capturar ubicación" }).click()
    await expect(page.getByText("No se pudo obtener la ubicación. La inspección se registra igual."))
      .toBeVisible({ timeout: 30_000 })

    // Degradación, no bloqueo: la inspección sigue siendo respondible y
    // declarable sin coordenadas.
    await responderTodo(page)
    await firmarActa(page, "Operativo")
    await declararEjecutada(page)
    await page.reload()
    await expect(textoVisible(page, "Pendiente de revisión").first()).toBeVisible({ timeout: 15_000 })
    await expect(textoVisible(page, "100%").first()).toBeVisible()
  })
})
