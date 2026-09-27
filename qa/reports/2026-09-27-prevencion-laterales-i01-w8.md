# PRs laterales I01 y W8, más el desborde móvil que midió T6 (2026-09-27)

Rama `prevencion/laterales-i01-w8`, sobre `e1c48698` (`prevencion/integracion-ola3`). Plan: `/home/allopze/.claude/plans/crea-un-plan-de-idempotent-waffle.md`, sección "PRs laterales" (I01, W8) y decisión **D29** ("solo N° fijo en móvil"). Hallazgo de origen: PREV-I01 en `2026-09-26-prevencion-production-readiness.md`. El desborde viene de `2026-09-26-prevencion-t6.md`. **Sin migración. Sin permisos, rutas ni entradas de menú nuevas.**

## Qué cambió

| ID | Cambio | Archivos |
|---|---|---|
| I01 / D29 | En la planilla anual, la columna "Actividad" es sticky sólo desde `md:` (`md:sticky md:left-12 md:z-*`, con su sombra y fondo también bajo `md:`). Bajo `md` sólo el N° queda fijo. Antes, N° + Actividad fijos medían 48 + 352 px, ocupaban todo el ancho de un teléfono y tapaban "Registrar" por más que se deslizara la tabla | `app/(app)/prevencion/pdtp/pdtp-sheet-table.tsx` |
| I01, diálogo | "Registrar ejecución · N°{n}" y el nombre de la actividad en la descripción, igual que los diálogos de desvío, meta por faena y asignación. Props opcionales `activityN` y `activityName`. También se pasan desde Constancias | `pdtp-execution-form.tsx`, `constancias/constancias-workbench.tsx` |
| W8 | La vista semanal pagina de a 30 con el `Pagination` compartido (`components/ui/pagination.tsx`, el mismo de CAPA, PPA, MIPER, emergencias e inspecciones). Antes cortaba en 30 filas sin botón ni páginas: el "Mostrar las N" sólo existía en la vista anual, así que desde la actividad 31 no se podía ver ni registrar nada. Detalles:<br>• la página viaja en `?page=` con `router.replace(…, { scroll: false })`;<br>• cambiar el filtro de estado vuelve a la primera página;<br>• un `?page=` mayor que las páginas que quedan cae en la última;<br>• al cambiar de página, el scroll propio de la tabla (`stickyHeader`) vuelve arriba | `pdtp-sheet-table.tsx` |
| Desborde, tablero PDTP | **Arreglado en la capa compartida.** La copia móvil de las acciones de `PageHeader` ahora deja envolver también al `<div>` con que la página agrupa sus botones (`[&>div]:flex-wrap`). Diez páginas pasan `actions={<div className="flex items-center gap-2">…}`, y en `/prevencion/pdtp` ese div no envolvía: "Nuevo programa" se salía 7 px | `components/ui/page-header.tsx` |
| Desborde, inicio | `grid-cols-1` (= `minmax(0, 1fr)`) en la retícula del medidor PDTP y la "Tendencia Operativa". Sin columnas declaradas, la pista implícita es `auto` y crecía hasta el ancho fijo en px que recharts midió para el gráfico: 383 px de pista en un pozo de 358. La retícula es propia de esa vista; las demás del tablero ya declaran `grid-cols-1` | `app/(app)/dashboard/views/resumen-view.tsx` |

**Decisión:** la vista anual conserva su "Mostrar las N actividades" y no se pasó a `Pagination`. W8 pedía sólo la semanal, y la anual es una superficie de revisión donde "ver todo" es el uso normal. Queda una inconsistencia menor entre las dos vistas del mismo componente.

## Pruebas (rojo → verde)

