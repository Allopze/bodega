# Auditoría UI/UX — Espacio de trabajo MIPER (2026-10-04)

Superficie: `app/(app)/prevencion/miper/[id]` (pestañas Inicio, Riesgos, Plan de medidas, Revisión, Historial).

## Alcance y método

- **Capturas del usuario**: 5 pestañas de la MIPER «Biodiversa 2026» (230 riesgos, estado «Lista para enviar a revisión»).
- **Código**: `app/(app)/prevencion/miper/[id]/` y las primitivas que usa (`SummaryBar`, `Callout`, `EmptyState`, `TopBar`, `Tabs`).
- **Detector Impeccable** (`impeccable detect`): 0 hallazgos.
- **Navegador** (Chromium de `@playwright/test`, sesión QA, `next dev` en :3001) sobre la MIPER de dev «Oficina Central 2099» (222 riesgos, **todos con pendientes**): 5 pestañas × 1440 / 1280 / 1024 / 390 px; axe-core sobre `main` a 1440 px; 28 pulsaciones de Tab; consola y red.
- **Quedó sin recorrer**: editor de riesgo, vista de tarea, diálogos (Generar actividades, Nueva tarea, Ficha), menú «Más», roles de revisión técnica y Legal/RRHH, lector de pantalla real, perfil de rendimiento. El estado de dev (con pendientes) difiere del de las capturas («lista para enviar»): los hallazgos del estado «lista» salen de las capturas y del código.

## Puntaje

| # | Dimensión | Puntaje | Hallazgo clave |
|---|---|---|---|
| 1 | Accesibilidad | 3 | axe: 0 violaciones; fallan los objetivos táctiles en móvil y la jerarquía de encabezados |
| 2 | Rendimiento | 3 | Sin errores de consola ni requests fallidos; no se perfiló (evidencia limitada) |
| 3 | Responsive | 2 | Sin overflow horizontal, pero a 1024 px la cabecera ocupa 3 filas y trunca el título; en móvil el contenido empieza bajo el primer pantallazo |
| 4 | Theming | 3 | Tokens en casi todo; un borde sin token |
| 5 | Integridad de implementación | 2 | Detector limpio, pero primitivas usadas fuera de su propósito y helpers compartidos ignorados |
| **Total** | | **13/20** | **Aceptable: requiere trabajo significativo** |

**Veredicto de integridad: aprobado con deriva.** El sistema es coherente (PageHeader, PageContainer, Callout, SummaryBar, EmptyState y tokens se reutilizan; el detector no encuentra nada), pero en varios puntos una pieza compartida se fuerza a un uso para el que no fue hecha, o se ignora el helper que ya resolvía el problema (`useWorksiteFilterPresence`, `countOf`, `--color-border`).

**Resumen**: 25 hallazgos — P0: 0 · P1: 5 · P2: 10 · P3: 10.

## P1 — Mayores

### 1. «Tu faena: Oficina Central» contradice la faena del documento — confirmado
- **Dónde**: `components/layout/top-bar.tsx:173`, `app/(app)/prevencion/miper/[id]/worksite-switcher.tsx:32`.
- **Problema**: el título dice «Biodiversa 2026» y la cabecera muestra «Tu faena: Oficina Central» pegado a «Cambiar de faena». Se lee como que la pantalla muestra Oficina Central, o que el selector cambia ese chip. El TopBar ya resuelve esto: oculta el chip cuando la vista declara un selector de faena con `useWorksiteFilterPresence()`, y su propio comentario describe esta misma confusión. `WorksiteSwitcher` no lo llama. El botón tampoco dice qué faena se está viendo. Contradice el principio 4 de PRODUCT.md.
- **Arreglo**: llamar `useWorksiteFilterPresence()` en `WorksiteSwitcher` y rotular el disparador con la faena actual («Biodiversa · 2026 ▾»).

