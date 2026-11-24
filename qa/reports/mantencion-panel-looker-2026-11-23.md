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
- **Exportar Excel** de Planificación, Camiones y Máquinas (merge `36cd514ce`):
  - Acción de servidor `app/(app)/mantencion/panel/looker-export-action.ts`: exige `mant:export` y el gate de
    la página, valida la entrada con zod (lista blanca de parámetros; tope de 100 ids por clave), vuelve a
    consultar con los filtros de la URL y el alcance de quien exporta (del navegador no viaja ninguna fila),
    registra auditoría y corta cada hoja en 20.000 filas con aviso. Sin permisos nuevos.
  - Libro por pestaña: Planificación trae «Consolidado por kilómetros» y «Consolidado por horas»; Camiones y
    Máquinas traen «Correctivos» (todas las filas del filtro, sin paginar), «Conductores», «Horas y registros»,
    «Cumplimiento por mes», «Cumplimiento faena y mecánico», «Cumplimiento por patente», «Matriz de checklist»
    y «Pautas de la matriz». Todas llevan «Filtros» (período, faenas, códigos, frecuencia, filtros cruzados y
    notas de lectura) y «Metadatos». **No exporta** las fotos (de las pautas va la cantidad y los enlaces https a
    Drive ya validados) ni los gráficos como hojas aparte: salen de las mismas tablas.
  - Donde la pantalla recorta, el libro trae más y las notas lo dicen: la matriz llega a 60 pautas (la pantalla
    muestra 8), «Horas y registros» incluye todos los equipos (la pantalla, 8) y «Cumplimiento faena y mecánico»
    todas las combinaciones (la pantalla, 12). Es una decisión del implementador que el usuario puede revertir.
  - Refactor: `work-tab.tsx` y `planificacion-tab.tsx` cargan sus datos por `work-data.ts`, compartido con el
    libro, de modo que pantalla y Excel no pueden divergir.
  - Revisión independiente de solo lectura: sin hallazgos críticos ni altos; 1 medio (texto engañoso en
    «Filtros» con faenas inactivas) y 3 bajos (tope de ids, prueba de fórmulas, aserciones débiles), los cuatro
    corregidos con prueba en `f4927687b`.
- **Pulido tras la revisión visual** (6 commits, `0f723c596` … `f00ebd5d6`): listas de Código y Frecuencia
  acotadas a la unidad de la pestaña (`tab-scope.ts`); barras de faena y mecánico con dos líneas; visor de
  la foto de la correctiva con el botón Cerrar legible; eje de horas con coma y «1 registro»; mensaje «se
  controla por km» una sola vez y con la patente; texto de vacío de conductores; popovers de filtros sin zoom
  en iOS.
- **E2E ampliado**: `e2e/mantencion-panel-looker-export.spec.ts` (8 escenarios), `…-cobertura.spec.ts` (7) y
  el helper `…-seed-extra.ts`.

## Verificación ejecutada

Cierre del 2026-11-24. Las cuatro primeras filas son las puertas finales, corridas al final sobre el código
definitivo; el resto de la tabla está en el orden en que se ejecutó durante el día. La fila de la suite
completa que dice «No verde» es la **anterior** a los arreglos: el resultado vigente está en la subsección
«Corridas de la tarde».

| Puerta | Fecha | Resultado |
|---|---|---|
| **Puertas finales** en un worktree limpio de `HEAD` (`d21f8bdc8`, sin los cambios sin commitear de otra sesión): `typecheck`, `lint` y `check:secrets` | 11-24 | Las tres con exit 0 |
| `npm run db:verify-migrations` (mismo worktree) | 11-24 | 402 entradas verificadas hasta `0401_clumsy_taskmaster`, checksums verificados |
| `NODE_ENV=test npm run test:fast` (mismo worktree) | 11-24 | 1.471 archivos pasan y 32 omitidos; **22.101 pruebas pasan, 0 fallan, 277 omitidas** (497 s) |
| `NODE_ENV=test npm run test:pglite` (mismo worktree) | 11-24 | 442 archivos; **5.685 pruebas pasan, 0 fallan, 1 omitida** (477 s) |
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

