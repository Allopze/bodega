# Implementación de la Ola 2 (layout y UX) del submódulo Inspecciones — 20 de octubre de 2026

Cierra el plan derivado de [la auditoría del 19 de octubre](2026-10-19-inspecciones-uiux-audit.md). La Ola 1 (integridad) está en [su informe](2026-10-20-inspecciones-uiux-implementacion-ola1.md); esta ola rehace la presentación. Rama `fix/inspecciones-uiux-ola2`, que parte de la rama de la Ola 1, 29 commits sobre `main` en total (193 archivos). **No se hizo merge a `main`, push ni deploy.**

## Resultado

| Medición | Antes (auditoría) | Después |
|---|---|---|
| P0 | 1 | **0** |
| P1 | 13 | **0 abiertos** (P1-3 y P1-10 sin verificación en navegador: ver «Cobertura») |
| Puntaje de la auditoría | 11/20 | **16/20** (reauditoría independiente en navegador; antes de la ronda de cierre) |
| Ficha de EPP en el teléfono | 11.792 px de alto | **4.469 px** |
| Columnas de acción ocultas por scroll a 1024–1440 px | bandeja, Plantillas, Seguimiento | **ninguna** |
| axe (WCAG 2.2 AA), 50 pantalla×ancho | 2 violaciones *serious* | **0** |
| Desborde horizontal, 50 pantalla×ancho | varios | **0** |

| Dimensión | Antes | Después | Qué lo explica |
|---|---|---|---|
| Accesibilidad | 2 | **3** | axe 0 en 54 vistas y diálogos; 0 objetivos táctiles cortos a 390 px; teclado y retorno de foco correctos. No llega a 4 por los nombres accesibles repetidos (corregidos después de la medición) y no haber probado con lector de pantalla |
| Rendimiento | 2 | **3** | Ya no se invalida lo operacional en cada autoguardado; consulta de riesgos en una sola; carga marcada al filtrar. **No se midió producción**: solo modo dev |
| Tema | 3 | **3** | Tokens correctos, sin literales ni tokens inexistentes; siguen la tipografía mixta de los badges (regla de `DESIGN.md`) y «Vencida» en dos colores |
| Responsive | 2 | **4** | 0 desbordes, tarjetas en móvil, columnas por prioridad, KPI 2×2, estado de guardado en la barra del teléfono |
| Integridad | 2 | **3** | P0 y P1 comprobados, un solo vocabulario, componentes compartidos |
| **Total** | **11** | **16** | **Bueno** |

El puntaje lo asignó un revisor independiente que no vio el trabajo de implementación (sin acceso al razonamiento de las líneas) y midió en el navegador con la rúbrica de la auditoría original. Se midió **antes** de la ronda de cierre, que corrigió varios de los hallazgos que le restaban puntos.

## Qué cambió

**Detalle de captura.** Una sola cabecera de trabajo (faena · sujeto · responsable, avance «{a} de {n} obligatorios» con barra y estado de guardado, un solo badge de estado, el resto de los datos plegado). El progreso reemplaza al muro rojo: «3 sin responder · 1 sin motivo · acta incompleta», cada parte salta al primer ítem. Cada ítem es un solo árbol con botones de 44 px por resultado (con check y anillo, no solo color) y comentario/foto plegados que se abren solos cuando se exige motivo. La matriz de EPP lleva dos grupos por prenda. Las acciones del registro (Acta PDF, Reabrir, Cancelar inspección) pasan al encabezado de la página. El cumplimiento aparece solo después de declarar ejecutada.

**Detalle en lectura y revisión.** Resumen primero (resultado oficial y normalizado, conteos, hallazgos, acta y firmas, quién ejecutó y quién revisó). Hallazgos como tarjetas con acciones de 44 px en el teléfono (antes la tabla las dejaba fuera de pantalla). No conformidades a la vista y lo conforme plegado por sección. Una cancelada dice por quién, cuándo y por qué.

