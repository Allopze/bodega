# Reflow: desbordes del pozo del shell, paginación móvil y paginación PDTP

- **Fecha:** 2026-09-27
- **Rama:** `fix/reflow-desbordes`, desde `prevencion/integracion-final` (`33a10750`)
- **Alcance:** los desbordes horizontales que `e2e/reflow-anchos.spec.ts` no veía, el objetivo táctil de la paginación en móvil y la paginación de la planilla PDTP anual. Sin migraciones.
- **Entorno:** servidor E2E aislado en `:3400` con base `bodega_reflow_e2e` en el contenedor desechable `:55432`, build de producción (`e2e/start-server.sh`) y config de Playwright temporal fuera del repo. Sólo Chromium.

## Por qué la prueba no veía el desborde

Los informes `2026-09-27-prevencion-laterales-i01-w8.md` y `2026-09-27-prevencion-cierre-plan.md` ya lo habían detectado. El documento no desplaza nada: el contenido vive dentro del pozo del shell (`[data-shell-scroll]`), que es el contenedor de scroll y lleva `overflow-x-hidden`. Si un hijo es más ancho que la ventana, el documento no gana scroll horizontal. El pozo lo **recorta**, y el usuario pierde la columna derecha sin forma de llegar a ella. Como `reflow-anchos` medía sólo `documentElement`, la prueba seguía en verde.

## Cambios

| Commit | Qué cambia |
|---|---|
| `a454f509` test(e2e) | `reflow-anchos` mide el documento **y** el pozo a 320, 390, 768 y 1024 px, nombra los elementos culpables y cubre 7 rutas más, encontradas al barrer las rutas estáticas. `zoom-200` suma una prueba a 320 px: cada control visible de `Pagination` y de `ServerPagination` mide 44 × 44 px y queda dentro de la ventana. La prueba exige que aparezcan los dos tipos, para que no pase sin medir nada. |
| `de42285a` fix(ui) paginación | Los dos primitivos siguen ahora el mismo contrato. Bajo `sm` quedan sólo anterior, la página actual y siguiente, cada uno de 44 × 44 px. Desde `sm` vuelven los números, a 28 px (sobre el mínimo AA de 24). Se agregó `flex-wrap` por si el rango es largo. Hay prueba de componente nueva (`components/ui/pagination.test.tsx`). |
| `a42e3916` fix(ui) tarjetas | La lista de tarjetas de `DataTable` pasa a `grid-cols-1`, es decir `minmax(0,1fr)`. Antes la pista `auto` crecía hasta el min-content de la tarjeta. Lo mismo en el detalle de OC. `StateLegend` deja pasar la descripción bajo el badge. En la tarjeta de Recepción el aviso de pendientes puede partir línea, y se corrigió el texto "1ítem pendiente…", al que le faltaba el espacio. |
| `fb34a6fc` fix(layout) TopBar | El contenedor de acciones pasa de `shrink-0` a `min-w-0 flex-wrap`. La tira compacta de métricas se parte por celda. El título conserva un piso de `8rem` y se trunca dentro de su columna. En desktop el TopBar usa `min-h` en vez de `h`. |
| `8d7431d1` fix(ui) 5 pantallas | `FilterToolbar` suma `min-w-0` al grupo de filtros. Las pestañas hechas a mano de PPA e Higiene siguen el patrón de `TabsList` (`max-w-full overflow-x-auto`). Las fechas de PPA reparten el ancho bajo `sm` y conservan los 44 px. La retícula de filtros de Analítica pasa a `grid-cols-1`. La tabla de Contenedores queda dentro de `TableRoot`. |
| `d0f21cbf` fix(pdtp) | La vista anual pagina igual que la semanal: mismo `Pagination`, `?page=` con `router.replace(…, { scroll: false })`, y la página se reinicia al cambiar el estado o la vista. Se eliminó "Mostrar las N". |
| `c7bab4ee` fix(ui) | Las secciones de Analítica y la retícula de Control operacional pasan a `grid-cols-1`. |

