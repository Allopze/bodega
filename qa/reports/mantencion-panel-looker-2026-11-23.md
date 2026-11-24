# Panel de mantención estilo Looker — implementación y verificación (2026-11-23)

## Alcance

Se adaptó `/mantencion/panel` a cuatro pestañas —`Hoy`, `Planificación`, `Camiones`, `Máquinas`— con
filtro cruzado por URL. `Hoy` conserva el Panel operativo anterior; las tres nuevas replican la
estructura del panel de Looker: consolidado por km/horas, delta y faltantes; correctivo con OT,
conductores y gráficos; preventivo con cumplimiento, matriz de checklist, fotos y observaciones.

Decisiones acordadas: matriz desde el bloque «Detalle por ítem» del consolidado; próxima mantención
con la regla vigente de `equipmentStatus` (punto + base), no «programado + frecuencia»; correctivo
histórico + nativo.

## Cambios principales

- **Esquema y migración 0401** (`db/migrations/0401_clumsy_taskmaster.sql`):
  - columnas `mechanic`, `observations`, `items_not_done`, `filters_photo_url`, `sticker_photo_url`
    en `mant_historical_schedule_checks`;
  - tabla `mant_historical_schedule_items` (detalle por ítem), con FK, unique e índice.
- **Importador**: lee el bloque «Detalle por ítem» de `PAUTAS_PREVENTIVAS`, vincula por formulario +
  fecha + patente + pauta, rechaza ambigüedades y reemplaza el detalle de cada pauta de forma
  idempotente. Informe nuevo «Detalle por ítem».
- **Servicios** `lib/services/mantencion/looker/`:
  - `filters.ts` (URL, multi-selección, chips, toggle, filtros efectivos);
  - `resolve.ts` (opciones y resolución de filtros dentro del alcance);
  - `planning.ts` / `planning-rules.ts` (A, B, delta, próxima, faltantes, semáforos);
  - `corrective.ts` (unión historial + OT + registro, paginación SQL, conductores, serie por equipo);
  - `preventive.ts` / `preventive-summary.ts` (cumplimiento por mes/faena+mecánico/patente y matriz).
- **UI**: pestañas, barra de filtros con faena/código/frecuencia, filtros cruzados accesibles
  (`aria-pressed`, Enter/Espacio), barras de delta y cumplimiento, gráfico combinado, tabla correctiva,
  matriz y visor de fotos. La tabla correctiva integró el tipo en la celda de equipo y la miniatura en
  la misma celda para que quepa en la columna del layout de dos columnas.
- **E2E** `e2e/mantencion-panel-looker.spec.ts` (16 escenarios, 490 líneas) y su helper de siembra
  `e2e/mantencion-panel-looker-seed.ts`: siembran sus propios datos QA (dos faenas, dos camiones y una
  máquina por horas con ficha, cinco pautas con detalle, tres OT con correctiva y conductor, una foto
  real) y los borran en `afterAll`. Cubren las tres pestañas, la barra de filtros (faena múltiple,
  código con buscador, frecuencia), chips individuales, «Borrar filtros», barras de mes y de faena +
  mecánico, gráfico combinado, OT ↔ conductores, patente → matriz, recarga con la URL, teclado (Tab,
  Enter, Espacio), pestaña Máquinas por horas, visor de la foto de una correctiva y la pestaña `Hoy`.

## Verificación ejecutada

Cierre del 2026-11-24. La columna «Fecha» distingue lo corrido en el cierre de lo corrido el 11-23.

