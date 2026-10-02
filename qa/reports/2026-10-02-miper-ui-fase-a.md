# Verificación — MIPER sin planilla, Fase A (2026-10-02)

Alcance: `/prevencion/miper/[id]`, pestaña **Matriz** (estructura › tarea › editor del riesgo de
cuatro pasos), rama `feat/miper-ui-sin-planilla`. Recorrido asistido **acotado** a ese flujo;
no es una auditoría de la aplicación ni afirma cobertura total.

## Entorno y datos

- `next dev` :3001 desde este checkout, `bodega_dev`. Antes de empezar,
  `drizzle.__drizzle_migrations` (350 filas, último `created_at` 1790948785075) coincidía con el
  journal (350 entradas, último `when` 1790948785075): sin migraciones atrasadas.
- Chromium de `@playwright/test` con la sesión QA (`playwright/.auth/monkeytest.json`), viewports
  1440×900 y 390×844. No se imprimieron cookies.
- MIPER: borrador «Oficina Central 2099» (`QA_…`), 222 riesgos, 42 tareas, ninguna medida.
- Las E2E **no** se corrieron en esta pasada (`e2e/start-server.sh` hace `rm -rf .next` y
  rompería el `next dev` del usuario); se corrieron en verde en la Tarea 12.

## PASS (verificado en navegador)

| Comprobación | Medición |
|---|---|
| Sin scroll horizontal de página en estructura, tarea y editor (los 4 pasos) | `scrollWidth` = `innerWidth` en 1440 (1440/1440) y en 390 (390/390), en todas las vistas |
| Sin contenedores desbordados a 1440 | 0 contenedores con `overflow-x: auto/scroll` y contenido mayor; sólo el `sr-only` del `PageHeader` (oculto a propósito) |
| Controles en la vista de estructura | **16** (portada → MIPER) y **54** (carga directa, tarjetas expandidas); criterio < 400 (antes 4.716). Tarea: 29; editor: 35–48 según el paso. Con búsqueda activa: 43 |
| Portada → MIPER → tarea → riesgo → pasos → volver | Navega; sin errores de consola ni respuestas ≥ 400 |
| `_rsc` en la navegación interna (Task 11) | **0** peticiones `_rsc` al abrir tarea, riesgo, cambiar de paso, volver, abrir/cerrar la ficha, cambiar a Programa/Revisión/Historial/Matriz, buscar, filtrar, «Contraer/Expandir todo» y «Siguiente pendiente». La única `_rsc` observada es la de la creación de un riesgo (`router.push` + `POST` de la acción) y la del `router.refresh()` al guardar una medida |
| Latencia de «Siguiente pendiente» (Task 8) | 96 ms (1440, sin filtro), 115 ms (1440, con búsqueda + clasificación, que se conservan en la URL) y 94 ms (390). Medido desde el clic hasta que cambia la URL y el pie del editor sigue montado (incluye el sondeo de Playwright, así que es una cota superior). Abrir una tarea: 81–89 ms; abrir un riesgo: 74–86 ms |
| Riesgo #25 (Importante, sin medidas) → «Agregar medida» → guardar → «Siguiente pendiente» | Abre en el paso Medidas (primer paso con pendientes); la medida se guarda y aparece la tarjeta; «Siguiente pendiente» salta a otro riesgo sin salir del editor y sin scroll lateral. La medida de prueba se eliminó después |
| Error de guardado forzado (mismo riesgo en dos pestañas) | La pestaña B guarda («Guardado a las 19:21»); la A, al editar Peligro, muestra «No se guardó: La fila cambió mientras la editabas…», el mensaje bajo el campo (`role="alert"`), el valor del campo **revertido** y el botón «Recargar riesgo» |
| Crear («Nueva tarea» con `QA_ Verificación UI` / `QA_ Tarea de prueba`) | El diálogo crea el riesgo y abre el editor en «Identificación» en ~0,6 s; **sin esqueleto** (los únicos `aria-busy` fueron el spinner del botón «Crear tarea», 3 de 60 cuadros) y 1 `_rsc` (la del propio `router.push`). Se le agregó una medida |
| Eliminar («Más» → «Eliminar riesgo») | Pide confirmación y, al ser el único riesgo de su tarea, **vuelve a la matriz**; el texto `QA_ Verificación UI` ya no aparece. Hecho tres veces (ronda inicial con el conflicto de dos pestañas y dos repasos del esqueleto) |
| Recuento en BD (solo lectura) | `prevention_risk_entries`: 222 antes → 222 después. `prevention_risk_controls`: 0 → 0 |
| Búsqueda y filtros en la URL | `?buscar=…&clasificacion=moderate` se aplican sin `_rsc`; chip removible «Búsqueda: «atrapamiento»» y «Limpiar filtros»; bajo filtro aparecen sólo los riesgos que coinciden («24 de 163 riesgos») |
| «Siguiente pendiente» con filtros activos | Recorre sólo el conjunto filtrado y conserva `buscar=` y `clasificacion=` en la URL |
| Consola y red | 0 errores de consola; 0 respuestas ≥ 400 (descontado el avatar de dicebear, ruido conocido) en todas las pasadas |