### 2. El estado vacío de «Plan de medidas» ofrece la acción equivocada — confirmado
- **Dónde**: `program-panel.tsx:186` (CTA) y `:192` (filtros).
- **Problema**: el texto dice que el programa «se crea al generar las actividades o al agregar la primera», pero el botón es «Completar antecedentes». Las acciones que describe el texto están en la cabecera. Debajo del vacío aparecen un buscador y dos selects para filtrar una lista que no existe.
- **Arreglo**: CTA «Generar actividades desde las medidas» + secundaria «Agregar una actividad». Si los antecedentes son requisito previo, decirlo en el texto. Ocultar los filtros mientras no haya actividades.

### 3. «Actividades» significa dos cosas y el plan tiene tres nombres — confirmado
- **Problema**: en Inicio, «Ver actividades y tareas» (actividades del RE-04: GESTION DOCUMENTAL…) está junto a la cifra «Sin actividades programadas» (acciones del programa), con 44 actividades listadas justo debajo. «Generar actividades» y «Nueva actividad» reutilizan la palabra. El mismo objeto se llama «Plan de medidas» (pestaña), «Programa de Trabajo» (vacío, subtítulo) y «programa» (cifra).
- **Arreglo**: reservar «actividad» para el RE-04 y llamar «acciones» a las del plan («Generar acciones», «Nueva acción», «Avance del plan»). Un solo nombre para el plan; «Programa de Trabajo RE-04.1» una vez, como referencia.

### 4. La Bitácora queda enterrada por la importación — confirmado
- **Dónde**: `lib/services/miper/import.ts:517` y `:543`; `history-panel.tsx:87`; `lib/prevention/miper/history-labels.ts:44`.
- **Problema**: la importación escribe un evento `import_applied` por fila (230) más uno por matriz: 231 líneas idénticas «Filas importadas desde el RE-04 · misma persona · mismo minuto». Cualquier evento real (envío, devolución) queda páginas más abajo. El evento de UNA fila usa el rótulo plural «Filas importadas». Las filas son `flex-wrap`, no columnas: con eventos de largo distinto, la columna de autor se desalinea.
- **Arreglo**: agrupar en el panel los eventos consecutivos del mismo tipo, autor y minuto («230 filas importadas desde el RE-04», expandible), o mostrar sólo el evento de la matriz. Rótulo singular para el de fila. Grilla de 3 columnas.

### 5. Cabecera sobrecargada y distinta en cada pestaña — verificado en navegador
- **Problema**: 6–7 controles (chip, Cambiar de faena, Nueva tarea o Generar actividades + Nueva actividad, Ficha del documento, Enviar a revisión, Más), y el conjunto cambia por pestaña. En Plan de medidas hay dos primarios rellenos («Nueva actividad» y «Enviar a revisión»). A 1024 px (sidebar abierto) en Plan de medidas los botones ocupan 3 filas (cabecera de 130 px) y el título queda en «Matriz de riesg…». A 390 px, título + 2 filas de botones + aviso con 2 botones apilados empujan el primer riesgo a ~830 px.
- **Arreglo**: un solo primario por vista; la faena como selector en el título o breadcrumb (resuelve también el n.º 1); «Ficha del documento» dentro de «Más»; las acciones propias de una pestaña, dentro de la pestaña.

## P2 — Menores