### Corridas de la tarde del 11-24 (tras exportaciones, pulido y arreglos de E2E)

| Qué | Resultado |
|---|---|
| Fusión de las exportaciones (`36cd514ce`): typecheck, 105 archivos de mantención / charts, 32 PGlite del tablero y de la exportación | typecheck 0; **1.178 pruebas pasan**; 32/32 PGlite. Un conflicto en `planning.ts` resuelto a mano; una prueba del Excel esperaba el código en vez de la patente y se actualizó |
| E2E nuevo (`export` 8 + `cobertura` 7) en `next dev` aislado, dos corridas | **15/15 y 15/15**; el spec existente, 15 pasan + 1 omitido |
| Control negativo del escenario «sin `mant:export`» | Al concederle el permiso al usuario de prueba el escenario **falló**, como debía |
| **Suite E2E completa**, intento 1 (`npm run test:e2e`) | **No ejecutó ninguna prueba**: el `webServer` agotó sus 600 s entre el reseteo de la base y el `next build`, que quedó cortado en el empaquetado final. Carga de la máquina de 8–9 sobre 12 núcleos y seis Chromium ajenos al 100 % de CPU. Log guardado |
| Suite completa, intento 2 (build aparte con el mismo comando y variables de `e2e/start-server.sh`, sin tope de tiempo, y `E2E_SKIP_BUILD=true`) | 1.221 pruebas; **se detuvo en la 1.186** (la detuvo el sistema o el usuario; sin resumen final): **1.171 pasan, 1 falla, 14 omitidas** |
| Las 35 pruebas que no llegaron a correr (`uso-personal`, `worker-delivery-flow`, `zoom-200`) | **35/35 pasan** |
| El spec del único fallo, `prevencion-miper-revision-lectura.spec.ts`, aislado | **7/7 pasan** (en la corrida completa falló el primero, 7,1 s, y las 6 siguientes se omitieron en cadena) |
| **Consolidado de la suite** | 1.171 + 35 + 7 = **1.213 pasan, 8 omisiones condicionales y 0 fallos reproducibles** |

- **Cómo leer ese consolidado**: no es una sola corrida ininterrumpida, sino tres invocaciones contra el mismo
  build (con la base reseteada en cada una). El fallo único **no se reprodujo** y su causa **no se determinó**:
  el spec es serial y depende de datos sembrados por pruebas previas, y esa corrida se hizo con la máquina muy
  cargada. Se declara como intermitente no explicado, no como resuelto.
- **Qué árbol se probó**: `d21f8bdc8`. Otra sesión modificó archivos de OnWay (`lib/integrations/onway/*`,
  monitoreo de flota) entre las 16:00 y las 16:08, **después** del build de las 15:49: no están en lo probado.
- **Frente a la corrida completa anterior (64 fallos)**: pasan los 61 que dependían de la segunda «Faena E2E»,
  los 2 del beacon de visitas (`legacy-mantenciones-retired:5`, `mantencion-historico:21`) y
  `reflow-anchos:158`. Por archivo, en la corrida completa: tablero 15 + 1 omitida, `export` 8/8, `cobertura`
  7/7, `admin-flow` 7/7, `reflow-anchos` 15/15, `contratos-faena`, `flota-conductores` 8/8,
  `emergency-resource-catalog`, `pdtp-cobertura` 3/3, `pdtp-obligaciones` 3/3, `prevencion-incidentes-re20`
  32/32 y `prevencion-miper-escenario` 10/10.
- **Las 8 omisiones condicionales** son del propio código y no se reintentaron: el visor de la matriz por
  fecha (`CUTOVER`), `dashboard-rediseno:104`, `matriz-estados:107`, `negative-flows:102`,
  `pdtp-habilitacion:67` y `:98`, `ppa-offline:314` y `tae-history-import:36`.
- **Navegador**: el visor de la matriz con una foto preventiva nativa sigue sin correr con el reloj real
  (las preventivas nativas cuentan desde 2026-12-01).

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