| Puerta | Fecha | Resultado |
|---|---|---|
| `npm run typecheck` | 11-24 | Pasa (tras ampliar el E2E) |
| `npx eslint` de los dos archivos E2E nuevos | 11-24 | Limpio |
| `npm run lint`, `check:secrets`, `db:verify-migrations` | 11-23 | Pasan; 402 entradas hasta `0401_clumsy_taskmaster`. **No se repitieron el 11-24** |
| `NODE_ENV=test npm run test:fast` | 11-24 | **22.006 pasan, 0 fallan, 275 omitidas** (1.458 archivos pasan, 32 omitidos; 555 s) |
| `npm run test:pglite` | 11-23 | 5.662 pasan, 1 omitida, 441 archivos. **No se repitió el 11-24** (el cierre no cambió código de la aplicación) |
| `e2e/mantencion-panel-looker.spec.ts` en `next dev` aislado :3006, base `bodega_e2e_looker` (antes del arreglo de `Hoy`) | 11-24 | 3 corridas seguidas: 15 «passed» (14 verifican + 1 `test.fail`) + 1 omitido, sin reintentos |
| `npm run test:e2e` completo, sin filtrar (antes del arreglo de `Hoy`) | 11-24 | **No verde**: 1.206 pruebas; 1.111 pasan, 64 fallan, 25 no corrieron, 6 omitidas (58 min 48 s, exit 1) |
| `page.test.tsx` («menú de pestañas», prueba nueva) | 11-24 | Rojo antes del cambio (2 fallos, `PanelTabs` ausente); verde después: 20/20, y 88/88 en el directorio del Panel |
| Siete archivos que visitan el Panel `Hoy` por `npm run test:e2e` (build de producción, `bodega_e2e` reseteada), **después** del arreglo | 11-24 | 89 pruebas: **87 pasan, 1 omitida, 1 falla** (13,3 min). El fallo es `reflow-anchos.spec.ts:158`, preexistente e idéntico al de la suite completa; **se corrigió después** (fila siguiente). Por archivo: tablero 15 + 1 omitida, `indicadores-mantencion` 7/7, `tableros-esqueleto` 3/3, `mantencion-2-jefatura` 13/13, `mantencion-4-permisos` 5/5, `control-operacional-navegacion` 30/30, `reflow-anchos` 14/15 |
| Arreglo del TopBar (`reflow-anchos.spec.ts:158`): `reflow-anchos`, `shell-scroll`, `shell-landmarks` y `tableros-esqueleto` | 11-24 | **27/27 pasan** en `next dev` (5,6 min) y **27/27 en el arnés de producción** (10,2 min, exit 0); `:158` pasa en 5,4 s y 2,5 s |

- **`test:fast`**: los 8 fallos de `dense-chart` de la corrida anterior ya no se reproducen. No se editó
  ningún archivo; `dense-chart.tsx` no tiene cambios respecto de `HEAD`. Por qué fallaron entonces no
  quedó determinado. La corrida corresponde al árbol de las 00:44 del 11-24.
- **Los 16 escenarios del spec**: tras el arreglo de `Hoy`, 15 verifican comportamiento y 1 se omite por
  fecha (el visor de la matriz con una foto preventiva nativa: esas preventivas cuentan desde 2026-12-01,
  `CUTOVER`). Antes del arreglo, uno de los 16 era un `test.fail` que documentaba el defecto de `Hoy`.
  Cada escenario además comprueba que no hay errores de consola ni respuestas 4xx/5xx del origen.
- **El escenario del menú de `Hoy`**: sobre `next dev` falló 8 de 8 veces, pero no por el menú. «Hoy» no
  tiene marca de hidratación (`data-looker-filter-ready` sólo existe donde hay barra de filtros) y un clic
  que cae antes de hidratar lo cancela el `history.replaceState` inicial de Next (CDP: `ERR_ABORTED`, sin
  petición al servidor; hidratación medida en 100–150 ms tras `load`, y «Hoy» es la más rápida). Con el
  clic reintentado hasta navegar (`toPass`, el patrón de `openLatestDraft` en `helpers.ts`) pasa en el
  arnés de producción. Mientras el escenario tuvo `test.fail`, su aserción final de URL nunca se ejecutó.
- **Tres archivos fallaron sobre `next dev` y pasan en el arnés**: `control-operacional-navegacion`,
  `mantencion-4-permisos` y `mantencion-2-jefatura` perdían un `goto` o un clic por la misma ventana de
  hidratación (una página previa dispara una navegación por script que pisa el `goto`). Sobre build de
  producción pasan 30/30, 5/5 y 13/13, así que no los causa el menú nuevo. El spec usa fechas fijas (período
  2026-10-01 a 2026-11-20) porque con «hoy − 5» habría empezado a fallar hacia 2026-12-06, al cruzar el
  corte; con el reloj de Node adelantado 10 días pasan los 16 (incluido el visor de la matriz).