**Bandeja.** Tabla dentro de una región con nombre, sin columnas ocultas desde 1024 px; tarjetas con responsable y hallazgos graves; KPI en 2×2; avisos de actividades del programa preventivo y de programaciones vencidas sobre los filtros; «Nueva inspección» reordenada (Origen plegado, errores por campo).

**Plantillas.** Vista previa del cuestionario en una hoja (con historial de versiones y detalle técnico plegado), una fila por instrumento, acción siguiente más el menú «Más acciones de {nombre}».

**Programación y Seguimiento.** Un solo control de estado en Programación y una sola consulta de riesgos. Seguimiento pasa de una tabla fija a una herramienta: filtros, enlaces al hallazgo y a la CAPA, orden por atención y Excel que respeta los filtros (con los encabezados oficiales del Anexo 15 intactos).

## Verificaciones ejecutadas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` (worktree desechable) | **Limpio** en la rama final. En el camino marcó 9 errores míos (tipos de pruebas y de un manejador), todos corregidos |
| `eslint` | Limpio en cada commit (el hook corre el lint de todo el repo) |
| `npm run test:fast` completo | Sobre la Ola 2 antes del cierre: 12.378 ✓ · 1 ✗ (`solicitudes/item-editor`, **falla igual en `main`**). La corrida final tras la ronda de cierre: ver «Corrida final» |
| `npm run test:pglite` completo | Antes del cierre: 3.159 ✓ · 1 ✗ (`miper-work-queue`, **falla igual en `main`**) |
| Suite Postgres real de Inspecciones | **91 de 91** |
| E2E completa de la plataforma (worktree desechable) | **867 ✓ · 4 omitidas · 1 ✗** en 36,7 min. La falla es `servicios-costo-pendiente` (Solicitudes), **preexistente** y sin relación con esta rama |
| 21 specs de Inspecciones y de shell | Todos en verde (línea 2G); 8 de ellos nuevos o ampliados |
| Recorrido en navegador | 10 pantallas × 5 anchos (1440, 1280, 1024, 720×450 y 390 táctil): axe 0, consola 0, red 0, desborde 0 |
| Revisión independiente (3 revisores aislados) | Ver más abajo |

### Corrida final tras la ronda de cierre

Se repitió el E2E dirigido de Inspecciones y las suites completas sobre la rama definitiva. Resultados en la sección «Corrida final», al final de este informe.

## Revisión independiente y ronda de cierre

Tres revisores de solo lectura, sin ver el trabajo de los otros, revisaron la rama: uno el código y los datos (con sondas ejecutables), otro la seguridad y la autorización, y otro reauditó en navegador. Ninguno encontró P0 ni un defecto de autorización explotable entre faenas. Encontraron esto, que **se corrigió** en una ronda de cierre y cada corrección se probó por mutación:

| ID | Sev. | Hallazgo | Estado |
|---|---|---|---|
| CD-01 | **P1** | Tras declarar ejecutada (o «ya no se puede editar») y reabrir sin salir, el autoguardado y el respaldo quedaban muertos con la etiqueta «Declarando ejecutada…» | ✅ |
| CD-02 | P2 | Un conflicto de versión que se resolvía solo dejaba «Recuperar/Descartar» colgados | ✅ |
| CD-03 / SEG-01 | P2 | La cola de cierres sin conexión no sabía de quién era cada entrada y se vaciaba al montar: un equipo compartido podía enviar el cierre de A con la sesión de B | ✅ cola atada al usuario; purga de lo ajeno, lo sin dueño y lo de más de 30 días |
| R-01 | P2 | «El resultado del acta no corresponde a las opciones…» cuando solo faltaba elegirlo | ✅ «Falta elegir el resultado…» con «Ir al acta» |
| R-02 | P2 | La cancelación exigía un motivo de 10 caracteres que nadie podía leer | ✅ «Cancelada por X el dd-mm-aaaa: motivo» |
| R-03 | P2 | Acciones por fila con el mismo nombre accesible («Detener» ×4, «Aprobar» ×3) | ✅ nombre con el instrumento o el hallazgo |
| SEG-02 | P3 | Vincular o importar una fuente documental no validaba confidencialidad ni alcance de faena | ✅ |
| SEG-03 | P3 | Los borradores locales de otro usuario no caducaban | ✅ purga por usuario y edad |
| CD-04 / CD-05 / CD-06 | P3 | Ubicación de otra sesión, falso conflicto tras una respuesta perdida, excepciones inesperadas sin rastro | ✅ |
| R-04, R-07, R-09 | P3 | Fuente «obligatoria» contradictoria, carga sin marcar en 3 pantallas, «materializa» | ✅ |
| R-06 (parcial), R-11 (parcial) | P3 | «Vencida» repetido bajo la insignia; columna «Origen» del Excel con código interno | ✅ |