### Causas, por capa

| Causa | Capa corregida | Pantallas afectadas |
|---|---|---|
| Con siete enlaces de 44 px y la ventana de números, la barra de `ServerPagination` medía unos 400 px | `components/ui/server-pagination.tsx` (y `pagination.tsx`, para que tenga el mismo contrato) | Solicitudes y Trazabilidad (129 px a 320, 59 a 390), Compras (21 a 320) |
| Retícula sin columnas declaradas: la pista implícita `auto` crece hasta el min-content (un correo con `truncate`, un badge sin salto, una tabla que ya desplaza dentro de su `TableRoot`) | `components/ui/data-table.tsx` en todas las listas. Página por página en Analítica, Control operacional y el detalle de OC | Usuarios (20), Recepción (27), Analítica (141 / 71), Control operacional (296 a 768 y 1024) |
| Contenedor de acciones del TopBar con `shrink-0` a 1024 px con sidebar | `components/layout/top-bar.tsx`, `summary-bar-compact-strip.tsx` | Bodega (59), Mantenciones (24), Catálogos PDTP (7) |
| El grupo de filtros era un ítem flex sin `min-w-0` | `components/ui/filter-toolbar.tsx` | Higiene (163 tras dar scroll a sus pestañas) |
| Pestañas hechas a mano sin scroll propio | la página (no usan `TabsList`) | PPA (377 / 307), Higiene (30) |
| Tabla sin `TableRoot` | la página | Contenedores (308 / 238) |
| Dos `DatePicker` de 9.5rem fijos (312 px) | la página | PPA (8, visible una vez corregidas sus pestañas) |

## Desborde antes y después

Medido como `scrollWidth - clientWidth` del pozo. En ninguna medición el documento pasó de 0: justamente por eso la prueba anterior estaba verde.

### Rutas que cubre `reflow-anchos` (pozo, px)

La build de "antes" es la base `33a10750`: ya trae los arreglos I01/W8 de Dashboard y PDTP, así que esas dos rutas miden 0.

| Ruta | 320 antes | 320 después | 390 antes | 390 después | 768 antes | 768 después | 1024 antes | 1024 después |
|---|---|---|---|---|---|---|---|---|
| Dashboard | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Mis pendientes | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Solicitudes | **129** | 0 | **59** | 0 | 0 | 0 | 0 | 0 |
| Compras | **21** | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Recepción | **27** | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Entregas | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Trazabilidad | **129** | 0 | **59** | 0 | 0 | 0 | 0 | 0 |
| Bodega | 0 | 0 | 0 | 0 | 0 | 0 | **59** | 0 |
| CAPA | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| PDTP Programas | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Usuarios | **20** | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Contenedores (nueva) | **308** | 0 | **238** | 0 | 0¹ | 0 | 0 | 0 |
| Analítica (nueva) | **141** | 0 | **71** | 0 | 0¹ | 0 | 0 | 0 |
| PPA (nueva) | **377** | 0 | **307** | 0 | 0¹ | 0 | 0 | 0 |
| Higiene (nueva) | **30** | 0 | 0 | 0 | 0¹ | 0 | 0 | 0 |
| Catálogos PDTP (nueva) | 0 | 0 | 0 | 0 | 0¹ | 0 | **7** | 0 |
| Control operacional (nueva) | 0 | 0 | 0 | 0 | **304**² | 0 | **296** | 0 |
| Mantenciones (nueva) | 0 | 0 | 0 | 0 | 0¹ | 0 | **24** | 0 |

¹ En la build base no se midió 768 px en las rutas nuevas. El valor es el de la build intermedia (con los arreglos de paginación, tarjetas y TopBar), que no toca esas causas.
² Build intermedia. En la base el barrido no incluyó 768 px; a 1024 medía 296.