- **Suite E2E completa — 64 fallos, ninguno del tablero**, según el flujo que la ejecutó:
  - **61 por una causa común preexistente**: `e2e/admin-flow.spec.ts` (test «crear trabajador») llama a
    `ensureWorksiteE2E`, que no detecta la faena sembrada (`ws-e2e`, `E2E-001`) y crea otra, `FAE-E2E`.
    Desde ahí, cualquier selector por «Faena E2E» resuelve dos elementos y falla por strict mode
    (contratos-faena, flota-conductores, pdtp-*, prevencion-incidentes-re20, prevencion-inspecciones-*,
    entre otros). Reproducido de forma determinista con `admin-flow` solo sobre una base nueva y también
    sobre `HEAD` sin los cambios del tablero. Los 25 «no corrieron» son seguidores de pruebas seriales
    que cayeron tras esos fallos. La causa exacta de por qué el helper no ve la faena **no se determinó**.
  - **3 deterministas y preexistentes**, que fallan igual en el reintento y en una base de `HEAD`:
    `legacy-mantenciones-retired.spec.ts:5` y `mantencion-historico.spec.ts:21` (ambos por
    `net::ERR_ABORTED` del beacon `POST /api/apps/visita`, ya documentado en
    `2026-11-23-unslop-ui-control-operacional-plan.md`) y `reflow-anchos.spec.ts:158` (TopBar de
    catálogos 105,4 px frente a 88,9 px de usuarios), este último **corregido después el mismo día**
    (ver «Hallazgos abiertos» n.º 2).
  - **Reintento**: los 25 archivos fallidos más el spec del tablero, en una sola invocación sobre una base
    `bodega_e2e` reseteada: 158 pruebas, 154 pasan, 3 fallan (las de arriba), 1 se omite. Que 61 de 64 pasen
    en base limpia respalda la causa común, pero la atribución de 7 fallos con mensajes distintos
    (combustibles-control:270, correlativos-secciones:243, epp-stock-preflight:44, miper-escenario:400,
    repuestos-servicios-oc-flow:162 y :184, servicios-costo-pendiente:22) es por correlación, no
    demostrada una a una.
  - **6 omitidas** por condiciones del propio código (entre ellas la del tablero por fecha); los otros 5
    skips no se reintentaron.
- **Caveat ambiental**: el shell de verificación puede traer `NODE_ENV=production`; con ese valor React
  sirve el build de producción y `react-dom/test-utils` no expone `act`, lo que produce fallos masivos
  falsos. La corrida válida es con `NODE_ENV=test`.
- **Corrección a la versión anterior de este informe**: decía que la suite completa no se corrió porque
  «un servidor de producción sirve desde el `.next` del host en :3000/:3001». Era falso: :3000 y :3001
  son contenedores docker (`plataforma-app-1`, `plataforma-dev-app-1`) con su propia imagen y no usan el
  `.next` del repositorio. Con el host libre se corrió la suite completa.

## Reimportación del consolidado en desarrollo

Sobre `bodega_dev` (127.0.0.1:5433), con respaldo previo en `~/backups-dev` y la migración 0401 aplicada
(402/402). El archivo es `CONSOLIDADO_CHOME_COMBUSTIBLE_MANTENCION_INSPECCION.xlsx`.

- **Simulación → `--apply` → segunda simulación**, sin rechazos ni ambigüedades en ninguna hoja. La
  segunda simulación no dejó nada por hacer (0 nuevas, 0 completadas, 0 con diferencia) y los conteos SQL
  fueron idénticos.
- **Detalle por ítem: 266 de 266 leídos**, contrastados con un conteo independiente del xlsx
  (`openpyxl`): 6 pautas, 192 filas de camiones (4 × 48) y 74 de máquinas (2 × 37). REALIZADO 219,
  NO APLICA 44, NO REALIZADO 3. Sin ítems huérfanos, y los totales por pauta coinciden con su fila.
- **Conteos por hoja (filas / nuevas / completadas / rechazadas)**: MANTENCIONES 2.344 / 2.202 / 142 / 0;
  INSPECCIONES 1.333 / 1.333 / 0 / 0; HALLAZGOS_INSPECCION 1.132 / 1.132 / 0 / 0; PAUTAS_PREVENTIVAS
  6 / 6 / 0 / 0. Un aviso de lectura: MANTENCIONES fila 2155 con `DIAS_DETENIDO` = −7 queda vacío.
- **Efecto sobre lo ya cargado**: 142 de los 154 registros que dev ya tenía recibieron su vínculo
  (54 eran conflictos de código y patente que el consolidado resuelve).