**No se corrigió (queda registrado):**

- **R-05** — «Pendientes de revisión 0» convive con un estado que lista 1 fila, y «Vencidas 0» con el aviso de «2 programaciones vencidas». El predicado es correcto («para ti»), pero las mismas palabras significan cosas distintas. Se propone rotular «Para tu revisión» y «Ejecuciones vencidas»; no se hizo porque obliga a reescribir muchas pruebas y E2E (decisión de vocabulario).
- **R-06** (tipografía y color de los badges) — es regla de `DESIGN.md` (severidades en mono, informativos en sans); «Vencida» sigue rojo en unas pantallas y naranja en otras.
- **R-08** — cada autoguardado sigue devolviendo la página de detalle; se midieron ~18 KB y ~260 ms **en modo dev**. Falta medir producción.
- **R-10** — a 720×450 (zoom 200 %) la barra fija de guardado y la cabecera ocupan ~40 % del alto.
- **R-11** (resto) — «Resultado oficial %» trae el texto «Sin fórmula documental» y «Resultado normalizado %» un 80 sin formato; arreglarlo cambia los valores que otros usuarios del Excel ya leen.

## Cambios de comportamiento que los usuarios notarán en la Ola 2

- **El cumplimiento ya no se muestra mientras se edita**; aparece al declarar ejecutada.
- **Elegir un resultado es tocar un botón**, no abrir una lista; comentario y foto quedan plegados y se abren solos cuando hacen falta.
- **«Acta PDF», «Reabrir para rectificar» y «Cancelar inspección» salieron del contenido** y están en el encabezado de la página.
- **En Plantillas, las versiones reemplazadas o retiradas ya no se listan**: están en el historial del cuestionario de cada instrumento (o con el filtro «Reemplazadas o retiradas»).
- **En lectura, lo conforme, lo que no aplica y lo sin responder quedan plegados** por sección; solo se ve de entrada lo que pide atención. *Conviene confirmarlo con Prevención.*
- **La búsqueda de Seguimiento y de Programación** vive en su propia barra (la de la shell está oculta en estas rutas).
- **El Excel de Seguimiento filtrado se llama `…-filtrado.xlsx`**, para que nadie lo reenvíe como el Anexo 15 completo.

## Datos que quedaron en `bodega_dev`

Todos con prefijo `QA_` o creados por la interfaz, para reproducir los casos:

- Las ejecuciones de la Ola 1 (`INSP-2026-U8K7E5H1`, `INSP-2026-JVE5OWTP`, `QA_INS-EPP-001`) y, **sembrada por la línea de Seguimiento con SQL directo** (sin bitácora ni historial), `QA_INS-SEG-001` («Revisada y cerrada») con 5 CAPA, 7 hallazgos y 4 seguimientos; borrable por prefijo.
- 5 programaciones `QA_` creadas por la línea de Programación a través del servicio.
- Cambios de prueba de los revisores: `Peso = 9` y `Rótulo = Bueno` en `INSP-2026-JVE5OWTP`, y un ítem de `QA_INS-EPP-001` en «No aplica».

## Cobertura: lo que no se recorrió