**Capturas de estados interactivos (11-24): 45 nuevas** (19 a 1440×900 y 26 a 390×844), prefijo `i-`, en
`audit/screenshots/mantencion-panel-looker/` (carpeta ignorada por git: es evidencia local, no viaja con el
repositorio). Las 11 anteriores se conservan.

- **Cómo se tomaron**: el flujo con `bodega_dev` y el usuario QA fue denegado tres veces por el clasificador
  de permisos del modo automático (categoría «Undermining Oversight», sin más detalle), la última con la
  aprobación explícita del usuario; no se hizo por otra vía. Se tomaron con una variante más segura: base E2E
  desechable (`bodega_e2e_looker`), usuario público del fixture y datos sintéticos `QA_…` sembrados con el
  helper del spec. **Por eso muestran datos sintéticos y no los del consolidado real.** Las de 390 px usan
  emulación táctil de Chromium, no un teléfono real; el indicador de `next dev` se ocultó con CSS.
- **Estados cubiertos**: popovers de faena, código (con «QALKA1» escrito: la lista pasa de 124 opciones a 1) y
  frecuencia; chips activos con «Borrar filtros»; columna de matriz y fila de OT seleccionadas con el resto de
  bloques filtrados; visor de la foto de la correctiva; vacíos (período sin datos, filtro sin coincidencia,
  mensaje contextual km/horas); foco de teclado en el filtro Faena (46 Tab, anillo de 2 px, contraste 7,6:1
  contra la página); `Hoy` con el menú de pestañas; y las tres pestañas en móvil.
- **Tras el pulido** se regeneraron y sobrescribieron los estados afectados (visor, popovers, vacíos y las
  dos páginas móviles largas). El estado «filtro sin coincidencia» ya no se puede producir con un código de
  otra unidad (era el defecto de las listas sin acotar) y se rehízo con Faena B + código de la faena A.
- **No capturado o parcial**: el visor de la foto preventiva de la plataforma y las miniaturas de la matriz
  (esas preventivas cuentan desde 2026-12-01); el foco de teclado sólo en Faena (no en Código, Frecuencia ni en
  los controles de filtro cruzado); el popover de Faena sólo con una opción ya marcada; Planificación en
  móvil en tres tramos por su largo. Cuatro PNG no los abrió el agente que los tomó.
- Revisión visual con medición: a 390 px no hay scroll horizontal de página en ningún estado
  (`scrollWidth` ≤ `innerWidth`); las pestañas miden 44 px de alto en móvil y 36 px en escritorio; 0 errores
  de consola y 0 respuestas HTTP ≥ 400 del origen.

Capturas de la pasada anterior (11-23), 1440×900 y 390×844:
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
4. **Hallazgos de la revisión visual (11-24)**, verificados contra el código o el DOM antes de actuar:
   - **Corregidos** (7, con medición antes y después y prueba): (a) *FUNCTIONAL FINDING, media* — las listas de
     Código y Frecuencia no se acotaban por pestaña (Camiones ofrecía horas y máquinas; Máquinas, km y camiones;
     elegirlos dejaba la pestaña vacía): `tabUnit()` existía y no se aplicaba a las opciones; ahora Camiones
     ofrece 73 códigos y 10.000–160.000 km, Máquinas 50 y 300–1.200 h, y un valor de la otra unidad en la URL
     se ignora sin chips ni error; (b) etiquetas truncadas en las barras de faena + mecánico; (c) la X del visor
     de foto con contraste 1,36:1 (ahora 5,99:1), arreglada en `work-photo.tsx` sin tocar el `dialog.tsx`
     compartido; (d) eje de horas con coma decimal y «1 registro»; (e) el mensaje «se controla por km» triplicado
     y con el código en vez de la patente; (f) «no declaran conductores» cuando había 0 registros; (g) buscador
     de los popovers a 12 px (iOS hace zoom), borde derecho y opción cortada.
   - **No corregidos, decisión de diseño o no alcanzables por una persona**: tablas anchas de móvil sin señal de
     scroll horizontal; objetivos táctiles de 32 px (cumplen el mínimo de 24 px de WCAG 2.5.8); largo de
     Planificación en móvil; la carrera de `setMulti`/`toggle` con dos cambios a 0 ms de diferencia; los chips
     derivados de Planificación; y la unidad repetida en las opciones de Frecuencia («10.000 km» + insignia «km»).
