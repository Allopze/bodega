# Cierre — rediseño MIPER, fases D y E, V1 y V2 (2026-10-03)

## 1. Alcance

Rama `feat/miper-acciones-masivas`, código verificado en `ff3ecd5c`. Consolida:

- Fase D: acciones en lote sobre riesgos (barra de selección y sus tres diálogos);
- Fase E: programa en tarjetas con su detalle de actividad, descarga de evidencia, filtros rápidos de
  revisión, bitácora paginada y la página `controles/[id]`;
- V1 y V2 de la verificación de la rama.

No es una auditoría de toda la aplicación y no afirma cobertura total. Lo que no se recorrió está en
§7. El recorrido de navegador de este informe es de **sólo lectura** y cubre lo que `bodega_dev`
tiene (una MIPER en borrador, sin programa, sin evidencia y sin MIPER vigente).

## 2. Entorno

- **Navegador:** `next dev` del usuario en :3001 contra `bodega_dev`. Sesión QA de
  `playwright/.auth/monkeytest.json` (vigente; no hubo que regenerarla). Chromium de Playwright,
  1440×900 y 390×844.
- **Sonda** `qa-cierre-sonda.mjs` en la raíz del repo, para resolver `@playwright/test`. No se
  versionó y se borró al terminar. No imprimió cookies ni credenciales.
- **Datos:** «Oficina Central 2099» (222 riesgos, la MIPER con más riesgos y la única).
- **Recuento en `bodega_dev`, sólo lectura** (`default_transaction_read_only = on`), antes y después
  del recorrido. `diff` vacío:

  | Tabla | Antes | Después |
  |---|---|---|
  | `prevention_risk_matrices` | 1 | 1 |
  | `prevention_risk_entries` | 222 | 222 |
  | `prevention_risk_controls` | 0 | 0 |
  | `prevention_risk_programs` | 0 | 0 |
  | `prevention_risk_program_actions` | 0 | 0 |
  | `audit_log` | 1.396 | 1.396 |

- **Proceso:**
  - la implementación corrió en 7 flujos paralelos y se integró con parches;
  - el lint del pre-commit comparte un candado de toda la máquina;
  - un `/tmp` (tmpfs) lleno abortó una corrida E2E, así que el E2E corre ahora en worktrees bajo
    /home.

## 3. Compuertas (sobre `ff3ecd5c`)

| Compuerta | Resultado |
|---|---|
| `npm run typecheck` | limpio |
| `npm run lint` | limpio |
| `npm run test:fast` | 878 archivos, 11.129 pruebas pasan |

**Suites PGlite, una a la vez, todas verdes sobre el árbol integrado:** miper-bulk 13, miper-entries
7, miper-program-queries 8, miper-program 10, miper-program-execution 13,
miper-program-occurrences 5, miper-program-generation 4, miper-queries 10, miper-portfolio 11,
miper-workflow 6, miper-snapshot-batch 5, miper-work-queue 14, miper-import 17, miper-matrices 6,
miper-program-constraints 4.

## 4. E2E

Desde worktrees desechables:

| Commit | Specs |
|---|---|
| `b4eb5439` | masivas 3, controles 5, flujo 3, matriz 4, interacciones 8, importacion 2, accessibility 167, densidad-kpi 16 |
| `ef5ee119` (tras los arreglos) | revision-lectura 7, programa 8, escenario 10 |

### E2E final sobre ff3ecd5c

Corrida completa desde un worktree desechable en `/home/allopze/dev/chome/bodega-wt/e2e-ff3ecd5c`
(nunca desde el checkout principal; `/tmp` no, porque es un tmpfs que se llenó en una corrida
anterior), un spec por corrida: la primera construye y las demás usan `E2E_SKIP_BUILD=true`.