6. **Una frase en el espacio de la cifra.** «Sin actividades programadas» se pinta en Geist Mono 22 px semibold (`resumen-panel.tsx:76`, `components/ui/summary-bar-stat-cell.tsx:24`): 2 líneas en escritorio, 3 en móvil. Arreglo: un modo vacío en `SummaryStat` que muestre la acción en sans («Generar acciones →»), como pide A1.
7. **Aviso «Lista para enviar a revisión» redundante y contradictorio** (`lib/prevention/miper/next-step.ts:64`). Aparece en Inicio, Riesgos y Revisión; «Ir a Revisión» duplica la pestaña y el «Enviar a revisión» de la cabecera; el texto dice «Lista…» y luego «envíalo cuando esté listo». Como no aparece en Plan de medidas ni Historial, las pestañas saltan ~105 px al cambiar. Arreglo: que el aviso lleve «Enviar a revisión» o eliminarlo; texto «No quedan datos obligatorios. Ya puedes enviarla a revisión técnica»; un lugar estable.
8. **Revisión manda a la cabecera para su acción principal**: «Después usa «Enviar a revisión» en la cabecera» (`review-panel.tsx:171`); lo mismo para quienes revisan. El paso a paso (`:161`) es texto plano: la etapa actual sólo se distingue por color y peso, sin ✓ en las cumplidas ni conectores.
9. **«Recorrer la MIPER» es ambiguo** (`review-panel.tsx:67`): «Importantes e Intolerables (46)» es un enlace con forma de chip; «Sin observados» es texto gris que parece un chip deshabilitado; justo debajo, «Sin observaciones» parece parte del mismo bloque. Arreglo: chips consistentes («Observados (0)» deshabilitado) y un encabezado «Observaciones» propio.
10. **Muro de barras al 100 %** en «Datos completos por actividad» (`resumen-panel.tsx:90`): con todo completo son 44 barras llenas que no informan nada. Los extremos no se alinean porque la columna del conteo es `auto`. Arreglo: una línea cuando todo está completo; si no, primero las incompletas; columna de conteo de ancho fijo.
11. **Pendientes por actividad: ruido con 0, invisibles con >0** (`activity-section.tsx:35`): cada grupo dice «0 riesgos con datos pendientes»; con pendientes el texto sigue gris (verificado en dev). El grupo cuenta pendientes y la tarea cuenta completos. Arreglo: nada (o ✓) con 0, `signal-ink` con >0, la misma medida en ambos niveles.
12. **Plurales rotos** (`activity-section.tsx:23`, `:35`, `:47`): «1 tarea · 1 riesgos», «1 riesgos con datos pendientes», «observado(s)», «modificado(s)». Visible en ≥15 actividades. `countOf` ya existe en `lib/utils`.
13. **Barra de Riesgos repartida en 3 filas** (`summary-strip.tsx:25`, `matrix-view.tsx:60`): «Ver resultados de riesgos» es un ghost que parece texto y no dice que cambia a lista plana; «Datos del documento» (un `<details>` nativo con ▶) y «Ficha del documento» son dos nombres y dos lugares para lo mismo. Arreglo: control segmentado «Por actividad | Lista de riesgos» junto a la búsqueda; «Contraer todo» y «Seleccionar» en la misma fila; unificar los datos del documento con la ficha.
14. **Objetivos táctiles < 44 px en móvil** (medido a 390 px): enlaces de actividad en Inicio, 19 px de alto; «Datos del documento», 16 px; chips de Revisión, 29 px; «N riesgos con datos pendientes», 27 px.
15. **46 riesgos «exigen seguimiento» y el documento está «listo»** — hallazgo funcional, no bug. El validador sólo exige acción en el plan para los Intolerables (`requireProgramLink`) y esta MIPER no tiene ninguno; la pantalla no explica por qué 46 Importantes con el plan vacío no bloquean. Requiere decisión de producto (p. ej. «46 · 0 con acción en el plan»).

## P3 — Pulido

16. **Redacción**: «del MIPER» junto a «Esta MIPER» en el mismo vacío (18 usos masculinos contra 34 femeninos en el módulo); «Ésta es la única…» → «Esta»; «Sin observados»; «Ninguno marcado No» y ««¿Está controlado?» en No» (`resumen-panel.tsx:72`) muestran el campo en vez del significado.
17. **El subtítulo cambia de naturaleza por pestaña** (`miper-workspace.tsx:160`): código, instrucción, y en Plan «Programa de Trabajo RE-04.1» cuando el cuerpo dice que no existe.
18. **Alturas mezcladas en la cabecera**: «Generar actividades» y «Nueva actividad» son `size="sm"` (30 px) junto a botones de 34 px (`program-panel.tsx:66`).
19. **Regla negra bajo el resumen de Riesgos**: `border-b` sin color usa `currentColor` en Tailwind v4 (medido ≈ negro); el resto de divisores usa `--color-border` (`summary-strip.tsx:17`).
20. **Encabezados**: las actividades son H2 hermanas de «Por actividades y tareas»; `EmptyState` emite H2 dentro de secciones H2; el nombre accesible del H2 de actividad incluye los conteos.
21. **Dos bordes izquierdos** en pantallas anchas con sidebar plegado: título del TopBar en x≈16, contenido `workbench` en x≈150. Es del shell, no de esta página.
22. **Datos importados en MAYÚSCULAS y sin tildes** («GESTION», «REPARACION»). Oportunidad: normalizar en la importación, conservando el original.
23. **«+1» en la fila de tarea** se lee como un tercer dato; sin tooltip con los otros puestos.
24. **Historial**: los dos estados vacíos lado a lado usan el padding grande; ~150 px en blanco antes de la Bitácora (`compact`).
25. **Pestañas sin contadores** (A5): «Riesgos 230», «Plan de medidas 0».