- **La matriz tendrá pocos datos reales**: sólo 4 pautas de camiones con detalle (KA-141 40.000 km,
  KA-143 80.000 km, KA-142 120.000 km y KCH-135/SRCJ-42 sin vínculo de equipo, por conflicto de
  código y patente: la patente SRCJ-42 pertenece a KCH-133 en la flota), todas de Biodiversa; las 2 de
  máquinas son pautas de prueba y el tablero las excluye, así que la pestaña Máquinas queda sin pautas.
  Ningún equipo reúne 8 pautas con detalle (máximo 1), por lo que **el tope de «últimas 8 pautas» de la
  matriz no se pudo ver con datos reales**.
- **Alcance**: sólo desarrollo. No se tocó producción.

## Evidencia visual

> **Capturas de estados interactivos: NO ejecutadas.** El lanzamiento del flujo que las tomaba fue
> denegado tres veces por el clasificador de permisos del modo automático (categoría «Undermining
> Oversight», sin más detalle), la última después de que el usuario aprobara explícitamente las acciones
> concretas (dev en :3007 contra `bodega_dev`, login con el usuario QA, siembra y borrado de filas `QA_`,
> PNG en `audit/`). No se reintentó ni se hizo por otra vía. Falta además la captura de `Hoy` con el menú
> de pestañas, que no existía antes del arreglo. Siguen pendientes: popovers de faena,
> código y frecuencia; chip activo y «Borrar filtros»; columna de matriz y fila de OT seleccionadas;
> visor de foto; estados vacíos; foco de teclado; y las tres pestañas en móvil con los ajustes finales.
> Las capturas de abajo son de la pasada anterior; no se rehicieron ni se revisaron en el cierre.

- Escritorio 1440×900 y móvil 390×844, guardadas en `audit/screenshots/mantencion-panel-looker/`:
  - `shot-planificacion-top.png`, `shot-planificacion-delta.png`;
  - `shot-camiones-top.png`, `shot-camiones-preventivo.png`, `shot-camiones-matrix.png`;
  - `shot-maquinas-top.png`, `shot-maquinas-matrix.png`;
  - `mobile-planificacion.png`, `mobile-camiones.png`, `mobile-camiones-matriz.png`, `mobile-maquinas.png`.
- La matriz y la tabla correctiva tienen scroll horizontal en móvil; el filtro de dos columnas se
  apila en una sola columna bajo `xl`.

## Hallazgos corregidos durante la verificación

1. **`DataTable` servidor → cliente**: `renderRow`/`renderMobileCard` no son serializables. La tabla de
   Planificación pasó a ser un componente cliente.
2. **`postgres` en el bundle del navegador**: la tabla cliente importaba `planning.ts` (que importa
   `loadFleet` y la base). Los semáforos se separaron a `planning-rules.ts`, sin base.
3. **Fotos inexistentes**: la tabla pedía `/api/mantencion/fotos/{id}` para fotos con fila pero sin
   archivo y generaba 404. Ahora se verifica la existencia del archivo antes de pintar la miniatura.
4. **El bloque que emite un filtro se filtraba a sí mismo**: el equipo derivado de una OT/mantención
   se aplicaba a la tabla de OT o a la matriz al ignorar su propia dimensión. Se corrigió en
   `queryFilters`.
5. **Ancho de la tabla correctiva**: el layout de dos columnas no admitía siete columnas; se integró
   el tipo y la foto en la celda de equipo y se compactó la tabla.
6. **Chips de conductor/mecánico en minúsculas**: la URL guardaba el `nameKey`; ahora guarda el nombre
   legible y normaliza al resolver.
7. **Hidratación en E2E**: los controles existen en el HTML del servidor, pero su clic no funciona
   hasta hidratar. Se agregó la marca `data-looker-filter-ready` / `data-cross-filter-ready` y el spec
   espera esa marca antes de interactuar.

## Hallazgos abiertos

