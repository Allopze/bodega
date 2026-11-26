/**
 * E2E: navegación del área «Control operacional» ordenada por tarea
 * (rama `feat/control-operacional-orden`, 2026-10-22; menú reorganizado el
 * 2026-11-13 en `feat/control-operacional-uiux`).
 *
 * El área pasó de diez ítems planos de tres módulos a nueve ítems en tres
 * grupos (Seguimiento, Flota, Combustible), con rutas alias que deben dejar
 * activo a su ítem, barras de pestañas (`SectionNav`) entre las pantallas de
 * cada sección, una sola entrada «Agregar datos» y un panel con tiles que llevan a
 * su subconjunto. Las pruebas unitarias cubren el árbol (`navigation.test.ts`)
 * y los datos puros (`attention-tiles.test.ts`); esto cubre lo que la persona
 * ve en el navegador.
 *
 * Grupos plegados (auditoría de encontrabilidad 2026-11-26): en el panel del área sólo está
 *   abierto el grupo de la pantalla actual; los demás se pliegan bajo su rótulo (un botón con
 *   `aria-expanded`) y sus enlaces NO están en el DOM hasta abrirlos. Sin pantalla actual en el
 *   área (Inicio) quedan todos abiertos. Quien necesita ver un ítem de otro grupo lo abre antes,
 *   con `abrirGrupos`, como lo haría una persona. «Configuración» de Mantención viene desplegada.
 *
 * Cómo se localiza, y por qué:
 *   - El menú se busca por **href**, no por rótulo: el rótulo de «Consumo y
 *     rendimiento» se acorta en el sidebar («Consumo») porque activo no cabe, y
 *     otras líneas siguen afinando textos. El href es el contrato.
 *   - Las pestañas se buscan por el `aria-label` de su barra y se leen con
 *     `aria-current="page"`, que es lo que anuncia el lector de pantalla.
 *   - `getByRole` ignora los nodos ocultos; el botón «Agregar datos» existe dos
 *     veces (TopBar en escritorio y cabecera móvil `lg:hidden`) y sólo una
 *     resuelve. Por eso no hay `.first()` ni `getByText` sobre esos nodos.
 *   - Las aserciones sobre listas de rutas son `expect.soft`: una falla en la
 *     tercera ruta no esconde a la décima, y el mensaje nombra la ruta.
 *
 * Datos del seed (`e2e/setup-db.ts`): `admin@e2e.chome.cl` tiene todos los
 * permisos; `scoped@e2e.chome.cl` (`solicitante_faena`) no tiene ningún permiso
 * de flota, mantención ni combustible; `jefe.faena@e2e.chome.cl`
 * (`jefe_terreno`) sólo tiene `prevention:inspections:view`, que basta para
 * abrir el panel operacional. No existe un rol de sólo `combustibles:view` sin
 * `view_costs`, así que «Pagos oculto por costos» sólo se prueba
 * por el lado de quien no tiene ningún permiso de combustible (ver el último
 * bloque).
 *
 * Rediseño de Combustible (2026-10-31): el grupo pasó de cinco ítems (Consumo,
 * Cargas, Revisión, TAE y sellos, Facturas y pagos) a ocho: Panel, Cargas, Por
 * revisar, Cuadratura, Consumo, Pagos, Fuentes de datos y Ajustes. Ya no hay
 * `aliases`: cada pantalla vive bajo el `href` de su ítem y las URL de antes son
 * páginas puente (`lib/combustibles/legacy-redirects.ts`) que terminan en la
 * pantalla nueva, de modo que lo que se mide aquí es el ítem activo de la
 * pantalla a la que se llega. «Por revisar» es una sola bandeja (cargas, casos,
 * patentes y pedidos), así que ya no hay que aceptar «cualquiera de las dos colas».
 */
import { expect, test, type Locator, type Page } from "@playwright/test"
import { WORKSITE_ID, withSql } from "./combustibles-control-helpers"
import { expectPageTitle, login } from "./helpers"

/**
 * `aria-label` de cada barra de pestañas, tal como lo pasa cada página a `SectionNav`
 * (`lib/combustibles/section-nav.ts` arma los ítems).
 */
const BARRAS = {
  cargas: "Vistas de cargas",
  revisar: "Por revisar",
  cuadratura: "Vistas de cuadratura",
  consumo: "Vistas de consumo y rendimiento",
  pagos: "Pagos",
} as const

/** Vehículo del seed E2E con ficha única (`/flota/[id]`): el mismo de `ficha-vehiculo.spec.ts`. */
const VEHICULO_DE_LA_FICHA = "fuel-veh-e2e"

/**
 * El panel del área en el sidebar: la lista de su acordeón o, si el área se pinta plana (un solo destino, como para quien
 * sólo tiene inspecciones), la que contiene su ítem. Con los grupos plegados no hay un enlace que esté siempre: el
 * acordeón se ubica por su botón, y su lista es la primera dentro de su contenedor.
 */
function menuDelArea(page: Page): Locator {
  const sidebar = page.getByRole("navigation", { name: "Navegación", exact: true })
  const acordeon = sidebar.getByRole("button", { name: "Control operacional", exact: true }).locator("..").locator("ul").first()
  const plana = sidebar.locator("ul").filter({ has: page.locator('a[href="/control-operacional"]') }).first()
  return acordeon.or(plana)
}

/**
 * Despliega los grupos plegados del área, como lo haría una persona. Reintenta el clic: uno anterior a la hidratación
 * mueve el foco pero no corre el manejador (mismo motivo que en `navegacion-por-rol.spec.ts`). Los grupos que el rol
 * no ve se saltan.
 */
async function abrirGrupos(page: Page): Promise<void> {
  const menu = menuDelArea(page)
  for (const { grupo } of MENU_DEL_AREA) {
    const cabecera = menu.getByRole("button", { name: empiezaCon(grupo) })
    if ((await cabecera.count()) === 0) continue
    await expect(async () => {
      if ((await cabecera.getAttribute("aria-expanded")) === "false") await cabecera.click()
      await expect(cabecera).toHaveAttribute("aria-expanded", "true", { timeout: 2_000 })
    }).toPass({ timeout: 20_000 })
  }
}

/**
 * Un ítem del sidebar, por href. «Configuración» (Mantención y Combustible) es un padre que lleva a su primer hijo: su
 * enlace comparte href con ese hijo y va antes en el DOM, así que un href de hijo se lee con `last()` y el resto con `first()`.
 * El ítem tiene que estar a la vista: su grupo, abierto (el de la pantalla actual lo está).
 */