La corrida de `reflow-anchos` sobre la base, con sólo el spec endurecido, falló a 320, 390 y 1024 px con exactamente las cifras de las 11 rutas originales de la tabla. En la build final pasa en los cuatro anchos.

### Barrido de todas las rutas estáticas

`find app/(app) -name page.tsx`, sin rutas dinámicas y sin `/forbidden` ni `/modulo-inactivo`: **151 rutas**. Se midieron con admin E2E.

| Build | Anchos | Mediciones | Rutas con desborde del pozo |
|---|---|---|---|
| Base `33a10750` | 320, 390, 1024 | 453 | 22 casos en 14 rutas (tabla de arriba; `/bodega/guias/nueva` y `/recepcion/nueva` redirigen a `/recepcion`) |
| Final (`c7bab4ee`) | 320, 390, 768, 1024 | 604, 0 errores de carga | **0** |

## Objetivo táctil

| Control | Antes (320 px) | Después (320 px) |
|---|---|---|
| `Pagination` (cliente, p. ej. `/admin/trabajadores` y la planilla PDTP) | 28 × 28 px (flechas 30 × 28) | 44 × 44 px |
| `ServerPagination` | 44 × 44 px, pero "Ir a página 5/6" y "Página siguiente" terminaban en 353, 401 y 449 px, fuera de la ventana (Solicitudes y Trazabilidad), y en 341 px en Compras | 44 × 44 px, todos dentro de la ventana |
| Fechas del filtro de PPA | 32 px (`h-8` pisaba el `h-11` del `DatePicker`) | 44 px bajo `sm`, 32 px desde `sm` |

La prueba nueva de `zoom-200` falló sobre la base con esas 11 filas y pasa en la build final. Las 26 pruebas previas de `zoom-200` (960 px, mínimo de 24 px) siguen en verde.

## PDTP: una sola paginación

Antes, la vista anual cortaba en 30 filas y ofrecía "Mostrar las N actividades", mientras la semanal paginaba. Se unificó en paginación por tres razones: coherencia con la semanal; el estado expandido no viajaba en la URL, así que volver desde una ficha dejaba la tabla otra vez en 30; y expandida, la tabla pasaba de 100 filas con un control de registro cada una. Las pruebas de componente de la anual se reescribieron primero en rojo: paginar de a 30, `?page=` con `replace` y `scroll: false`, no paginar con 30 o menos, y contar sobre las filas filtradas.

## Verificación visual

Capturas por script sobre `:3400`:

- Solicitudes y Trabajadores a 320 px: la barra muestra "1 - 25 de 128", anterior (deshabilitado), la página actual y siguiente, todo dentro de la tarjeta.
- Usuarios a 320 px: el badge "Activo" y las acciones quedan dentro de la tarjeta.
- PPA a 320 px: las pestañas desplazan dentro de su barra y las fechas reparten el ancho.
- Bodega a 1024 px: la tira de métricas envuelve en dos líneas y "Registrar movimiento" queda entero, sin montarse sobre la campana.

## Puertas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | PASS (sobre el árbol final) |
| `npm run lint` | PASS (sobre el árbol final; también en el pre-commit de cada commit) |
| `npm run test:fast` | 775 archivos PASS / 32 omitidos; 10.105 pruebas PASS / 293 omitidas |
| `npm run test:pglite` | 214 archivos PASS; 2.626 pruebas PASS / 1 omitida |
| E2E `reflow-anchos` + `zoom-200` (build final) | 36/36 PASS |
| E2E focalizado: `accessibility`, los 23 `pdtp-*`, `admin-contenedores`, `admin-flow`, `ppa-flow`, `recepcion-flow`, `shell-*` (3), `mantenciones`, `trazabilidad-activos`, `bodega-conteo-fisico` | 287 PASS / 1 omitida (`pdtp-habilitacion` "el CTA de una fila es alcanzable por teclado", omisión condicional previa), 0 fallos, 12,0 min |
| `npx playwright test` completo contra `:3400`, base recién reiniciada | 748 PASS / 1 fallo intermitente ajeno (pasa 6/6 aislado) / 4 omitidas, 32,6 min |