5. **AUTOMATION WARNING — la segunda «Faena E2E» (explicaba 61 de los 64 fallos). CORREGIDO** (`c91be1f7f`).
   - **Causa raíz demostrada**: `ensureWorksiteE2E` llama a `isVisible()` justo después de `goto`, y
     `isVisible()` no espera. El listado de `/admin/faenas` llega dentro de un `Suspense` y React 19 revela su
     contenido unos 300 ms después del primer pintado: la fila existe pero «no se ve» entre 120 y 290 ms
     después del evento `load`. Medido con un `MutationObserver`: `isVisible()` dio `false` con la fila
     presente en 3/8 y 5/8 (dev), 3/10 (prod) y 3/15 con el helper exacto bajo el runner; una copia del helper
     antiguo creó el duplicado (SQL: `ws-e2e`/`E2E-001` y `FAE-E2E`) en 2 de 20 corridas. El mismo defecto
     estaba en `ensurePositionE2E` (`/admin/cargos`, 5/8 en dev).
   - **Descartado con evidencia**: paginación (8 filas en «Activas», `pageSize` 20), nombre accesible y filtro
     por defecto.
   - **No es determinista**: la traza y el video del runner retrasan el `isVisible()` y enmascaran la carrera;
     8 corridas en dev y ~31 en prod no la dispararon. Lo demostrado es la carrera y su tasa (2,5–20 % por
     llamada), no un fallo en cada corrida.
   - **Arreglo**: esperar a que la tabla («Faenas activas» / «Catálogo de cargos») sea visible antes de decidir,
     y quitar el `.catch(() => false)`. Verificado: `admin-flow` dos veces seguidas 7/7 con una sola fila;
     el test del trabajador `--repeat-each 40` 40/40; `admin-flow` + `contratos-faena`, `flota-conductores`,
     `emergency-resource-catalog` y `pdtp-cobertura` 20/20 en prod; y la suite completa ya no tiene el duplicado.
   - **Sin tocar, con riesgo**: otros helpers del repo con el mismo patrón `isVisible().catch` sin esperar
     (`negative-flows:108,116`, `pdtp-annual-adjustments:77`, `pdtp-habilitacion:71,101,104`,
     `pdtp-actions-plan:27-29`, `perceived-latency:75,107,129`, `facturacion:71,83`,
     `keyboard-navigation:106,147,154,161`, `bodega-conteo-fisico:150`). Los que deciden un `test.skip` o una
     acción pueden saltarse en silencio con la misma carrera: **no se verificó si las dos omisiones de
     `pdtp-habilitacion` en la suite son legítimas o causadas por ella**.
6. **AUTOMATION WARNING — el aborto de `POST /api/apps/visita` es del navegador. CORREGIDO en los tests**
   (`d21f8bdc8`). Pregunta central: ¿se pierden visitas? **No**. Se midieron 18 pantallas (una por app) contra
   `app_visits`: las 18 peticiones emitidas recibieron 204 y quedaron registradas (17 filas: `/prevencion` no es
   una app); con navegación inmediata y con pausas el resultado fue el mismo. Con `keepalive`, Chromium informa
   `ERR_ABORTED` al descargar el documento aunque el servidor ya recibió la petición. Cada spec traía su filtro
   inline de las precargas `_rsc` canceladas; se sumó el beacon a lo ignorado, con el comentario que cita la
   evidencia. Eso destapó un segundo aborto en `mantencion-historico` —las Server Actions (cabecera
   `next-action`), con la pantalla ya pintada y la traza en 200—, que fallaba 1 de cada 4–6 corridas en prod y
   ahora pasa 12/12, y un aviso de hidratación en dev por el `screenshot` (resuelto con `networkidle`).
   Riesgo teórico no observado: el tracker marca la sección en `sessionStorage` antes de que el `fetch`
   responda, así que ante una caída real de red no se reintentaría en 5 minutos.