- **Revisión por un segundo usuario** (P1-3 en navegador): hay una sola sesión QA; lo cubren jsdom y el E2E de cierre.
- **Roles distintos de administrador** (P1-10, permisos parciales del catálogo): cubierto por jsdom y por `roles-permisos`.
- **Rendimiento en producción** (LCP, TTFB, costo real de revalidar el detalle).
- **Lector de pantalla real, gestos táctiles reales y navegadores móviles o Safari/Firefox**: solo Chromium, con viewport emulado.
- **Subida real de fotos, «Quitar foto» y PDF del acta** en el recorrido manual (cubiertos por E2E y jsdom).
- **Cola sin conexión con dos usuarios reales**: el mecanismo se probó (fake-indexeddb y sonda), no el cambio de sesión de punta a punta.
- **Acciones del catálogo que mutan** (aprobar, retirar, revertir, paridad): cubiertas por PGlite y E2E, no por el recorrido manual.
- **Estados «vacío real»** (sin datos): solo se vieron vacíos por filtro.

## Pendientes

1. **Merge de las dos ramas a `main`** (`fix/inspecciones-uiux-ola1` está contenida en `fix/inspecciones-uiux-ola2`) y, cuando se decida, push y deploy. No se hizo nada de eso.
2. Los pendientes no corregidos de la sección anterior (R-05, R-06, R-08, R-10, R-11) y los diferidos del plan (P3-1 a P3-4, vista previa de plantillas ya hecha).
3. **Fotos quitadas:** el archivo físico queda en disco; el recolector de evidencias no cubre ese directorio y conectarlo como está borraría documentos y evidencias de hallazgos.
4. El panel «Desviaciones encontradas» del detalle en lectura repite en una tabla (sin diseño para móvil) lo que ya está en «Hallazgos».
5. Fallas preexistentes en `main`, ajenas a esta rama: `solicitudes/item-editor`, `miper-work-queue` y el E2E `servicios-costo-pendiente`.
6. Conviene **repetir `/impeccable audit`** tras el merge para confirmar el puntaje con una segunda medición.

## Corrida final

Rama definitiva `fix/inspecciones-uiux-ola2` tras la ronda de cierre (`e4c3c9d4`) más una última corrección que apareció en esta corrida.

| Verificación | Resultado |
|---|---|
| `npm run typecheck` (worktree desechable) | 0 errores, también con la corrección final |
| `npm run test:fast` completo | **12.427 ✓ · 1 ✗** — `solicitudes/item-editor`, **falla igual en `main`** |
| `npm run test:pglite` completo | **3.168 ✓ · 1 ✗** — `miper-work-queue`, **falla igual en `main`** |
| Suite Postgres real de Inspecciones | **91 de 91** |
| E2E dirigido: 21 specs de Inspecciones y de shell (worktree desechable) | 120 ✓ · 2 omitidas · **1 ✗** (la de abajo) |
| E2E `prevencion-inspecciones-ejecucion` tras la corrección | **10 de 10** ✓ |

### Defecto encontrado en esta corrida y corregido

- **«Ir al acta» no dejaba el foco en «Resultado del acta»** (accesibilidad: tras elegir el atajo, el foco volvía al botón «Declarar ejecutada»). Causa: el salto se disparaba con un `setTimeout(150)` tras cerrar el diálogo, pero Radix devuelve el foco al disparador cuando el diálogo **termina de desmontarse**, y su animación de salida (`--duration-default`) dura más que eso; el foco del atajo quedaba pisado. Las pruebas jsdom no lo veían porque ahí no hay animación. Corrección en `complete-dialog.tsx`: el salto se hace desde `onCloseAutoFocus` del diálogo (con `preventDefault`), que es justo el instante en que Radix reclamaría el foco, sin temporizadores. Verificado en navegador real: el spec que fallaba pasa (2,9 s) y la suite del archivo queda en 10 de 10.
- Alcanza también a «Ir al primero»: usa la misma función.

### Lo que esta corrida no repitió

La E2E **completa** de la plataforma (867 ✓) se corrió sobre el estado previo a la ronda de cierre; tras ella se repitieron solo los 21 specs de Inspecciones y de shell, las suites completas de unitarias y PGlite y la suite Postgres real. Las fallas preexistentes en `main` siguen siendo las mismas tres.