## Hallazgos

### PRODUCT BUG

Ninguno confirmado. No se modificó código de la aplicación.

### UX FINDING

1. **Tira de pasos en 390 px.** Los cuatro pasos no caben en una fila: la tira tiene scroll interno
   (612 px en 358 px), y al abrir en el paso 3 el paso 1 queda recortado (sólo se ve su «✓»).
   El scroll es interno al contenedor (la página no se desborda), pero la numeración 1–4 pierde
   sentido si no se ve el 1. Lo mismo, con menos gravedad, con la tira Matriz/Programa/Revisión/
   Historial («Historial» queda pegado al borde).
2. **Marcas «Nueva» y «modificado(s)» en todo.** En un borrador sin versión aprobada los 222
   riesgos aparecen como «Nueva» y cada actividad dice «N modificado(s)». No hay línea base, así
   que la marca no informa y compite con «N pendientes».
3. **«Recarga la matriz» junto a «Recargar riesgo».** El mensaje de conflicto lo escribe el
   servicio («Recarga la matriz para ver el cambio de la otra persona») y el botón del editor
   dice «Recargar riesgo». Es un solo gesto con dos nombres.

### INCONSISTENCY

1. Spec §5.1 y manual nombraban el cajón «Filtros (N)» y la acción «Quitar filtros»; la pantalla (`FilterToolbar`) muestra «Más filtros» con contador, el cajón «Filtros avanzados» y «Limpiar filtros». **Resuelto** alineando el manual y el spec a la pantalla.
2. Rótulos de «Siguiente pendiente»: es botón-enlace en el pie del editor y texto de la tarjeta
   «Siguiente paso» («Empezar por el más grave»); misma acción, dos nombres.

### FUNCTIONAL FINDING

- **Los nombres creados desde «Nueva tarea» quedan en los diccionarios del centro.** Tras eliminar
  el riesgo, `QA_ Verificación UI` (actividad), `QA_ Tarea de prueba` (tarea) y `QA_ Puesto`
  (puesto) siguen en `prevention_risk_processes/tasks/positions` (1 fila cada una) y aparecerán
  como sugerencia en los autocompletados de la faena. Es el comportamiento heredado del catálogo
  (los nombres no se borran con el último riesgo), pero ensucia las sugerencias después de un
  alta equivocada. No se limpió: esta pasada no escribe en la BD fuera de la aplicación.

### AUTOMATION WARNING

- Un primer script de limpieza declaró eliminada la medida de prueba aunque la acción no había
  terminado (cerré el navegador antes de que llegara la respuesta; `prevention_risk_controls`
  quedó en 1). No fue un defecto de la aplicación: repetido con espera, el borrado funciona
  («Medida eliminada») y el recuento volvió a 0.
- En 390 px el indicador de desarrollo de Next.js (círculo «N») se superpone al botón «Siguiente
  pendiente». Sólo existe en `next dev`.
- La versión de las pestañas (`Matriz`, `Programa`…) arrastra los filtros de la matriz en la URL
  (`…&tab=programa`); es inocuo, pero llena los enlaces. No se clasifica como defecto.

### IMPROVEMENT OPPORTUNITY

- Mostrar la vista de estructura con menos de 54 controles es posible colapsando por defecto las
  actividades; hoy la carga directa las expande todas (54, muy lejos del tope de 400).

## COVERAGE GAP