| Prueba | Rojo observado | Verde |
|---|---|---|
| `pdtp-execution-form.test.tsx`: el diálogo muestra N° y nombre | 1 de 1 | ✓ |
| `pdtp-sheet-table.test.tsx` W8: más de 30 actividades pagina de a 30 y "Página siguiente" muestra la 31–35 | ✓ (rojo) | ✓ |
| ↳ W8: el filtro de estado vuelve a la página 1 | ✓ (rojo) | ✓ |
| ↳ W8: con 30 o menos no hay paginación | pasaba desde antes (guarda) | ✓ |
| ↳ I01/D29: `Actividad` (th y td) sin `sticky` y con `md:sticky`; N° sigue `sticky` | ✓ (rojo) | ✓ |
| ↳ I01: "Registrar" desde la fila abre el diálogo con N° y nombre | ✓ (rojo) | ✓ |
| `page-header.test.tsx`: las acciones móviles llevan `[&>div]:flex-wrap` | 1 de 1 | ✓ |
| **E2E nuevo** `e2e/pdtp-registrar-movil.spec.ts`, con fixture propio: hoja `pdtp_general` en `pdtp-prog-e2e` con 32 actividades planificadas en la semana en curso, borrada en `afterAll` | ver abajo | 4/4 |
| ↳ a 390 px, anual: `document.elementFromPoint` en el centro de "Registrar" devuelve el botón, tanto tras `scrollIntoViewIfNeeded` como con la tabla deslizada al máximo. Luego clic sin `force` y diálogo con "N°901" y el nombre | ver "I01 simulado" | ✓ |
| ↳ lo mismo en la vista semanal | — | ✓ |
| ↳ a 390 px, sin desborde del pozo del shell en `/prevencion/pdtp`, `/dashboard`, la planilla anual y semanal y `/prevencion/pdtp/actividades` | **rojo**, sobre la build con I01/W8 pero sin el arreglo de desborde: `["/prevencion/pdtp: 7px", "/dashboard: 9px"]` | ✓ |
| ↳ la semanal con 32 actividades muestra 30 filas; "Página siguiente" lleva a `?page=2` con 2 filas; la página sobrevive a un reload; la N°932 se puede registrar | — | ✓ |

**I01 simulado.** La primera build del servidor aislado ya incluía el arreglo de I01, porque el candado de recursos retrasó la compilación hasta después de la edición, así que el E2E de I01 no se vio en rojo contra una build del código anterior. La evidencia del estado anterior es:
- el rojo unitario de las clases;
- el informe de producción (`hitIsButton=false` en 0, 1/3, 1/2 y máximo);
- una simulación en el navegador: se volvieron a poner en línea `position: sticky; left: 3rem; z-index: 10` en la columna Actividad y se repitió la prueba de impacto. Con la tabla al máximo, el centro de "Registrar" cayó en `p "Charla de seguridad E2E"`, la actividad. Sin la simulación, el mismo punto cae en `button "Registrar"`.

## Desborde horizontal, antes y después

Medido con Playwright sobre el servidor aislado (`:3400`, base `bodega_i01_e2e`) con admin E2E. Se midieron dos cosas: `document.documentElement.scrollWidth − innerWidth` y `[data-shell-scroll].scrollWidth − clientWidth`. **El que importa es el pozo del shell**: el documento nunca desborda porque quien desplaza es el pozo.

| Ruta | 1440 antes | 1440 después | 390 antes (pozo) | 390 después (pozo) |
|---|---|---|---|---|
| `/prevencion/pdtp` | 0 | 0 | **7 px** (`div.flex items-center gap-2` de las acciones, "Nuevo programa") | 0 |
| `/prevencion/pdtp?anio=2026` | 0 | 0 | **7 px** | 0 |
| `/dashboard` | 0 | 0 | **9 px** (medidor PDTP y Tendencia Operativa, pista de 383 px) | 0 |
| `/prevencion/pdtp/pdtp-prog-e2e` | 0 | 0 | 0 | 0 |
| `/prevencion/pdtp/pdtp-prog-e2e?faena=ws-e2e&vista=anual` | 0 | 0 | 0 | 0 |
| `/prevencion/pdtp/actividades` | 0 | 0 | 0 | 0 |