## Lo que funciona

- axe-core: 0 violaciones en `main` en las 5 pestañas; foco visible (outline 2 px) en los 28 tabs recorridos; tablist Radix; `aria-current="step"`; skip link.
- 0 errores de consola, 0 requests fallidos, sin overflow horizontal en 1440/1280/1024/390.
- Las cifras de Inicio son enlaces a su subconjunto (A1) y los ceros se atenúan.
- Un solo «siguiente paso» calculado por reglas (`next-step.ts`), en vez de avisos sueltos.
- «Enviar a revisión» con pendientes abre un diálogo que lista cada dato faltante y lleva a donde se corrige.
- Estado en la URL con `replace` y sin scroll; búsqueda propia rotulada y la de la shell oculta.

## Patrones sistémicos

- **Vocabulario**: una palabra con dos significados (actividades) y un objeto con varios nombres (plan/programa; ficha/datos del documento).
- **Primitivas forzadas**: una frase en la celda numérica de `SummaryBar`; un `<details>` nativo donde el resto usa carets Phosphor.
- **Helpers compartidos ignorados**: `useWorksiteFilterPresence`, `countOf`, `--color-border`.
- **Acciones lejos de la decisión**: textos que mandan a la cabecera en vez de poner el botón donde se decide.

## Acciones recomendadas

1. **[P1] `/impeccable clarify`**: vocabulario (actividades vs. acciones, un nombre para el plan), CTA del plan vacío, texto del aviso, cifras de «No controlados», plurales y gramática.
2. **[P1] `/impeccable distill`**: cabecera con un primario, faena como selector en el título (+ `useWorksiteFilterPresence`), acciones de pestaña dentro de la pestaña, aviso redundante.
3. **[P1] `/impeccable harden`**: agrupar la importación en la Bitácora, ocultar los filtros del plan vacío, pendientes con 0 y con >0.
4. **[P2] `/impeccable layout`**: barras al 100 % y su alineación, barra de Riesgos en una fila, salto de pestañas, Revisión con su acción y su paso a paso.
5. **[P2] `/impeccable adapt`**: cabecera de 3 filas a 1024 px, primer pantallazo móvil, objetivos de 44 px.
6. **[P2] `/impeccable typeset`**: frase en la cifra mono, mayúsculas importadas, jerarquía de encabezados.
7. **`/impeccable polish`** al final.

---

## Implementación (2026-10-04, rama `fix/miper-workspace-ui-audit`)

Decisiones de producto tomadas antes de implementar:

- **Vocabulario (n.º 3)**: se mantiene «actividad» —es la columna oficial del RE-04 y del RE-04.1 («ACTIVIDAD / MEDIDA») y la usan las notificaciones— y se califica donde choca: «Ver riesgos», «Avance del plan», «plan de medidas (Programa de Trabajo RE-04.1)».
- **Importantes sin plan (n.º 15)**: sólo se informa («Exigen seguimiento · N con actividad en el plan»); la regla de envío no cambia.
- **Decisión en Revisión (n.º 8)**: los botones de decisión siguen sólo en la cabecera (ponerlos también en el panel daba dos primarios y una cabecera distinta por pestaña, lo contrario del n.º 5); el texto ya no manda «a la cabecera».