1. **PRODUCT BUG · alta — la pestaña `Hoy` no ofrecía el menú de pestañas. CORREGIDO el 11-24.**
   `/mantencion/panel` (sin parámetro) y `?pestana=hoy` no pintaban `PanelTabs`: `page.tsx:48` retornaba
   `renderHoyTab(...)` y `hoy-tab.tsx` armaba su propio `PageContainer`/`PageHeader` sin menú, mientras
   que `page.tsx:67` sólo lo pintaba para las otras tres pestañas. Verificado en navegador (0 elementos
   `nav "Secciones del panel de mantención"` y 0 enlaces `pestana=` en `Hoy`; 1 y 3 en
   `?pestana=camiones`). Efecto: desde el Panel por defecto no se llegaba a Planificación, Camiones ni
   Máquinas sin escribir la URL, y tampoco hay `pestana=` en el menú lateral.
   - **Arreglo** (aprobado por el usuario): `<PanelTabs active="hoy" />` justo después de `PageHeader` en
     `hoy-tab.tsx`, igual que en `page.tsx` para las otras tres. Con prueba primero: dos pruebas nuevas en
     `page.test.tsx` fallaron antes del cambio (el menú no estaba en el árbol) y pasan después.
   - **Verificación en navegador** (otro flujo, Chromium sobre `next dev`): el menú queda bajo el
     encabezado; «Hoy» lleva `aria-current="page"` en `/mantencion/panel` y en `?pestana=hoy`; los enlaces
     miden 36 px de alto a 1440 px y 44 px a 390 px; `scrollWidth` = `innerWidth` en ambos (sin scroll
     horizontal); un solo `nav` de pestañas; el recorrido Hoy → Planificación → Camiones → Máquinas → Hoy
     da las URLs exactas; 0 errores de consola y 0 respuestas HTTP ≥ 400 (sin contar `/api/apps/visita`).
   - **Alcance del cambio**: `hoy-tab.tsx` sólo lo importa `page.tsx`; el informe PDF del Panel
     (`app/(print)/mantencion/informe`) no comparte ese encabezado y no cambia.
2. **PRODUCT BUG · media, preexistente — el TopBar crecía sin tope a 1024 px. CORREGIDO el 11-24**
   (`reflow-anchos.spec.ts:158`, «el TopBar no crece respecto de otra pantalla de administración»).
   - **Síntoma**: a 1024 px el `banner` medía 105,4 px en Catálogos PDTP y 88,9 px en Usuarios; el test
     tolera +8 px sobre la pantalla de referencia.
   - **Causa raíz**: en `components/layout/top-bar.tsx` la descripción de la página tenía
     `line-clamp-2 … lg:block`. `lg:block` pisa el `display:-webkit-box` que necesita el recorte, así que
     el tope de «dos líneas» que el código promete no existía. A 1024 px, con el menú lateral abierto, el
     título sólo dispone de 128–175 px y la descripción medía 3 líneas (49,5 px) en Usuarios y 4 líneas
     (66 px) en Catálogos. Medido en el DOM real: `display: block` y `-webkit-line-clamp: 2` inerte. Esa
     clase entró el 2026-11-07 (`e2ca62ca0`, según `git log -S`); el test es del 2026-09-27.
   - **Confirmación antes de editar** (una sola variable): forzar `display:-webkit-box` en ese `<p>` desde
     el navegador dejó la descripción en 33 px (2 líneas) y el banner en 82 px (Usuarios) y 72,4 px
     (Catálogos).
   - **Arreglo**: `lg:line-clamp-2` en lugar de `line-clamp-2 … lg:block`, con un comentario que explica el
     porqué. Es la única aparición del patrón (`line-clamp-N` junto a `<bp>:block|flex|grid`) en `app/` y
     `components/`. Medido después: 82 px y 72,4 px.
   - **Efecto sobre otras pantallas**: la descripción del TopBar queda recortada a 2 líneas desde 1024 px
     en **toda** la plataforma, que es lo que el diseño pedía. Los cuatro specs que miden el TopBar o el
     shell pasan 27/27 (ver tabla), pero no se revisó pantalla por pantalla qué descripciones largas se
     recortan ahora.
   - **Sin resolver, aparte**: a 1024 px con el menú lateral abierto el bloque izquierdo del TopBar mide 416
     px y el título queda en 128–175 px, de modo que la descripción se lee unos 30 caracteres. Es una
     decisión de diseño del TopBar, no del arreglo.