7. **UX FINDING · media — el recorte a 2 líneas de la descripción del TopBar a 1024 px (decisión pendiente).**
   Medición de solo lectura sobre 131 rutas con el administrador de fixture, a 1024×768 y con el menú lateral en
   su estado por defecto (evidencia: `qa/reports/evidencia-topbar-1024-2026-11-24.md`):
   - 130 rutas tienen descripción y **80 (61,5 %) quedan recortadas**; en 25 se pierden 3 o más líneas (la que más,
     `/facturacion/pendientes`, tiene 11 y muestra 2). En 44 de las 130 el bloque izquierdo queda en su mínimo de
     128 px; el ~416 px que se citaba es el máximo, no lo habitual. El texto completo sigue en el `title`.
   - El alto del `banner` es 72–72,4 px en 110 de 131 rutas; **21 superan 73 px** y 7 de ellas no tienen
     descripción recortada, así que su altura viene de otros elementos de la cabecera. Las más altas:
     `/prevencion/documentacion` 160 px, `/admin/proveedores` y `/admin/trabajadores` 140, `/admin/inventario-faena`
     122, `/admin/productos` 118, y `/combustibles*` 94.
   - Es el intercambio del arreglo: antes el TopBar crecía sin tope (hasta 105 px); ahora no crece, pero esconde
     texto. Rediseñarlo a 1024 px (ocultar la descripción hasta `xl`, ensanchar el bloque del título, o llevarla
     bajo el título) es una decisión de diseño que **no se tomó**.
8. **Preexistentes, ajenos al tablero y no resueltos aquí**: los 4 specs que fallan sólo sobre `next dev` por
   hidratación (`flota-conductores:87` y `:100`, `pdtp-cobertura:26` y `:63`; en producción pasan 20/20); y el
   fallo intermitente de `prevencion-miper-revision-lectura:119` (ver «Verificación ejecutada»).

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
- **Suite E2E completa**: 1.213 pasan, 8 omisiones condicionales y 0 fallos reproducibles, pero armada con
  tres invocaciones y con un fallo intermitente no explicado (ver «Verificación ejecutada»). No hay una
  corrida única e ininterrumpida; el build del arnés agotó su tope de 600 s bajo carga y se construyó aparte.
- **Cobertura que sigue sin ejecutarse**:
  - el visor de la matriz con una foto preventiva nativa corre sólo desde 2026-12-01 (pasó con el reloj
    adelantado, no con el real);
  - la llamada directa a la acción de exportación sin `mant:export` (sólo hay prueba unitaria con la
    autenticación simulada; en navegador sólo se comprobó que el botón no aparece);
  - el tope de 20.000 filas de la exportación y los avisos que genera, con volumen real (se probó con un
    tope artificial de 10);
  - `x_check` y `x_equipo` en el Excel (sólo en pantalla); viewport móvil en el E2E (solo Desktop Chrome);
  - el contenido del libro de `Hoy` más allá de los nombres de hoja;
  - abrir los .xlsx en Excel o LibreOffice (se leyeron con `exceljs` y `openpyxl`);
  - Safari/Android reales y lector de pantalla.
- **La matriz con datos reales**: el consolidado trae sólo 4 pautas de camiones con detalle y 2 de máquinas de
  prueba; el tope de «últimas 8 pautas» se verificó en E2E con 10 pautas sintéticas de un equipo (muestra las 8
  más recientes), no con datos reales.
- **Fuera de alcance, declarado**:
  - aplicar la migración 0401 y reimportar el consolidado en **producción** (ver el runbook de abajo);
  - **exportación a PDF** de las pestañas nuevas (el Excel está hecho);
  - **comparación contra una captura real de Looker**: no hay captura del panel original en el repositorio; la
    comparación fue estructural, contra la especificación y el consolidado. Hace falta que alguien aporte esa
    captura;
  - proxy o descarga de las fotos de Google Drive de las pautas históricas: la plataforma eliminó su
    integración con Drive, así que un proxy necesitaría credenciales de Google que no existen aquí;
  - rediseño del TopBar a 1024 px (hallazgo 7).