| N.º | Estado | Qué se hizo |
|---|---|---|
| 1 | Hecho | `WorksiteSwitcher` declara `useWorksiteFilterPresence()`; el chip «Tu faena» ya no aparece en la MIPER. |
| 2 | Hecho | Vacío del plan con CTA «Generar actividades desde las medidas» (+ «Completar antecedentes»); filtros ocultos sin actividades. |
| 3 | Hecho (calificado) | Ver decisión arriba. «del MIPER» → «de la MIPER» en el programa, el generador y la importación. |
| 4 | Hecho | Bitácora agrupa rachas iguales (`lib/prevention/miper/history-groups.ts`): «N filas importadas desde el RE-04», «12 riesgos modificados»; rótulo singular por fila; columnas alineadas. El conteo refleja los eventos cargados (páginas de 50). |
| 5 | Parcial | Sin chip; un solo botón «Agregar actividades ▾» (regla A3) y un solo primario. A 1024 px en Plan la cabecera bajó de 3 a 2 filas, pero el título sigue truncado (el piso `min-w-32` del TopBar es del shell). En móvil los botones de cabecera siguen ocupando el primer pantallazo. |
| 6 | Hecho | `SummaryStat.valueKind: "text"`: «Aún sin actividades» en sans 15 px. |
| 7 | Hecho | Aviso «Lista para enviar» sin botón y fuera de Revisión; los avisos van bajo las pestañas: la fila de pestañas queda en y=84 en las 5 pestañas (1440 px). |
| 8 | Hecho | Textos sin «cabecera»; paso a paso con ícono por estado (✓ cumplida, ● actual, ○ pendiente) y conectores. |
| 9 | Hecho | Chips con el mismo molde («Observados (0)» inactivo) y sección propia «Observaciones». |
| 10 | Hecho | Una línea cuando todo está completo; columna de conteo fija (barras alineadas). |
| 11 | Hecho | «Completa» con ✓ o «N riesgos con datos pendientes» en `signal-ink`; la tarea usa la misma medida. |
| 12 | Hecho | `countOf` en actividad, tarea y franja («1 tarea · 1 riesgo»). |
| 13 | Hecho | Control segmentado «Por actividad / Lista de riesgos»; «Contraer todo» junto a la lista; «Datos del documento» con caret Phosphor (se conserva: resume autor/versión, distinto de la ficha editable). |
| 14 | Hecho | 44 px en móvil en Inicio, Riesgos y Revisión; `SegmentedControl` (compartido) también. |
| 15 | Hecho (informativo) | Ver decisión arriba. |
| 16 | Hecho | «Esta», «Ninguno marcado como no controlado», «Marcados como no controlados», género de «la MIPER». |
| 17 | Hecho | Subtítulo estable «Borrador · MIPER RE-04». |
| 18 | Hecho | Botones de cabecera a 34 px. |
| 19 | Hecho | `border-[var(--color-border)]`. |
| 20 | Hecho | Actividades como h3 con nombre = rótulo; estados vacíos como `p`. |
| 21 | No hecho | Es del shell (TopBar vs. `PageContainer`) y afecta a todas las páginas. |
| 22 | No hecho | Normalizar mayúsculas es un cambio de datos en la importación. |
| 23 | Hecho | «y 1 puesto más» + `title` con todos los puestos y lugares. |
| 24 | Hecho | Estados vacíos compactos en Historial. |
| 25 | No hecho | Tras los arreglos, el pendiente ya se ve en el aviso y en la franja; un contador en la pestaña lo repetiría (A5). |

Encontrado y corregido durante la verificación:

- Al cerrar un diálogo abierto desde el menú «Agregar actividades», el foco caía al `body`; ahora vuelve al disparador (`returnFocusRef`).
- La franja de Riesgos decía «1 riesgos» con un solo riesgo.
- `ProgramActionDialog` reinicia el formulario durante el render al abrirse (antes, en el manejador; un efecto pintaba un cuadro con valores viejos).

Visto y no cambiado (fuera de alcance):

- Abrir «Generar actividades» crea el Programa de Trabajo (`ensureProgram` en `proposeProgramActions`) aunque se cancele. Comportamiento previo; durante esta verificación creó el programa de la MIPER de dev «Oficina Central 2099».
- «Datos del programa» (encabezado RE-04.1) mide 19 px en móvil.
- «Descartar borrador», abierto desde «Más», probablemente tiene la misma pérdida de foco (no verificado).

### Verificación