function itemDelMenu(page: Page, href: string): Locator {
  const enlaces = menuDelArea(page).locator(`a[href="${href}"]`)
  return HREFS_DE_HIJOS.has(href) ? enlaces.last() : enlaces.first()
}

/** La fila de primer nivel (`<li>`) cuyo enlace lleva a `href`: para leer a un padre con sus hijos. */
function filaDePrimerNivel(page: Page, href: string): Locator {
  return menuDelArea(page).locator(`a[href="${href}"]`).first().locator("xpath=ancestor::li[1]")
}

function barraDe(page: Page, etiqueta: string): Locator {
  return page.getByRole("navigation", { name: etiqueta, exact: true })
}

/** `getByRole("link", { name })` calza por subcadena; las pestañas con contador («Anomalías 4») se leen por prefijo. */
function empiezaCon(texto: string): RegExp {
  return new RegExp(`^${texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Menú del área
// ─────────────────────────────────────────────────────────────────────────────

interface DestinoDelMenu {
  /** Para un padre es el href de su primer hijo visible (así lo resuelve `getVisibleAreas`). */
  href: string
  nombre: string | RegExp
  /** Destinos anidados de un padre («Configuración»); sólo se pintan con el padre abierto (el de Mantención viene abierto). */
  hijos?: readonly DestinoDelMenu[]
}

const MENU_DEL_AREA: ReadonlyArray<{ grupo: string; destinos: readonly DestinoDelMenu[] }> = [
  {
    grupo: "Seguimiento",
    destinos: [{ href: "/control-operacional", nombre: "Panel operacional" }],
  },
  {
    grupo: "Flota",
    destinos: [
      { href: "/flota", nombre: "Vehículos" },
      // Traslados entre faenas (2026-11-18): visible con `flota:view` cuando el submódulo está encendido,
      // como en el seed E2E (`e2e/setup-db.ts`).
      { href: "/flota/traslados", nombre: "Traslados" },
      // Turnos y ralentí (2026-11-20): `flota:view_shifts`, con el submódulo encendido en el seed E2E.
      { href: "/flota/turnos", nombre: "Turnos y ralentí" },
      { href: "/flota/conductores", nombre: "Conductores" },
      { href: "/flota/monitoreo", nombre: "Monitoreo GPS" },
      { href: "/flota/indicadores", nombre: "Indicadores GPS" },
    ],
  },
  {
    grupo: "Mantención",
    destinos: [
      // «Panel de mantención» y «Panel de combustible» ya no repiten rótulo; igual se distinguen por href y por grupo.
      { href: "/mantencion/panel", nombre: "Panel de mantención" },
      // Estos tres llevan el aviso de «Mis pendientes» de Mantención (`badge: "count"`, 2026-11-26): el contador va dentro del
      // enlace y depende de los datos de la base compartida, así que sólo se lee el rótulo por prefijo.
      { href: "/mantencion/ot", nombre: empiezaCon("Órdenes de trabajo") },
      // Bandeja de las notas de pedido de repuestos (2026-11-26): el administrador del seed tiene `mant:np:*`.
      { href: "/mantencion/notas-pedido", nombre: empiezaCon("Notas de pedido") },
      { href: "/mantencion/registros", nombre: empiezaCon("Registros firmados") },
      // Ítem propio desde 2026-11-26: antes el Historial marcaba «Registros firmados».
      { href: "/mantencion/registros/historicos", nombre: "Historial de mantenciones" },
      { href: "/mantencion/equipos", nombre: "Equipos" },
      {
        href: "/mantencion/pautas",
        nombre: "Configuración",
        hijos: [
          { href: "/mantencion/pautas", nombre: "Pautas" },
          { href: "/mantencion/catalogos", nombre: "Marcas y talleres" },
          { href: "/mantencion/dispositivos", nombre: "App del mecánico" },
        ],
      },
      // El catálogo es del módulo `repuestos`, apagable por separado de Mantención de equipos: no puede colgar del padre de otro módulo.
      { href: "/mantencion/repuestos", nombre: "Catálogo de repuestos" },
    ],
  },
  {
    grupo: "Combustible",
    destinos: [
      { href: "/combustibles", nombre: "Panel de combustible" },
      { href: "/combustibles/cargas", nombre: "Cargas" },
      // El contador de pendientes (`badge: "count"`) va dentro del enlace: sólo se lee el rótulo por prefijo.
      { href: "/combustibles/revisar", nombre: empiezaCon("Por revisar") },
      { href: "/combustibles/cuadratura", nombre: "Cuadratura" },
      { href: "/combustibles/consumo", nombre: "Consumo" },
      { href: "/combustibles/pagos", nombre: "Facturas y pagos" },
      {
        href: "/combustibles/fuentes",
        nombre: "Configuración",
        hijos: [
          { href: "/combustibles/fuentes", nombre: "Fuentes de datos" },
          { href: "/combustibles/ajustes", nombre: "Ajustes" },
        ],
      },
    ],
  },
]

/** Destinos propios de cada pantalla (los hijos de un padre y las hojas), sin contar al padre que comparte href con su primer hijo. */
const DESTINOS_DEL_MENU: DestinoDelMenu[] = MENU_DEL_AREA.flatMap((grupo) =>
  grupo.destinos.flatMap((destino) => destino.hijos ?? [destino]))
const HREFS_DEL_MENU: string[] = DESTINOS_DEL_MENU.map((destino) => destino.href)
const HREFS_DE_HIJOS = new Set(MENU_DEL_AREA.flatMap((grupo) => grupo.destinos.flatMap((destino) => (destino.hijos ?? []).map((hijo) => hijo.href))))

test.describe("Control operacional — menú del área", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("agrupa el área en Seguimiento, Flota, Mantención y Combustible con sus ítems de primer nivel en orden", async ({ page }) => {
    await page.goto("/control-operacional")

    const area = page
      .getByRole("navigation", { name: "Navegación", exact: true })
      .getByRole("button", { name: "Control operacional", exact: true })
    await expect(area).toHaveAttribute("aria-expanded", "true")

    const menu = menuDelArea(page)
    // Cada grupo es un botón con `aria-expanded`; sólo está abierto el de la pantalla actual (Seguimiento: el Panel).
    for (const { grupo } of MENU_DEL_AREA) {
      await expect.soft(menu.getByRole("button", { name: empiezaCon(grupo) }), `grupo ${grupo}`)
        .toHaveAttribute("aria-expanded", grupo === "Seguimiento" ? "true" : "false")
    }
    await expect(menu.getByRole("link")).toHaveCount(1)

    // Con los cuatro grupos abiertos: los ítems de primer nivel y los destinos de «Configuración» de Mantención, que viene
    // desplegada (`defaultOpen`). La de Combustible sigue plegada: sólo se pintan sus hijos con el padre abierto.
    await abrirGrupos(page)
    const hijosDeMantencion = MENU_DEL_AREA.find((grupo) => grupo.grupo === "Mantención")!.destinos.flatMap((destino) => destino.hijos ?? []).length
    await expect(menu.getByRole("link")).toHaveCount(MENU_DEL_AREA.reduce((suma, grupo) => suma + grupo.destinos.length, 0) + hijosDeMantencion)

    // Estructura completa en un solo vistazo: cada rótulo de grupo (el botón que lo pliega) seguido de los hrefs de sus
    // ítems de primer nivel, en el orden del menú.
    const estructura = await menu.locator(":scope > li").evaluateAll((filas) =>
      filas.flatMap((fila) => {
        const cabecera = fila.querySelector(":scope > div > button")
        if (!cabecera) return [fila.querySelector("a")?.getAttribute("href") ?? "(fila sin enlace)"]
        const filasDelGrupo = Array.from(fila.querySelectorAll(":scope > div > div > ul > li"))
        return [
          (cabecera.querySelector("span")?.textContent ?? "").trim(),
          ...filasDelGrupo.map((filaDelGrupo) => filaDelGrupo.querySelector("a")?.getAttribute("href") ?? "(fila sin enlace)"),
        ]
      }),
    )
    expect(estructura).toEqual(MENU_DEL_AREA.flatMap((grupo) => [grupo.grupo, ...grupo.destinos.map((destino) => destino.href)]))

    // Y cada ítem tiene un rótulo legible, no un guion ni un texto vacío.
    for (const { href, nombre } of MENU_DEL_AREA.flatMap((grupo) => grupo.destinos)) {
      await expect.soft(filaDePrimerNivel(page, href).locator("a").first(), `ítem ${href}`).toHaveText(nombre)
    }
  })

  test("en una pantalla de Mantención sólo ese grupo muestra sus destinos, con «Configuración» ya desplegada", async ({ page }) => {
    await page.goto("/mantencion/panel")
    const menu = menuDelArea(page)
    for (const { grupo } of MENU_DEL_AREA) {
      await expect.soft(menu.getByRole("button", { name: empiezaCon(grupo) }), `grupo ${grupo}`)
        .toHaveAttribute("aria-expanded", grupo === "Mantención" ? "true" : "false")
    }
    const mantencion = MENU_DEL_AREA.find((grupo) => grupo.grupo === "Mantención")!
    const hijos = mantencion.destinos.flatMap((destino) => destino.hijos ?? [])
    // Sólo los destinos de Mantención están en el DOM: nadie tiene que desplazar el menú por encima de Flota y Seguimiento.
    await expect(menu.getByRole("link")).toHaveCount(mantencion.destinos.length + hijos.length)
    await expect(itemDelMenu(page, "/mantencion/panel")).toHaveAttribute("aria-current", "page")

    // «Configuración» muestra sus tres destinos sin abrirla; la de Combustible, plegada, ya no está a la vista.
    const configuracion = filaDePrimerNivel(page, "/mantencion/pautas")
    await expect(configuracion.getByRole("button", { name: "Mostrar destinos de Configuración", exact: true })).toHaveAttribute("aria-expanded", "true")
    await expect(configuracion.locator("li a")).toHaveText(hijos.map((hijo) => hijo.nombre as string))
  })

  test("«Configuración» de Combustible sigue plegada hasta entrar a uno de sus destinos", async ({ page }) => {
    await page.goto("/combustibles")
    const configuracion = filaDePrimerNivel(page, "/combustibles/fuentes")
    await expect(configuracion.getByRole("button", { name: "Mostrar destinos de Configuración", exact: true })).toHaveAttribute("aria-expanded", "false")
    await expect(configuracion.locator("li a")).toHaveCount(0)
  })

  test("«Configuración» pliega sus destinos bajo un solo padre y se abre sola al entrar a uno de ellos", async ({ page }) => {
    // El padre no tiene pantalla propia: su enlace lleva al primer hijo que la persona
    // puede abrir. Con el administrador del seed (todos los permisos) son Pautas y
    // Fuentes de datos; los hijos se pintan sólo con el padre abierto.
    for (const grupo of MENU_DEL_AREA) {
      for (const padre of grupo.destinos.filter((destino) => destino.hijos)) {
        const hijos = padre.hijos ?? []
        const primero = hijos[0]!
        await page.goto(primero.href)
        await expect.soft(page, `${primero.href} no debe mandar a /forbidden`).not.toHaveURL(/\/forbidden|\/login/)

        const fila = filaDePrimerNivel(page, padre.href)
        await expect.soft(fila.getByRole("button", { name: "Mostrar destinos de Configuración", exact: true }), `${grupo.grupo}: el padre se abre al entrar a un hijo`)
          .toHaveAttribute("aria-expanded", "true")
        const enlaces = fila.locator("li a")
        await expect.soft(enlaces, `${grupo.grupo}: hijos de Configuración`).toHaveCount(hijos.length)
        await expect.soft(enlaces, `${grupo.grupo}: orden y rótulos de los hijos`).toHaveText(hijos.map((hijo) => hijo.nombre as string))
        // El padre queda como camino (sin `aria-current`): el destino activo es el hijo.
        await expect.soft(fila.locator('[aria-current="page"]'), `${grupo.grupo}: un solo destino activo`).toHaveCount(1)
      }
    }
  })

  test("la ficha de mantención de un equipo marca «Equipos» y las otras pestañas de la ficha siguen marcando «Vehículos»", async ({ page }) => {
    // La ficha única del vehículo (`/flota/[id]`, vehículo del seed: `ficha-vehiculo.spec.ts`) tiene la pestaña Mantención,
    // y su miga dice «Mantención › Equipos»: el menú no puede marcar «Vehículos» ahí (alias con comodín de «Equipos»).
    await page.goto(`/flota/${VEHICULO_DE_LA_FICHA}/mantencion`)
    await expect.soft(page, "la ficha de mantención no debe mandar a /forbidden").not.toHaveURL(/\/forbidden|\/login/)
    await expect(menuDelArea(page).locator('[aria-current="page"]')).toHaveCount(1)
    await expect(itemDelMenu(page, "/mantencion/equipos")).toHaveAttribute("aria-current", "page")

    for (const pestana of ["", "/flota", "/combustible"]) {
      await page.goto(`/flota/${VEHICULO_DE_LA_FICHA}${pestana}`)
      await expect(menuDelArea(page).locator('[aria-current="page"]'), `pestaña «${pestana || "Resumen"}»`).toHaveCount(1)
      await expect(itemDelMenu(page, "/flota"), `pestaña «${pestana || "Resumen"}»`).toHaveAttribute("aria-current", "page")
    }
  })

  test("cada destino del menú abre su pantalla y queda como el único ítem activo", async ({ page }) => {
    // Es la guarda contra «el menú ofrece lo que la ruta rechaza»: ninguno de
    // los destinos manda a /forbidden para quien tiene todos los permisos, y cada
    // uno se reconoce a sí mismo. «Cuadratura», «Consumo» y «Ajustes» son entradas
    // sin pantalla propia: redirigen a su primera vista y el ítem sigue activo.
    for (const href of HREFS_DEL_MENU) {
      await page.goto(href)
      await expect.soft(page, `${href} no debe mandar a /forbidden`).not.toHaveURL(/\/forbidden|\/login/)
      await expect.soft(menuDelArea(page).locator('[aria-current="page"]'), `${href}: un solo ítem activo`).toHaveCount(1)
      await expect.soft(itemDelMenu(page, href), `${href}: su ítem debe estar activo`).toHaveAttribute("aria-current", "page")
    }
  })

  test("las URL de antes del rediseño llegan a su pantalla nueva y dejan activo a su ítem, no al vecino", async ({ page }) => {
    /**
     * `[ruta de antes, href del ítem que debe quedar activo]`. Ya no hay alias en
     * el manifiesto: la ruta vieja es una página puente permanente y el ítem
     * activo es el de la pantalla a la que redirige. `/combustibles/consumo/…`
     * y `/combustibles/cargas/registrar` prueban además que el prefijo más
     * específico gana frente a `/combustibles` (el Panel).
     */
    const rutas: ReadonlyArray<readonly [string, string]> = [
      ["/combustibles/control/revision", "/combustibles/revisar"],
      ["/combustibles/anomalias", "/combustibles/revisar"],
      ["/combustibles/revision", "/combustibles/revisar"],
      ["/combustibles/bitacora", "/combustibles/cargas"],
      ["/combustibles/tae", "/combustibles/cargas"],
      ["/combustibles/control/registrar", "/combustibles/cargas"],
      ["/combustibles/control/sellos", "/combustibles/cuadratura"],
      ["/combustibles/sellos", "/combustibles/cuadratura"],
      ["/combustibles/tae/conciliacion", "/combustibles/cuadratura"],
      ["/combustibles/ciclo", "/combustibles/cuadratura"],
      ["/combustibles/control", "/combustibles/consumo"],
      ["/combustibles/control/rendimiento/camiones", "/combustibles/consumo"],
      ["/combustibles/control/ralenti", "/combustibles/consumo"],
      ["/combustibles/cuenta-corriente", "/combustibles/pagos"],
      ["/combustibles/facturas", "/combustibles/pagos"],
      ["/combustibles/nueva", "/combustibles/pagos"],
      ["/combustibles/importar", "/combustibles/fuentes"],
      ["/combustibles/control/importar", "/combustibles/fuentes"],
      ["/combustibles/tae/importar", "/combustibles/fuentes"],
      ["/combustibles/control/configuracion", "/combustibles/ajustes"],
      ["/combustibles/anomalias/reglas", "/combustibles/ajustes"],
    ]

    for (const [ruta, activo] of rutas) {
      await page.goto(ruta)
      // `/combustibles/control/importar` llega a Fuentes con el diálogo de
      // telemetría abierto. El modal vuelve inerte el resto de la página, así
      // que el sidebar no es visible para el árbol de accesibilidad hasta
      // cerrarlo. La ruta legacy sí llegó a su destino; se comprueba abajo.
      if (ruta === "/combustibles/control/importar") {
        const dialog = page.getByRole("dialog")
        await expect(dialog).toBeVisible()
        await dialog.getByRole("button", { name: "Cerrar", exact: true }).click()
        await expect(dialog).toBeHidden()
      }
      await expect.soft(page, `${ruta} no debe mandar a /forbidden`).not.toHaveURL(/\/forbidden|\/login/)
      await expect.soft(menuDelArea(page).locator('[aria-current="page"]'), `${ruta}: un solo ítem activo`).toHaveCount(1)
      await expect.soft(itemDelMenu(page, activo), `${ruta}: debe dejar activo a ${activo}`).toHaveAttribute("aria-current", "page")
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Pestañas de sección
// ─────────────────────────────────────────────────────────────────────────────

/** Qué pestaña marca cada pantalla en la barra de su sección (rótulos de `lib/combustibles/section-nav.ts`). */
const PESTANAS_POR_SECCION = [
  {
    seccion: "Cargas",
    barra: BARRAS.cargas,
    pantallas: [
      { ruta: "/combustibles/cargas", activa: "Cargas a equipos" },
      { ruta: "/combustibles/cargas/tarjetas", activa: "Tarjetas" },
    ],
  },
  {
    seccion: "Por revisar",
    barra: BARRAS.revisar,
    pantallas: [
      { ruta: "/combustibles/revisar", activa: "Por decidir" },
      { ruta: "/combustibles/revisar?tipo=caso", activa: "En seguimiento" },
      { ruta: "/combustibles/revisar?vista=decididas", activa: "Decididas" },
    ],
  },
  {
    seccion: "Cuadratura",
    barra: BARRAS.cuadratura,
    pantallas: [
      { ruta: "/combustibles/cuadratura/mandante", activa: "Por mandante" },
      { ruta: "/combustibles/cuadratura/estanques", activa: "Estanques" },
      { ruta: "/combustibles/cuadratura/proveedor", activa: "Facturado y terreno" },
      { ruta: "/combustibles/cuadratura/tarjeta-y-terreno", activa: "Tarjeta y terreno" },
      { ruta: "/combustibles/cuadratura/sellos", activa: "Sellos" },
    ],
  },
  {
    seccion: "Consumo",
    barra: BARRAS.consumo,
    pantallas: [
      { ruta: "/combustibles/consumo/rendimiento/camiones", activa: "Rendimiento" },
      { ruta: "/combustibles/consumo/litros", activa: "Litros" },
      { ruta: "/combustibles/consumo/motor-en-vacio", activa: "Motor en vacío" },
    ],
  },
  {
    seccion: "Pagos",
    barra: BARRAS.pagos,
    pantallas: [
      { ruta: "/combustibles/pagos", activa: "Facturas" },
      { ruta: "/combustibles/pagos/estados", activa: "Estados de cuenta" },
    ],
  },
] as const

test.describe("Control operacional — pestañas de sección", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  for (const { seccion, barra, pantallas } of PESTANAS_POR_SECCION) {
    test(`${seccion}: cada pantalla marca su pestaña y sólo la suya`, async ({ page }) => {
      for (const { ruta, activa } of pantallas) {
        await page.goto(ruta)
        const marcadas = barraDe(page, barra).locator('[aria-current="page"]')
        await expect.soft(marcadas, `${ruta}: una sola pestaña activa en «${barra}»`).toHaveCount(1)
        await expect.soft(marcadas, `${ruta}: la pestaña activa debe ser «${activa}»`).toHaveText(empiezaCon(activa))
      }
    })
  }

  test("«Motor en vacío» es la pestaña activa y «Litros» conserva la faena y el período de la URL", async ({ page }) => {
    // `periodo` y `faena` son el contexto que `FUEL_CARRY_PARAMS` arrastra entre
    // las pestañas: cambiar de vista no obliga a volver a filtrar.
    await page.goto("/combustibles/consumo/motor-en-vacio?faena=ws-e2e&periodo=2025-03")

    const barra = barraDe(page, BARRAS.consumo)
    await expect(barra.locator('[aria-current="page"]')).toHaveText(empiezaCon("Motor en vacío"))

    await barra.getByRole("link", { name: "Litros", exact: true }).click()
    await expect(page).toHaveURL((url) => url.pathname === "/combustibles/consumo/litros")

    const url = new URL(page.url())
    expect(url.searchParams.get("faena")).toBe("ws-e2e")
    expect(url.searchParams.get("periodo")).toBe("2025-03")
    await expect(barra.locator('[aria-current="page"]')).toHaveText("Litros")
  })

  test("sin faena en la URL, cambiar de pestaña no inventa filtros", async ({ page }) => {
    await page.goto("/combustibles/consumo/motor-en-vacio")
    await barraDe(page, BARRAS.consumo).getByRole("link", { name: "Litros", exact: true }).click()
    await expect(page).toHaveURL((url) => url.pathname === "/combustibles/consumo/litros")
    // El período sí puede aparecer (la pantalla lo recupera de la cookie y lo escribe para que el enlace sea compartible); la faena no.
    expect(new URL(page.url()).searchParams.has("faena")).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Agregar datos
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Control operacional — «Agregar datos»", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  /**
   * Las opciones que el administrador del seed tiene que ver, por href (el contrato)
   * y por inicio de rótulo (`fuelAddDataOptions`, `lib/combustibles/section-nav.ts`).
   * Las que no tienen pantalla propia abren su diálogo sobre «Fuentes de datos».
   */
  const OPCIONES_PARA_AGREGAR = [
    { href: "/combustibles/fuentes/agregar/planilla", nombre: "Tengo una planilla de cargas" },
    { href: "/combustibles/fuentes/agregar/tarjeta", nombre: "Tengo un reporte de tarjeta" },
    { href: "/combustibles/fuentes?agregar=facturas", nombre: "Tengo facturas en Excel" },
    { href: "/combustibles/fuentes?agregar=telemetria", nombre: "Tengo telemetría de equipos" },
    { href: "/combustibles/fuentes?agregar=surtidor", nombre: "Tengo despachos de un surtidor" },
    { href: "/combustibles/fuentes/agregar/sellos", nombre: "Tengo el histórico de sellos" },
    { href: "/combustibles/cargas/registrar", nombre: "Quiero registrar una carga a mano" },
  ] as const

  test("Cargas ofrece las fuentes de datos y «Tengo una planilla de cargas» abre ese importador", async ({ page }) => {
    await page.goto("/combustibles/cargas")

    const dialogo = await abrirSelectorAgregarDatos(page)
    for (const { href, nombre } of OPCIONES_PARA_AGREGAR) {
      const opcion = dialogo.locator(`a[href="${href}"]`)
      await expect.soft(opcion, `opción ${href}`).toHaveCount(1)
      await expect.soft(opcion, `opción ${href}`).toContainText(empiezaCon(nombre))
    }

    await dialogo.locator('a[href="/combustibles/fuentes/agregar/planilla"]').click()
    await expect(page).toHaveURL(/\/combustibles\/fuentes\/agregar\/planilla$/)
    await expectPageTitle(page, "Agregar planilla de cargas")

    // El importador cuelga de «Fuentes de datos» en el menú.
    await expect(itemDelMenu(page, "/combustibles/fuentes")).toHaveAttribute("aria-current", "page")
  })

  test("una opción sin pantalla propia abre su diálogo sobre «Fuentes de datos» y cerrarlo quita el parámetro", async ({ page }) => {
    await page.goto("/combustibles/cargas")
    const dialogo = await abrirSelectorAgregarDatos(page)
    await dialogo.locator('a[href="/combustibles/fuentes?agregar=telemetria"]').click()
    await expect(page).toHaveURL(/\/combustibles\/fuentes\?agregar=telemetria$/)

    const importador = page.getByRole("dialog", { name: "Importar telemetría diaria" })
    await expect(importador).toBeVisible({ timeout: 20_000 })
    await importador.getByRole("button", { name: "Cancelar" }).click()
    await expect(importador).toBeHidden()
    // Recargar o volver atrás no debe reabrirlo.
    await expect(page).toHaveURL((url) => url.pathname === "/combustibles/fuentes" && !url.searchParams.has("agregar"))
  })

  test("el mismo selector está en las otras pantallas de combustible que lo ofrecen", async ({ page }) => {
    // Un solo botón «Agregar datos» en toda el área: ni más botones sueltos ni
    // pantallas que lo pierdan. Se miran las cinco que lo montan hoy.
    for (const ruta of ["/combustibles", "/combustibles/cargas", "/combustibles/pagos", "/combustibles/fuentes", "/combustibles/fuentes/archivos"]) {
      await page.goto(ruta)
      await expect.soft(page.getByRole("button", { name: "Agregar datos", exact: true }), `${ruta}: botón «Agregar datos»`).toHaveCount(1)
    }
  })
})

async function abrirSelectorAgregarDatos(page: Page): Promise<Locator> {
  const abrir = page.getByRole("button", { name: "Agregar datos", exact: true })
  const dialogo = page.getByRole("dialog", { name: "¿Qué tienes en la mano?" })
  // Reintento: un clic anterior a la hidratación no dispara el manejador y
  // Playwright no reintenta un clic ya entregado (misma falla recurrente que
  // documenta `combustibles.spec.ts`). Sólo se vuelve a pulsar si el diálogo
  // no está abierto, para no chocar con el overlay.
  await expect(async () => {
    if (!(await dialogo.isVisible())) await abrir.click({ timeout: 5_000 })
    await expect(dialogo).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
  return dialogo
}

// ─────────────────────────────────────────────────────────────────────────────
// Por revisar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * «Por revisar» es una sola bandeja con tres pestañas: «Por decidir» (cargas,
 * patentes y pedidos: la cifra del tile y del menú), «En seguimiento» (los
 * casos abiertos) y «Decididas». Verifica que la pantalla tenga su pestaña
 * activa y devuelve a dónde se llegó.
 */
async function expectPorRevisar(page: Page, vista: "Por decidir" | "En seguimiento" | "Decididas" = "Por decidir") {
  await expect(page).toHaveURL((url) => url.pathname === "/combustibles/revisar")
  const activa = barraDe(page, BARRAS.revisar).locator('[aria-current="page"]')
  await expect(activa).toHaveCount(1)
  await expect(activa).toHaveText(empiezaCon(vista))
  return new URL(page.url())
}

test.describe("Control operacional — Por revisar", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("/combustibles/revision llega a la bandeja y su pestaña queda activa", async ({ page }) => {
    await page.goto("/combustibles/revision")
    await expectPorRevisar(page)
    await expect(itemDelMenu(page, "/combustibles/revisar")).toHaveAttribute("aria-current", "page")
  })

  test("la entrada conserva la faena y la otra vista la arrastra", async ({ page }) => {
    await page.goto("/combustibles/revision?faena=ws-e2e")
    const destino = await expectPorRevisar(page)
    expect(destino.searchParams.get("faena")).toBe("ws-e2e")

    // `carryParams={FUEL_CARRY_PARAMS}`: las pestañas vecinas conservan la faena.
    const vecinas = barraDe(page, BARRAS.revisar).locator('a:not([aria-current="page"])')
    await expect(vecinas).toHaveCount(2)
    for (const i of [0, 1]) await expect(vecinas.nth(i)).toHaveAttribute("href", /faena=ws-e2e/)
  })

  test("«En seguimiento» trae los casos abiertos y nada más", async ({ page }) => {
    await page.goto("/combustibles/revisar")
    await barraDe(page, BARRAS.revisar).getByRole("link", { name: /^En seguimiento/ }).click()
    const destino = await expectPorRevisar(page, "En seguimiento")
    expect(destino.searchParams.get("tipo")).toBe("caso")
    // Un solo tipo: sin el control «Tipo de pendiente» de «Por decidir».
    await expect(page.getByRole("group", { name: "Tipo de pendiente" })).toHaveCount(0)
  })

  test("«Decididas» es la otra vista y trae su pestaña activa", async ({ page }) => {
    await page.goto("/combustibles/revisar")
    await barraDe(page, BARRAS.revisar).getByRole("link", { name: "Decididas", exact: true }).click()
    const destino = await expectPorRevisar(page, "Decididas")
    expect(destino.searchParams.get("vista")).toBe("decididas")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Rutas retiradas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `e2e/combustibles.spec.ts` («retired fuel report and analysis routes
 * redirect…») ya cubre el camino feliz: `/combustibles/reportes?desde&hasta`
 * llega a `/combustibles/consumo/litros?seccion=tarjetas` con `desde` y la
 * pestaña «Consumo» activa, y `/combustibles/analisis` llega a
 * `/combustibles/consumo/rendimiento/camiones`. Aquí NO se repite: se cubre lo
 * que esa prueba no toca —la traducción de `preset` a familia, el arrastre de
 * faena y fechas, y que un parámetro inválido no rompa la pantalla de destino—.
 */
test.describe("Control operacional — rutas retiradas", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("/combustibles/analisis traduce el preset a su familia y conserva faena y fechas", async ({ page }) => {
    await page.goto("/combustibles/analisis?preset=loaders_pickups&faena=ws-e2e&desde=2026-07-01&hasta=2026-07-31")
    await expect(page).toHaveURL((url) => url.pathname === "/combustibles/consumo/rendimiento/cargadores-camionetas")

    const url = new URL(page.url())
    expect(url.searchParams.get("faena")).toBe("ws-e2e")
    expect(url.searchParams.get("desde")).toBe("2026-07-01")
    expect(url.searchParams.get("hasta")).toBe("2026-07-31")

    await expect(barraDe(page, BARRAS.consumo).locator('[aria-current="page"]')).toHaveText("Rendimiento")
    await expect(itemDelMenu(page, "/combustibles/consumo")).toHaveAttribute("aria-current", "page")
  })

  test("/combustibles/analisis con un preset desconocido cae en la primera familia", async ({ page }) => {
    await page.goto("/combustibles/analisis?preset=inventado")
    await expect(page).toHaveURL((url) => url.pathname === "/combustibles/consumo/rendimiento/camiones")
  })

  test("/combustibles/reportes con una fecha inválida no rompe la pantalla de destino y conserva la válida", async ({ page }) => {
    await page.goto("/combustibles/reportes?desde=basura&hasta=2026-07-31")
    // La puente descarta la fecha inválida y conserva la válida (`legacyFuelRedirect`).
    await expect(page).toHaveURL((url) => url.pathname === "/combustibles/consumo/litros" && url.searchParams.get("seccion") === "tarjetas")
    const url = new URL(page.url())
    expect(url.searchParams.get("hasta")).toBe("2026-07-31")
    expect(url.searchParams.get("desde")).not.toBe("basura")
    await expectPageTitle(page, "Litros cargados")
    await expect(barraDe(page, BARRAS.consumo).locator('[aria-current="page"]')).toHaveText("Litros")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Panel operacional: de cada tile a su subconjunto
// ─────────────────────────────────────────────────────────────────────────────

/** Destino de cada tile (`ATTENTION_HREFS` de `control-operacional/attention-tiles.ts`). */
const TILE = {
  detenidos: "/flota?estado=detenidos",
  ordenesAbiertas: "/mantencion/ot?estado=abiertas",
  combustiblePorRevisar: "/combustibles/revisar",
} as const

/**
 * El tile de documentos enlaza a lo que cuenta (85200b665): «vencidos» si hay
 * alguno, si no «por vencer», si no «al día». La base E2E no siembra documentos
 * vencidos, así que el destino depende de los datos y se lee del propio tile.
 */
const DOCUMENTOS_DESTINOS = {
  "/flota?vencimiento=vencidos": "Documentos vencidos",
  "/flota?vencimiento=proximos": "Próximos a vencer",
  "/flota?vencimiento=al-dia": "Al día",
} as const

/** El tile se localiza por su destino —`KpiCard` envuelve la tarjeta en el enlace— y no por su rótulo. */
function tileHacia(page: Page, href: string): Locator {
  return page.locator(`a[href="${href}"]:has([data-kpi-card])`)
}

function tileDeDocumentos(page: Page): Locator {
  return page.locator(`a[href^="/flota?vencimiento="]:has([data-kpi-card])`)
}

test.describe("Control operacional — tiles del panel", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto("/control-operacional")
  })

  test("cada tile visible enlaza a su subconjunto y no hay más de cuatro", async ({ page }) => {
    // El administrador del seed tiene flota, combustible y las vistas de OT (`mant:ot:view_*`), así que están los cuatro.
    for (const [nombre, href] of Object.entries(TILE)) {
      await expect.soft(tileHacia(page, href), `tile ${nombre}`).toHaveCount(1)
    }
    await expect.soft(tileDeDocumentos(page), "tile documentos").toHaveCount(1)
    expect(Object.keys(DOCUMENTOS_DESTINOS)).toContain(await tileDeDocumentos(page).getAttribute("href"))
    expect(await page.locator("[data-kpi-card]").count()).toBeLessThanOrEqual(4)
  })

  test("la tabla de activos lleva las compras de repuestos y servicios, sin mano de obra de OT", async ({ page }) => {
    // Las OC vinculadas al equipo tienen su propia columna (plan 2026-11-07) y la OT
    // ya no lleva costo (decisión 2026-11-17). Desde la mejora UI/UX 2026-11-13 la
    // tabla abre con seis columnas: las de costo se piden por la URL de la vista,
    // que es lo que guarda el menú «Columnas». Una vista guardada con la columna
    // retirada (`maintenanceCost`) no debe romper la tabla.
    await page.goto(`/control-operacional?control-operacional-activos_cols=${["code", "maintenanceCost", "purchaseAmount"].join(",")}`)
    const table = page.getByRole("table", { name: "Activos operacionales" })
    await expect(table).toBeVisible()
    const header = (label: string) =>
      table.getByRole("columnheader", { name: new RegExp(`^(?:Ordenar por )?${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) })
    await expect(header("Repuestos y servicios (OC)")).toBeVisible()
    await expect(header("Mano de obra / taller (OT)")).toHaveCount(0)
    await expect(header("Costo mantención")).toHaveCount(0)
  })

  test("«Equipos detenidos» abre Vehículos con el estado «detenidos» ya aplicado", async ({ page }) => {
    await tileHacia(page, TILE.detenidos).click()
    await expect(page).toHaveURL(/\/flota\?estado=detenidos$/)

    // El filtro activo se anuncia de dos maneras y se puede quitar: chip + selector.
    await expect(page.getByRole("button", { name: "Eliminar filtro Estado", exact: true })).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Estado operacional", exact: true })).toContainText("Detenidos")
  })

  test("«Documentos vencidos» abre Vehículos con el vencimiento que cuenta ya aplicado", async ({ page }) => {
    const tile = tileDeDocumentos(page)
    const href = (await tile.getAttribute("href")) as keyof typeof DOCUMENTOS_DESTINOS
    expect(Object.keys(DOCUMENTOS_DESTINOS)).toContain(href)
    await tile.click()
    await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === href)

    await expect(page.getByRole("button", { name: "Eliminar filtro Vencimiento", exact: true })).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Vencimiento documental", exact: true })).toContainText(DOCUMENTOS_DESTINOS[href])
  })

  test("«Combustible por revisar» abre «Por revisar» en sus pendientes", async ({ page }) => {
    await tileHacia(page, TILE.combustiblePorRevisar).click()
    await expectPorRevisar(page)
  })

  test("«Combustible por revisar», la pestaña «Por decidir» y el contador del menú dicen la misma cifra", async ({ page }) => {
    // Un pedido de revisión abierto: el tile anterior (sólo cargas marcadas y casos) no lo veía y quedaba por debajo.
    const pedidoId = "qa-e2e-tile-pedido"
    await withSql(async (sql) => {
      await sql`delete from fuel_review_marks where id = ${pedidoId}`
      await sql`
        insert into fuel_review_marks (id, entity_type, entity_id, marked_by, notes, worksite_id, status)
        values (${pedidoId}, 'fuel_tae_submission', 'qa-e2e-tile-sin-registro', 'user-admin-e2e', 'QA_E2E pedido para el tile', ${WORKSITE_ID}, 'open')
      `
    })
    try {
      await page.goto("/control-operacional")
      const tile = tileHacia(page, TILE.combustiblePorRevisar)
      await expect(tile).toContainText("Combustible por revisar")
      await expect(tile.locator("span.line-clamp-2")).toContainText(/\d+ pedidos? de revisión/)
      const total = Number((await tile.locator("p.font-mono").innerText()).replace(/\./g, ""))
      expect(total).toBeGreaterThanOrEqual(1)

      await tile.click()
      await expectPorRevisar(page)
      // Una sola definición en toda el área (crítica 2026-11-15): lo que se decide ahora, sin los casos en
      // seguimiento. Antes la pestaña sumaba los casos (418) mientras el tile decía 88.
      const porDecidir = Number((await barraDe(page, BARRAS.revisar).getByRole("link", { name: /^Por decidir/ }).innerText()).replace(/\D/g, ""))
      expect(porDecidir).toBe(total)
      // El contador del menú se guarda 30 s por usuario (`badgeCountsLoader` en app/(app)/layout.tsx) y el pedido
      // entró por SQL, sin invalidar ese caché: se recarga hasta que vence, en vez de leerlo de inmediato.
      await expect.poll(async () => {
        await page.reload()
        return (await itemDelMenu(page, "/combustibles/revisar").innerText()).replace(/\D/g, "")
      }, { timeout: 75_000, intervals: [2_000, 10_000] }).toBe(total > 99 ? "99" : String(total))
    } finally {
      await withSql(async (sql) => { await sql`delete from fuel_review_marks where id = ${pedidoId}` })
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Roles acotados
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lo que el seed deja probar sin inventar datos:
 *
 *   - `scoped@e2e.chome.cl` (`solicitante_faena`, `e2e/setup-db.ts:301-315` y `:356-368`): no
 *     tiene `flota:*`, `mant:records:view_worksite`, `combustibles:*` ni
 *     `prevention:inspections:view`, así que el área entera desaparece del menú
 *     y ninguna de sus rutas debe abrirse a mano.
 *   - `jefe.faena@e2e.chome.cl` (`jefe_terreno`, `e2e/setup-db.ts:105-143`): sólo
 *     `prevention:inspections:view`, uno de los tres permisos que abren el
 *     panel (`OPERATIONAL_CONTROL_VIEW_PERMISSIONS`). Ve el panel y nada más.
 *
 *   - `combustible.sincostos@e2e.chome.cl` (`combustible_sin_costos`, en
 *     `e2e/setup-db.ts`): `combustibles:view` + `create` sin `view_costs`, como
 *     `jefe_mantencion`. Ve el grupo Combustible salvo Pagos (costos), Fuentes de
 *     datos (importar) y Ajustes (administrar), y esas pantallas rechazan la ruta
 *     escrita a mano.
 */
const RUTAS_DEL_AREA = [
  "/control-operacional",
  "/flota",
  "/flota/conductores",
  "/flota/monitoreo",
  "/flota/indicadores",
  "/mantencion/panel",
  "/combustibles",
  "/combustibles/cargas",
  "/combustibles/cargas/registrar",
  "/combustibles/revisar",
  "/combustibles/cuadratura",
  "/combustibles/cuadratura/mandante",
  "/combustibles/cuadratura/estanques",
  "/combustibles/consumo",
  "/combustibles/consumo/litros",
  "/combustibles/pagos",
  "/combustibles/pagos/estados",
  "/combustibles/fuentes",
  "/combustibles/ajustes",
  "/combustibles/ajustes/mandantes",
] as const

test.describe("Control operacional — roles acotados", () => {
  test("un rol sin permisos de flota ni combustible no ve el área y sus rutas lo rechazan", async ({ page }) => {
    await login(page, "scoped@e2e.chome.cl", "scoped2026")

    const sidebar = page.getByRole("navigation", { name: "Navegación", exact: true })
    // Ancla para que la ausencia no sea vacía: el sidebar cargó y ofrece lo que
    // este rol sí puede abrir («Mis pendientes» es un enlace fijo, igual que en
    // `navegacion-por-rol.spec.ts`).
    await expect(sidebar.getByRole("link", { name: /Mis pendientes/ })).toBeVisible()
    await expect(sidebar.getByRole("button", { name: "Control operacional", exact: true })).toHaveCount(0)
    await expect(sidebar.getByRole("link", { name: "Panel operacional" })).toHaveCount(0)

    // Ocultar el ítem no es autorizar: la ruta escrita a mano también se rechaza.
    for (const ruta of RUTAS_DEL_AREA) {
      await page.goto(ruta)
      await expect.soft(page, `${ruta} debe mandar a /forbidden`).toHaveURL(/\/forbidden/)
    }
  })

  test("combustible sin costos ve su grupo sin Pagos, Fuentes ni Ajustes y no abre pantallas con montos", async ({ page }) => {
    await login(page, "combustible.sincostos@e2e.chome.cl", "chome2026")

    await page.goto("/combustibles/cargas")
    await expect(page).toHaveURL(/\/combustibles\/cargas$/)
    // El panel también es visible porque `combustibles:view` es uno de sus tres permisos de entrada. Está en el grupo
    // Seguimiento, plegado mientras la pantalla actual es de Combustible: se abre antes de mirar.
    const menu = menuDelArea(page)
    await abrirGrupos(page)
    for (const href of ["/control-operacional", "/combustibles", "/combustibles/cargas", "/combustibles/revisar", "/combustibles/cuadratura", "/combustibles/consumo"]) {
      await expect(menu.locator(`a[href="${href}"]`)).toBeVisible()
    }
    // Pagos (`view_costs`), Fuentes (importar/sincronizar) y Ajustes (administrar): ninguno está.
    for (const href of ["/combustibles/pagos", "/combustibles/fuentes", "/combustibles/ajustes"]) {
      await expect(menu.locator(`a[href="${href}"]`)).toHaveCount(0)
    }

    // Ocultar el ítem no es autorizar: las pantallas con montos, de importación o de ajustes rechazan la ruta escrita a mano.
    for (const ruta of ["/combustibles/pagos", "/combustibles/pagos/estados", "/combustibles/pagos/nueva", "/combustibles/fuentes", "/combustibles/ajustes", "/combustibles/ajustes/mandantes", "/combustibles/cuadratura/mandante"]) {
      await page.goto(ruta)
      await expect.soft(page, `${ruta} debe mandar a /forbidden`).toHaveURL(/\/forbidden/)
    }
    // Lo que sí ofrece el menú abre; «Cuadratura» abre su primera vista sin permiso TAE: Estanques.
    for (const ruta of ["/control-operacional", "/combustibles", "/combustibles/consumo/motor-en-vacio", "/combustibles/revisar", "/combustibles/cuadratura/estanques"]) {
      await page.goto(ruta)
      await expect.soft(page, `${ruta} debe abrir`).not.toHaveURL(/\/forbidden/)
    }
    await page.goto("/combustibles/cuadratura")
    await expect.soft(page, "«Cuadratura» abre Estanques").toHaveURL((url) => url.pathname === "/combustibles/cuadratura/estanques")

    // El panel abre, pero sólo con las columnas de combustible: sin flota,
    // inspecciones ni costos de otros dominios.
    await page.goto(`/control-operacional?control-operacional-activos_cols=${["code", "fuelLiters", "inspectionCount", "fuelBilledAmount"].join(",")}`)
    await expect(page).toHaveURL((url) => url.pathname === "/control-operacional")
    await expectPageTitle(page, "Panel operacional")
    const table = page.getByRole("table", { name: "Activos operacionales" })
    await expect(table).toBeVisible()
    // Las columnas ordenables se anuncian como «Ordenar por …».
    const header = (label: string) =>
      table.getByRole("columnheader", { name: new RegExp(`^(?:Ordenar por )?${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) })
    await expect(header("Litros")).toBeVisible()
    await expect(header("Inspecciones")).toHaveCount(0)
    await expect(header("Costo aprobado")).toHaveCount(0)
  })

  test("quien sólo tiene inspecciones ve el panel y ningún otro destino del área", async ({ page }) => {
    await login(page, "jefe.faena@e2e.chome.cl", "chome2026")

    await page.goto("/control-operacional")
    await expect(page).toHaveURL(/\/control-operacional$/)
    await expectPageTitle(page, "Panel operacional")

    // El menú del área ofrece sólo el panel: ni Vehículos, ni Mantención, ni nada de Combustible.
    const menu = menuDelArea(page)
    await expect(menu.getByRole("link")).toHaveCount(1)
    await expect(itemDelMenu(page, "/control-operacional")).toHaveAttribute("aria-current", "page")

    // Sin dominios a su alcance no hay «Requiere atención ahora» ni tiles: una fila vacía sería ruido.
    await expect(page.getByRole("heading", { name: "Requiere atención ahora" })).toHaveCount(0)
    await expect(page.locator("[data-kpi-card]")).toHaveCount(0)

    // Lo que el menú no ofrece, la ruta lo rechaza.
    for (const ruta of RUTAS_DEL_AREA.filter((destino) => destino !== "/control-operacional")) {
      await page.goto(ruta)
      await expect.soft(page, `${ruta} debe mandar a /forbidden`).toHaveURL(/\/forbidden/)
    }
  })
})