## Suite E2E completa

`npx playwright test` con la config temporal contra `:3400`, sobre la build final (`c7bab4ee`) y con la base recién reiniciada (`E2E_SKIP_BUILD=true`, sin recompilar): **748 PASS, 1 fallo, 4 omitidas**, en 32,6 min.

- **Fallo (AUTOMATION WARNING, no se atribuye a esta rama):** `prevencion-inspecciones-offline-sync.spec.ts:54`, "idempotencia: múltiples clics en sincronización…". A los 30 s seguía visible "1 cierre pendiente de sincronizar.". Corrido aislado con `--repeat-each=3` en el mismo servidor pasó 6/6 (las dos pruebas del archivo, tres veces cada una). La rama no toca inspecciones ni la cola offline. Los componentes compartidos que cambió (paginación, tarjetas de `DataTable`, `FilterToolbar`, TopBar) no intervienen en ese flujo de sincronización. Es intermitente dentro de la corrida completa y no se investigó más.
- **Omitidas (condicionales, previas):** `matriz-estados:107` (doble envío), `pdtp-habilitacion:98` (CTA por teclado), `ppa-offline:314` (prompt de notificaciones) y `tae-history-import:36` (archivo histórico real ausente).

## Sin verificar

- **Rutas dinámicas** (`[id]`, `[programId]`…): no entran en el barrido. Hay al menos 15 retículas `grid gap-* xl:grid-cols-[minmax(0,…)]` sin `grid-cols-1` en páginas de detalle (`compras/[id]`, `recepcion/[id]`, `facturacion/facturas/[id]`, `prevencion/incidentes/[id]`, `prevencion/capa/[id]`, entre otras). Con contenido ancho pueden tener el mismo defecto de pista `auto`. No se midieron ni se tocaron. Las de inspecciones y PDTP servicios quedaron fuera a propósito, porque otros agentes trabajan ahí.
- **Estados** que no abren en la vista inicial: diálogos, sheets, pestañas no activas, filtros aplicados. El barrido mide la carga inicial de cada ruta con admin y los datos del fixture E2E.
- **WebKit, Safari real y Chrome móvil real**: sólo Chromium con viewport emulado.
- **640–1023 px** fuera de 768: no se barrió 640 ni 900.
- **Producción y datos reales**: con volúmenes o textos más largos que el fixture podrían aparecer otros desbordes. La prueba ahora los mostraría.
- `doctor`, `check:security-audit`, `db:verify-migrations` (no hay migraciones) y las suites `*-postgres`: no se corrieron.

## Hallazgos que quedan

- **UX FINDING, TopBar con tres o más acciones a 1024 px.** En Catálogos PDTP las cuatro acciones ahora envuelven y se apilan en cuatro filas, y el TopBar crece a unos 150 px. Antes no envolvían: se montaban sobre el buscador y la campana (la acción "Nueva hoja" terminaba en 1031 px, sobre la campana) y el pozo recortaba 7 px. El resultado funcional es mejor, pero la pantalla sigue siendo densa. AGENTS.md (regla de layout 5) pide un único botón de entrada con un diálogo que pregunte qué crear. Eso es un cambio de producto de esa pantalla y no se hizo.
- **UX FINDING, marca del TopBar móvil a 320 px.** "Plataforma Chome" parte en dos líneas y la primera queda cortada por arriba (se ve en las capturas de Usuarios y PPA). No provoca desborde horizontal. Es previo y no se tocó.
- **IMPROVEMENT OPPORTUNITY.** PPA, Higiene, Emergencias, CPHS y Combustibles tienen pestañas hechas a mano en vez de `TabsList`/`SegmentedControl`. Sólo se corrigieron las dos que desbordaban. Emergencias, CPHS y Combustibles caben hoy.