- `npm run typecheck`: limpio. ESLint sobre los archivos cambiados: limpio.
- `npm run test:fast`: 886 archivos / 11.226 pruebas pasan (31 archivos omitidos, ya omitidos antes: requieren Postgres).
- Navegador (Chromium, `next dev` :3001, MIPER de dev con 222 riesgos pendientes): 5 pestañas a 1440, 1024 y 390 px; axe-core 0 violaciones en `main`; 0 errores de consola; 0 requests fallidos; sin overflow horizontal; menú y ambos diálogos; foco de vuelta al disparador; sin objetivos < 44 px en móvil en Inicio, Riesgos y Revisión.
- E2E (worktree desechable, contenedor `bodega-e2e-postgres`): `prevencion-miper-uiux-desktop`, `-revision-lectura`, `-flujo`, `-matriz` y las pruebas MIPER de `accessibility.spec` pasan; `-programa` (8/8) y `-escenario` (10/10) pasan tras actualizar tres expectativas que verificaban textos cambiados a propósito («Riesgos 1, 2 de la MIPER», el aviso «Lista para enviar» que ya no se repite en Revisión, y la línea única de «Datos completos por actividad» cuando todo está completo).
- No verificado en navegador: el estado «lista para enviar» y «todas las actividades completas» (la base de dev no tiene una MIPER así; cubiertos por pruebas unitarias), y los roles de revisión técnica y Legal/RRHH.

---

## Segunda pasada: harden, adapt y polish (2026-10-05)

La primera implementación aplicó los hallazgos en un solo plan; esta pasada siguió el procedimiento de cada comando sobre el resultado.

**Harden**

- Bitácora: el grupo que toca el borde de la página cargada (50 eventos) dice «N o más …»; ya no afirma un número que no conoce.
- «Descartar borrador», abierto desde «Más»: al cancelar, el foco caía al `body`; ahora vuelve a «Más» (`ConfirmDialog.returnFocusRef`, opcional). La prueba de regresión falla sin el arreglo.
- Copia del plan vacío alineada con el servicio: «Se crea al empezar a generar…». Abrir el generador crea el programa (`ensureProgram` en `proposeProgramActions`); es decisión documentada del spec §7.3, no se cambió.
- «Datos del programa»: 44 px en móvil y el mismo caret que «Datos del documento».
- Rótulos de actividad y tarea con `break-words`: un nombre largo sin espacios no desborda en móvil.

**Adapt** (Chromium, viewports emulados; sin dispositivo físico ni gestos táctiles probados)

- 1024 px: bajo xl los rótulos visibles se acortan («Faena», «Ficha», «Agregar»; el nombre accesible no cambia). El título «Matriz de riesgos · Oficina Central 2099» se lee entero y la cabecera queda en una fila en las tres pestañas medidas (antes: título truncado y hasta 3 filas en Plan).
- 768 px y 844×390 (horizontal): una fila de acciones, sin overflow.
- 390 px: dos filas de botones de 44 px. Se dejó así: juntar buscador y «Más filtros» exigía cambiar la alineación del `FilterToolbar` compartido.
- Observación de sistema (no cambiada): en tablet y móvil horizontal (≥ 640 px) los botones y pestañas usan la densidad de escritorio (31–34 px) aunque la entrada sea táctil; el `Button` decide por ancho, no por `pointer: coarse`.

**Polish**

- Un concepto, un nombre: «Avance del plan» también en el encabezado del plan (la cifra de Inicio lleva ahí), «Generar actividades desde las medidas» como título del generador (igual que el menú y el CTA), «Este plan todavía no tiene actividades». Los campos formales del RE-04.1 («Encargado del programa», etc.) se mantienen.
- «Volver a la lista» (`sr-only`) era un paso de teclado invisible después de «Más» (WCAG 2.4.7): ahora aparece al recibir foco.
- Espaciado: «Ficha del documento» y «Agregar actividades» mostraban un hueco doble (el `span` oculto era un ítem flex aparte).
- Verificado: orden de Tab de la cabecera = orden visual, con foco visible; 0 errores de consola; `impeccable detect` (general, layout y tipografía) sin hallazgos; 730 pruebas unitarias del área; `typecheck` y ESLint limpios.