En las columnas "antes", `documentElement` dio 0 en todas las rutas. En todas las mediciones de arriba hubo 0 errores de consola y 0 respuestas 5xx.

**Otras páginas, para verificar que el cambio de `PageHeader` no rompió nada** (390 px, después): `/pendientes`, `/compras`, `/recepcion`, `/entregas`, `/bodega`, `/prevencion/capa` y `/admin/usuarios` quedan en 0. `/solicitudes` y `/trazabilidad` siguen en 59 px, **igual que antes**. La causa es otra: la barra de `ServerPagination`, con seis botones de 44 px en móvil más las flechas. Queda fuera de este alcance.

## Hallazgo: `reflow-anchos.spec.ts` no ve el desborde del contenido

`e2e/reflow-anchos.spec.ts` mide sólo `documentElement`, y el contenido desplaza `[data-shell-scroll]`. Por eso la prueba está verde aunque haya desborde real. Se probó cambiarla para medir también el pozo, sobre la build previa al arreglo de desborde:

| Ancho | Desborde del pozo |
|---|---|
| 320 px | Dashboard 79 px, Solicitudes 129, Compras 21, Recepción 27, Trazabilidad 129, PDTP 77, Usuarios 20 |
| 390 px | Dashboard 9, Solicitudes 59, Trazabilidad 59, PDTP 7 |
| 768 px | 0 |
| 1024 px | Bodega 59 |

Ese cambio **se revirtió**: habría dejado rojo el gate por páginas ajenas a esta tanda. La regresión de las pantallas de esta tanda vive en el spec nuevo. **Recomendación:** endurecer `reflow-anchos` para que mida el pozo, en una tanda propia que arregle esas páginas. La probable causa común en Solicitudes, Trazabilidad y Bodega es `ServerPagination` en móvil. Tras el arreglo de `PageHeader` no se volvió a medir a 320 ni a 1024.

## Puertas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (también en el pre-commit de cada commit) |
| `npm run test:fast` | 774 archivos PASS / 32 omitidos; 10.094 pruebas PASS / 293 omitidas |
| `npm run test:pglite` | 212 archivos, 2.594 pruebas PASS |
| E2E `pdtp-*` + `prevencion-*` contra el servidor aislado en `:3400` (config temporal fuera del repo) | **171 PASS / 1 omitida** (`pdtp-habilitacion` "el CTA de una fila es alcanzable por teclado", omisión condicional preexistente), 0 fallos, 7,4 min. Incluye los 4 del spec nuevo |

## Sin verificar

- `npm run test:e2e` completo. Sólo se corrieron `pdtp-*` y `prevencion-*`.
- No se corrieron `db:verify-migrations`, porque no hay migraciones; ni `doctor`, `check:security-audit` o las suites `*-postgres`.
- WebKit y Safari real. Sólo se probó Chromium con viewport de 390 px.
- 320 px y 1024 px después del arreglo, en todas las páginas. En la franja de 640 a 1023 px las acciones móviles del `PageHeader` son `sm:shrink-0`, y ahí no se midió desborde.
- En `Pagination` (cliente) los botones miden 28 px de alto en móvil, debajo del objetivo táctil de 44 px que sí tiene `ServerPagination`. Se nota más ahora que la semanal pagina en terreno. No se tocó el primitivo.
- La inconsistencia entre la anual ("Mostrar las N") y la semanal (páginas).

## Conflictos esperables

- `pdtp-sheet-table.tsx`: el plan ordena T1 → T2 → I01/W8 → T6. Esta rama parte de la ola 3, que ya trae T6, así que un cambio posterior de T6 o T7 en la planilla chocará con los bloques de paginación semanal y la cabecera de la columna Actividad.
- `components/ui/page-header.tsx`: cambia una sola línea de clases del contenedor móvil de acciones.
- `app/(app)/dashboard/views/resumen-view.tsx`: cambian las clases de una retícula. Puede chocar con cambios del tablero de inicio.
- No toca `lib/services/pdtp/compliance.ts` ni `helpers.ts`.