| Spec | Resultado |
|---|---|
| `prevencion-miper-masivas` | 3 passed |
| `prevencion-miper-revision-lectura` | 6 passed, 1 failed (ver abajo) → 7 passed ×2 sobre `95bb88d4` |
| `prevencion-miper-programa` | 8 passed |
| `prevencion-miper-escenario` | 10 passed |
| `prevencion-miper-controles` | 5 passed |
| `prevencion-miper-flujo` | 3 passed |
| `prevencion-miper-matriz` | 4 passed |
| `prevencion-miper-interacciones` | 8 passed |
| `prevencion-miper-importacion` | 2 passed |
| `accessibility` | 167 passed |
| `densidad-kpi` | 16 passed |

**AUTOMATION WARNING (corregido).** La auditoría axe de `revision-lectura` (768/1024/1280 px)
falló una vez sobre `ff3ecd5c` por contraste 4,21:1 (`#7c7b7c`) en el texto `text-subtle` de una
observación respondida, y había pasado 7/7 sobre `ef5ee119` con el mismo código de producto. El
token (`oklch(0.500 0.002 0)`) pasa en el resto de la app: axe midió el texto a mitad del fundido de
entrada del panel. No es un PRODUCT BUG. La spec nueva no esperaba a que terminaran las
animaciones antes de axe, como sí lo hace `accessibility.spec.ts`; `95bb88d4` agrega esa espera y
la spec pasó 7/7 en dos corridas seguidas sobre ese commit (que sólo toca esa spec).

## 5. PASS (verificado en navegador, `bodega_dev`)

Cada fila se midió a 1440×900 y a 390×844, con el mismo resultado salvo donde se indica.

| Caso | Medición |
|---|---|
| Portada MIPER | Carga y lista «Oficina Central 2099» con enlace a su espacio de trabajo |
| Resumen y Matriz | Cargan; la página no da scroll horizontal en ninguna de las dos (a 390 tampoco) |
| Selección en lote | Con un filtro activo (`?completitud=pendientes`), «Seleccionar» aparece y muestra 222 casillas con nombre accesible «Seleccionar el riesgo #N…». Con 2 marcadas, la región «Acciones sobre la selección» dice «2 riesgos seleccionados» y ofrece «Quitar selección», «Cambiar ¿controlado?», «Asignar responsable / plazo» y «Agregar medida a 2» |
| Diálogos en lote | Se abren «¿Está controlado? en 2 riesgos», «Responsable y plazo de las medidas de 2 riesgos» y «Agregar una medida a 2 riesgos». Los tres se cancelan y se cierran |
| Tarea | Se abre desde la matriz (`?tarea=…`). «Editar contexto» abre «Editar contexto de la tarea» y «Cancelar» lo cierra |
| Editor de riesgo | Abre desde la tarea (`?fila=…`) |
| Programa | Carga: «Esta MIPER todavía no tiene Programa» (estado vacío; sin tarjetas, ver §7) |
| Revisión | Carga: «Recorrer la MIPER…». La barra superior ofrece «Enviar a revisión» |
| Historial | «Mostrando 50 eventos»; «Cargar más» lo lleva a «Mostrando 100 eventos», con el conteo en un `role="status"` (arreglo 13a1af8b) |
| Sin escritura | 0 cambios en las 6 tablas; `audit_log` igual (1.396) |

**Lo que se arregló en la integración (PRODUCT BUG ya corregidos, con prueba de regresión):**

1. El detalle de una actividad había perdido el avance de la actividad (55a4ab66).
2. El conteo de la bitácora no se anunciaba como un `status` (13a1af8b).

**Deriva de la especificación corregida:** Legal y RRHH pueden escribir legítimamente «Nueva
observación» (143058b6); el nombre del archivo de evidencia vive en el diálogo de la ocurrencia
(ef5ee119).

## 6. Hallazgos de esta pasada

### PRODUCT BUG

Ninguno abierto. Los dos de §5 se encontraron y se arreglaron durante la integración.

### FUNCTIONAL FINDING

Ninguno.