- **Modo revisión y solo lectura:** `bodega_dev` sólo tiene una MIPER, en borrador, que no se puede
  enviar sin completar 222 riesgos, y no hay una MIPER reemplazada ni «metodología anterior».
  Esas vistas (Jefa en ronda abierta, Legal y RRHH, lectura) sólo las cubren las E2E
  (`prevencion-miper-flujo`, `prevencion-miper-escenario`) y las pruebas unitarias; no se
  recorrieron a mano. El usuario `jefa.prevencion@e2e.chome.cl` pertenece a la base E2E, no a
  `bodega_dev`.
- **Programa, Revisión e Historial** sólo se abrieron como pestañas (cambian la URL sin errores);
  su contenido se rediseña en la Fase E y no se evaluó.
- **Importar, «Descargar vN (Excel)», envío/aprobación y «Ir a Revisión»:** no recorridos.
- **Ficha del documento:** sólo se verificó que abre como diálogo con `?ficha=1`; no se guardó.
- **Teclado y lector de pantalla:** sin recorrido manual (no se midió foco visible ni orden de
  tabulación del editor).
- **Un solo MIPER, un solo usuario (admin QA)**; no se probaron permisos reducidos.
- **Resoluciones intermedias** (768–1280 px): sólo 1440 y 390.
- Los números de la Tarea 8 y de esta pasada son de `next dev` (sin compilar a producción); en
  producción serán menores.

## Compuertas

`npm run typecheck`, `npm run lint`, `npm run check:secrets` y `npm run doctor`: verdes. `npm run test:fast`: 842 archivos pasan (31 omitidos), 10.702 pruebas pasan (272 omitidas). `test:pglite` y `db:verify-migrations` no se corrieron: no hay cambios de servicio ni de esquema.

## Recomendaciones priorizadas

1. Decidir el rótulo único de «Siguiente pendiente» (los rótulos de filtros ya se alinearon a la pantalla).
2. Ocultar «Nueva»/«modificado» cuando no hay línea base de comparación.
3. En 390 px, mostrar sólo el paso activo («Paso 3 de 4») o hacer que la tira se centre en el
   paso activo sin dejar el 1 recortado.
4. Unificar «Recargar riesgo» con el texto del mensaje de conflicto.
5. Antes de la Fase E, repetir el recorrido de revisión/solo lectura sobre una MIPER enviada del
   seed E2E.

---

## Ronda final de correcciones (revisión de la rama, 2026-10-02)

Corrige los hallazgos de la revisión final de la rama: C1, I1, I2 y seis menores. Commits
`9cdbeacc..6244bd3b` y este informe. Igual que arriba, el recorrido es **acotado** a la matriz.

### PASS (verificado)

| Comprobación | Evidencia |
|---|---|
| **C1** «atrás» tras «Agregar peligro» (sonda en `:3001`, borrador «Oficina Central 2099», tarea «GESTION DOCUMENTAL › TRABAJO ADMINISTRATIVO») | Se guardó «Expuestos (otro)» del riesgo #1 (0 → 1), «Agregar peligro» y luego Atrás. La tarea muestra **5** riesgos (antes 4) y el riesgo #1 muestra **1**. «Atrás» pidió la foto nueva al servidor: 3 GET RSC. Antes del cambio la tarea quedaba en 4 y el riesgo #1 en 0. |
| C1 en E2E | `interacciones` «atrás después de Agregar peligro…» pasa. Sobre el código previo (worktree con `app/(app)/prevencion/miper` de `5cf18c63`) **falla**: la tarea queda en «Peligros identificados (1)» y el riesgo muestra «Sin riesgo ni daño». |
| **I2** volver a la matriz (sonda en `:3001`, 222 riesgos) | Se plegó «GESTION DOCUMENTAL», el pozo quedó en scrollTop 1400, se abrió una tarea y luego Atrás. Vuelve con scrollTop **1400** y la actividad sigue plegada. La E2E equivalente pasa y, sobre el código previo, falla porque la actividad vuelve desplegada. |
| Recuento en BD (solo lectura) | `prevention_risk_entries` de la matriz: 222 → 222. `exposed_other` del riesgo #1 volvió a 0 y los riesgos de prueba se eliminaron con «Eliminar riesgo». Quedan como auditoría tres pares de eventos crear/eliminar en el historial y la versión del riesgo #1 subió de 3 a 9 (dos guardados por corrida). `prevention_risk_controls` de la matriz: 0. |
| Consola | 0 `console.error` en las sondas. |