## Despliegue a producción (runbook; NO ejecutado)

Para quien corra el despliegue. Está armado con lo que se hizo en desarrollo y con las notas del proyecto;
los pasos de producción **no se probaron** y deben confirmarse con lecturas antes de actuar.

1. **Antes de desplegar**: el trabajo está en `main`; confirmar que la integración continua queda verde. El
   deploy lo corre una persona (`npm run deploy:prod`, que exige `main` y el árbol limpio; un worktree limpio
   de `main` evita arrastrar cambios ajenos del checkout principal).
2. **Qué aplica el deploy**: la migración `0401_clumsy_taskmaster` (verificada en la cadena: 402 entradas) con el
   servicio `migrate`, y `sync-rbac`. **No hay permisos nuevos** en este trabajo (el Excel usa `mant:export`).
   La 0401 sólo **agrega** columnas y una tabla; no hay migración inversa: revertir significa restaurar el
   respaldo que toma el deploy.
3. **Comprobar después, sólo con lecturas**: 402 migraciones aplicadas contra el journal; `/mantencion/panel`
   muestra el menú de cuatro pestañas; `?pestana=camiones` carga sin error.
4. **Reimportar el consolidado** (`CONSOLIDADO_CHOME_COMBUSTIBLE_MANTENCION_INSPECCION.xlsx`, 3,1 MB, ignorado
   por git; contiene datos personales: no copiarlo fuera del canal que se use). Una carga anterior del historial
   en producción (2026-11-18) se hizo con un bundle esbuild por stdin contra el contenedor de la app; este
   script (`scripts/import-consolidado-mantencion.ts`) **no se ha probado en producción**, así que habrá que
   empaquetarlo igual. Orden: respaldo → **simulación** con `--report` → revisar el informe → `--apply` →
   segunda simulación, que debe dejar todo «sin cambios». El respaldo y la simulación van en una sesión ssh
   distinta de la que pasa el bundle por stdin (un `docker compose exec -T` previo se come el stdin).
5. **Advertencia de volumen**: el importador carga **todas las hojas** del consolidado, no sólo las 6 pautas
   del tablero. En desarrollo fueron MANTENCIONES 2.344 filas (2.202 nuevas y 142 completadas), INSPECCIONES
   1.333, HALLAZGOS 1.132 y PAUTAS 6, sin rechazos. En producción debe esperarse una carga de ese orden;
   las notas del proyecto indican que el historial de producción sólo tenía los 142 trabajos cargados el
   2026-11-18 desde otro archivo —**verificarlo con una lectura antes de aplicar**—. Decidir si se quiere esa
   carga completa o sólo el detalle de las pautas.
6. **Qué esperar en pantalla tras la carga**: la matriz de Camiones con hasta 4 columnas (las 4 pautas reales),
   Máquinas sin pautas (las 2 de máquinas son de prueba y el tablero las excluye) y la pauta KCH-135/SRCJ-42 sin
   vínculo de equipo por un conflicto de código y patente que debe conciliarse a mano.
7. **No cubierto**: `plataforma-dev` (:3001) tiene otra base y tampoco tiene la 0401; su despliegue también
   lo corre una persona.

## Diferencias que quedan frente a Looker

- La tabla correctiva muestra el tipo y la foto dentro de la celda de equipo, no como columnas
  independientes, para que quepa en el layout de dos columnas.
- En móvil, las tablas anchas y la matriz se desplazan horizontalmente.
- Looker no se replica como iframe ni con sus colores exactos en el resto de la plataforma: la paleta
  `#27894d/#ffd51e/#f39200` se aplica scoped a `.mant-looker`; el texto usa tokens `-ink` por AA.
- No hay drill-down ni navegación entre gráficos, igual que el panel original.