### UX FINDING

1. **«Seleccionar» sólo existe con un filtro activo.** En la matriz sin filtros no hay modo de
   selección: la matriz muestra la estructura y no lista riesgos (`matrix-view.tsx`: `bulk && filtered`).
   Es intencional en el código y la persona lo descubre sólo si ya filtró; nada en la matriz sin
   filtros dice que filtrar habilita el lote. Se vio al recorrer: la primera sonda, sin filtro, no
   encontró el botón.

### INCONSISTENCY

Ninguna observada.

### AUTOMATION WARNING

1. **Un POST (Server Function) observado por viewport**, a `/prevencion/miper/<id>`, siempre con el
   mismo id de acción. Es `loadMiperHistoryPageAction` (el «Cargar más»): es lectura, no revalida y
   no escribe (`history-actions.ts`). Es la única acción no navegacional que la sonda ejecutó, y las
   6 tablas quedaron iguales. No hubo ningún otro POST: ni un diálogo en lote ni «Editar contexto»
   enviaron nada.
2. **La primera pasada de la sonda no encontró «Seleccionar»** por la razón del UX FINDING 1. No es un
   defecto del producto: se repitió con el filtro.

### IMPROVEMENT OPPORTUNITY

1. **Pista del modo de selección en la matriz sin filtros** (UX FINDING 1): una línea como «Filtra
   para seleccionar varios riesgos», o dejar «Seleccionar» a la vista y desactivado con ese motivo.

## 7. Consola y red

- 0 `console.error` y 0 `pageerror`, a 1440 y a 390.
- 0 respuestas ≥ 400.
- 0 pedidos fallidos (`requestfailed`).
- POST: sólo el «Cargar más» (AUTOMATION WARNING 1).

## 8. Cobertura

**Recorrido (navegador):** portada `/prevencion/miper`; espacio de trabajo con `?tab=resumen`,
`matriz`, `programa`, `revision`, `historial` y `?completitud=pendientes`; una tarea; el editor de un
riesgo; la selección y sus tres diálogos; «Editar contexto». En dos viewports.

**COVERAGE GAP** (`bodega_dev` no tiene los datos y no se crearon):

- **Tarjetas del programa y el detalle de una actividad** (`?actividad=`): no hay programa. Los
  cubren `programa` (8) y `escenario` (10) en E2E y las suites PGlite de programa.
- **Descarga de evidencia:** no hay evidencia.
- **`controles/[id]`:** no hay MIPER vigente ni controles. Lo cubre `controles` (5) en E2E.
- **Revisión con rondas y filtros rápidos con datos:** sin rondas. Lo cubren `revision-lectura` (7) y
  `flujo` (3).
- **Resultado de un lote:** los diálogos sólo se abrieron y se cancelaron; lo cubren `masivas` (3) y
  miper-bulk (13).
- **Un solo usuario** (sesión QA): no se probaron permisos reducidos en navegador.
- **Rutas no recorridas:** «Factores de riesgo», importación, «Nueva MIPER», la ficha del documento y
  la hoja de evidencia.

**Límites declarados:**

- No se usó un lector de pantalla real con personas. La accesibilidad sale de axe en E2E
  (`accessibility` 167), de nombres accesibles medidos y de las pruebas unitarias.
- Producción quedó fuera de alcance. Todo lo de navegador es `next dev` de un equipo local.

## 9. Recomendaciones priorizadas

1. Completar §4 (E2E final sobre `ff3ecd5c`) antes de integrar.
2. Un recorrido asistido con datos (una MIPER con programa, evidencia y vigente) en QA o staging para
   cerrar los COVERAGE GAP de §8: tarjetas, detalle de actividad, evidencia y `controles/[id]`.
3. Hacer descubrible la selección en lote sin filtros (UX FINDING 1).
4. Mantener el E2E en worktrees bajo /home, no en /tmp (tmpfs) ni en el checkout principal.