### Las `net::ERR_ABORTED` del escenario (investigadas)

Se instrumentó una copia de `prevencion-miper-escenario.spec.ts`. Fue una copia temporal en el
worktree desechable, sin versionar. Registró método, `next-action`, `RSC`, `Next-Router-Prefetch`,
la respuesta recibida y las navegaciones de la página, y se corrió dos veces con `--trace on`.
En la última corrida hubo **196** peticiones abortadas:

- **156 GET de prefetch** (`Next-Router-Prefetch: 1`) del menú y de los enlaces de la página,
  descartados al navegar.
- **30 GET RSC de navegación** que Next reemplazó por otra, por ejemplo el `router.push` posterior
  a crear un riesgo, que compite con la foto que trae la acción.
- **1 GET de documento**: la descarga del Excel, que el navegador convierte en descarga.
- **9 POST de server actions**: `saveMiperControlAction`, `saveMiperEntryAction` (sólo al
  **crear**), `applyProgramGenerationAction`, `submitMiperAction`, `addMiperObservationAction`,
  `returnMiperAction`, `approveMiperTechnicalAction`, `approveMiperFinalAction` y
  `openMiperRoundAction`.
  - **Todos** recibieron `200` antes de abortarse. Los 8 que revalidan traían
    `x-action-revalidated: 1`, un encabezado que el servidor sólo emite después de ejecutar la
    acción (y `guarded()` revalida después de la escritura).
  - Lo que se corta es la cola del cuerpo: el re-render RSC que acompaña a la respuesta. En cada
    caso, entre 4 y 23 ms después hubo una navegación de Next a la misma URL, que confirma el
    estado nuevo y descarta el resto del cuerpo.
  - **Ningún guardado de campo** (`saveMiperEntryAction` con `entryId`, que no revalida) se abortó.
  - Las aserciones posteriores del escenario confirman cada dato persistido.

**Clasificación: AUTOMATION WARNING, no PRODUCT BUG.** Son cancelaciones internas del router
de Next, no guardados perdidos por una navegación. No hizo falta vaciar los guardados pendientes
antes de navegar.

### AUTOMATION WARNING

- En la primera corrida de la sonda, el paso de reversión no vio «Guardado a las HH:MM» en 20 s.
  Aun así el valor quedó guardado en la BD (`exposed_other` = 0). No se reprodujo en otras dos
  corridas, una de ellas con muestreo del rótulo cada 100–250 ms. En ambas el rótulo pasó de
  «Guardando…» a «Guardado a las 20:4x» en 155–256 ms. Es probablemente una recompilación de
  `next dev`: fue la primera visita después de los commits. No se clasifica como defecto.

### Cambios de comportamiento a tener en cuenta

- Crear un riesgo ahora revalida: la acción devuelve también la foto de la página actual, y
  después el `router.push` trae la del editor. Es el «RSC extra por creación» que se aceptó en la
  decisión de C1.
- Guardar o borrar una medida ya **no** llama a `router.refresh()`: la foto nueva llega con la
  respuesta de la acción. Reemplaza la línea «la del `router.refresh()` al guardar una medida» de
  la tabla de arriba.
- El estado de guardado es por riesgo (I1), y el vacío filtrado ofrece «Limpiar filtros» (A4).

### COVERAGE GAP

- I1 (estado por riesgo) se verificó con pruebas unitarias y con la E2E de dos pestañas. No hubo
  sonda de navegador que fuerce un rechazo en A y un guardado en B.
- Modo revisión y solo lectura: igual que arriba, sólo E2E.

### Compuertas de esta ronda

- `npm run typecheck` y `npm run lint`: verdes.
- `npm run test:fast` sobre `lib/prevention/miper`, `app/(app)/prevencion/miper`,
  `components/prevention`, `combobox`, `choice-card-group` y `top-bar-own-search`: 43 archivos,
  226 pruebas, todas pasan.
- E2E en un worktree desechable, de a un spec:
  - `interacciones` 7/7;
  - `flujo` 3/3;
  - `escenario` 10/10;
  - `programa` 7/7;
  - `matriz` 2/2;
  - `controles` 5/5.