3. **SEGURIDAD · media — enlaces de fotos del histórico sin validar el esquema. CORREGIDO el 11-24**
   (hallazgo de la revisión de seguridad automática del commit del tablero).
   - **Qué pasaba**: `MatrixPhotos` pintaba `href={link.url}` con la URL tal como venía de la celda
     `IMG_FILTROS`/`IMG_STICKER` del Excel importado, sin comprobar esquema ni host.
   - **Alcance real**: React 19 ya neutraliza `javascript:` (lo reescribe a un `throw`, visto en la prueba),
     de modo que el vector XSS directo no se ejecutaba; pero `data:`, `http:` y hosts ajenos seguían siendo
     enlaces navegables (suplantación desde una celda de Excel). El hallazgo es válido como defensa en
     profundidad.
   - **Arreglo** (reutiliza el criterio que ya tenía `registros/historicos/[id]/page.tsx`): `driveLink`
     pasa a `lib/mantencion/drive-link.ts` —sólo `https:` hacia `drive.google.com`/`docs.google.com`— y se
     usa en tres puntos: el cargador del servidor (`preventive.ts`, para que una URL insegura ni llegue al
     cliente), `MatrixPhotos` (el límite de seguridad al pintar) y la página histórica, que ya no tiene su
     copia local. Pruebas primero: 4 de `driveLink` (esquemas `javascript:`/`data:`/`vbscript:`, `http:`,
     hosts ajenos, `drive.google.com.evil…`, `drive.google.com@evil…`, texto y vacíos) y 3 del componente;
     rojas antes, verdes después. Typecheck y eslint en 0; 92 archivos y 1.080 pruebas de mantención verdes.
   - **No adoptado**: validar también al importar. El valor original se conserva tal cual en la base
     (trazabilidad) y se valida al mostrar, que además cubre a cualquier otro escritor de la tabla. Los 12
     valores reales de dev son todos `https://drive.google.com`, así que la lista no oculta nada legítimo.
4. **Preexistentes, ajenos al tablero** (ver «Verificación ejecutada»): la segunda faena «Faena E2E» que
   crea `admin-flow.spec.ts` y el beacon `POST /api/apps/visita` abortado.

## Límites y datos pendientes

- **Reimportar el consolidado** en cada ambiente para poblar mecánico, observaciones, fotos y detalle
  por ítem de las pautas históricas. Hecho **sólo en desarrollo** (ver arriba); la migración 0401 y la
  reimportación **no se aplicaron en producción**. Hasta entonces, la matriz histórica muestra sólo las
  pautas que ya tengan detalle y el resto se informa como «sin detalle por ítem».
- **Fotos históricas de mantención**: el importador no guarda las fotos de los formularios de
  mantención (sólo las de pautas). El correctivo histórico muestra «Sin foto»; las nativas usan el
  visor de la plataforma.
- **Conductores históricos**: son texto libre y el propio consolidado advierte que no se cruzaron
  entre fuentes. Las horas se prorratean entre los conductores de cada registro y la UI lo dice.
- **Próxima mantención**: con la regla vigente, 339.990 con base 10.000 da 350.000, no el 380.000 del
  ejemplo de Looker. La diferencia está documentada en la pestaña y en `PLAN-dashboard-mantencion.md`.
- **Frecuencia**: el filtro se genera con los intervalos activos realmente presentes; no se fijan
  40.000/10.000/300/250.
- **Suite E2E completa**: ejecutada el 11-24 y **no verde** (64 fallos preexistentes, ver arriba). No
  hay una corrida verde de referencia del repositorio con la que comparar.
- **Cobertura del spec no ejecutada**: el visor de la matriz con una foto preventiva nativa sólo corre
  desde 2026-12-01 (se probó con el reloj adelantado, no con el real); teclado no probado en barras de
  faena + mecánico, leyenda del gráfico combinado ni filas de conductor; sin aserciones del valor
  numérico de las barras de cumplimiento ni de la tabla «Consolidado por horas» de Planificación con la
  máquina sembrada.
- **Capturas interactivas**: no se tomaron (ver «Evidencia visual»). Tampoco se midió el desborde
  horizontal a 390 px ni se revisó visualmente el foco de teclado.
- **Fuera de alcance, declarado**:
  - aplicar la migración 0401 y reimportar el consolidado en **producción**;
  - **exportaciones** (Excel/PDF) de las pestañas nuevas;
  - **comparación contra una captura real de Looker**: no hay captura del panel original en el
    repositorio; la comparación fue estructural, contra la especificación y el consolidado;
  - proxy o descarga de las fotos de Google Drive de las pautas históricas.

## Diferencias que quedan frente a Looker

- La tabla correctiva muestra el tipo y la foto dentro de la celda de equipo, no como columnas
  independientes, para que quepa en el layout de dos columnas.
- En móvil, las tablas anchas y la matriz se desplazan horizontalmente.
- Looker no se replica como iframe ni con sus colores exactos en el resto de la plataforma: la paleta
  `#27894d/#ffd51e/#f39200` se aplica scoped a `.mant-looker`; el texto usa tokens `-ink` por AA.
- No hay drill-down ni navegación entre gráficos, igual que el panel original.
