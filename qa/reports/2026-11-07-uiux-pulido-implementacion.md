# Pulido UI/UX: implementación de UX-01 a UX-18, 7 de noviembre de 2026

**Estado:** implementado en la rama `feat/pulido-uiux` (worktree `bodega-wt/pulido-uiux`), sobre `main` `c2104d949`. **Sin fusionar, sin push y sin desplegar.** Base: el informe [2026-11-07-uiux-unslop-audit.md](2026-11-07-uiux-unslop-audit.md) y el plan aprobado ese mismo día.

**Resultado en una línea:** el ruido tipográfico desapareció de las 33 pantallas medidas: de una mediana de 15 elementos en mayúsculas espaciadas por pantalla (máximo 63) a **0 en todas**. Capacitación pasó de 1.196.074 px de alto en móvil a 11.054. Los controles de período, exportación y estado activo del menú quedaron en un solo patrón cada uno.

---

## Decisiones del usuario aplicadas

| Decisión | Cómo quedó |
|---|---|
| Conservar el saludo del Inicio y mejorarlo | «Buenos días/Buenas tardes/Buenas noches, <nombre>» según la hora de America/Santiago (`greetingForChileHour`), fecha capitalizada, «Más acciones» compacto en móvil. La app del mecánico usa el mismo saludo, calculado tras montar. |
| Menú activo en verde suave | Tokens `--color-nav-*` y helpers únicos en `nav-rows.tsx`; sin `slate-*`. |
| Códigos correlativos y renumeración de los existentes | Incidentes **EV-AAAA-NNNN** («INC» ya era la serie de tickets de TI), inspecciones **INSP-AAAA-NNNN**. Migración 0380 con `legacy_code`. |
| App del mecánico como excepción declarada | Documentada en DESIGN.md; sólo se corrigió su tipografía (`.cap`, `.eqrow .f`). |
| Capacitación: lo exigible más atrasado primero | Orden por tramos: vencida exigible → este mes → futuras → aún no exigible. |

---

## Qué cambió, por hallazgo

| ID | Estado | Cambio | Archivos principales |
|---|---|---|---|
| UX-01 | Hecho | Lista paginada en el servidor (25), conteos en SQL, filtro de ofrecidas en SQL compartido con el calendario, `StageTabs`, buscador propio, un solo diálogo controlado, menú «Más acciones» por tarjeta | `lib/services/prevention-training-occurrences.ts`, `app/(app)/prevencion/capacitacion/*` |
| UX-02 | Hecho | Buscador de Mis pendientes sobre el `Input` compartido; **todos** los campos de formulario a 16 px en móvil (`text-base` medía 15 px e iOS hacía zoom en toda la app) | `work-queue-workbench.tsx`, `components/ui/{input,textarea,select,combobox}.tsx` |
| UX-03 | Hecho | El panel de combustible nombra las reglas desde `ANOMALY_RULE_CATALOG` | `lib/combustibles/panel/steps.ts` |
| UX-04 | Hecho | `Badge` con un solo tratamiento: sans, peso 500, caja de oración; severidad por color y punto | `components/ui/badge.tsx` |
| UX-05 | Hecho | `text-eyebrow` y `th-type` en caja de oración; barrido de ~115 `uppercase` y *pills* mono; regla `local/ui-type-scale` como **error** | `app/globals.css`, `eslint.config.mjs`, ~150 archivos |
| UX-06 | Hecho | `KpiCard`/`SummaryBar` reciben números y los formatean (es-CL); palabras con `valueKind: "text"`; íconos de tile neutros; regla `local/no-string-kpi-value` como **error** | `kpi-card.tsx`, `summary-bar*.tsx`, tablero, TI, PDTP, mantención, control operacional |
| UX-07 | Hecho | `PeriodControl` compartido; Control operacional y Analítica sin «Aplicar período»/«Filtrar»; la cookie de período queda sólo en Combustibles | `components/ui/period-control.tsx`, `fuel-period-control.tsx`, `segmented-control.tsx` |
| UX-08 | Hecho | `ExportLink` y `EXPORT_ICON`; ~25 exportaciones hechas a mano migradas, con su rol y nombre accesible conservados | `components/ui/export-button.tsx` y sitios |
| UX-09 | Hecho | Un estado activo en todo el menú, rótulos de grupo en dos líneas, sin `slate-*` | `components/layout/*` |
| UX-10 | Hecho | Textos: «Panel de cumplimiento SG-SST», «Resumen de TI», «Campañas y capacitación», urgencia «Crítica», insignias en singular, «pestaña», *slug* legible, carriles DIAT/DIEP con rótulo. Códigos EV/INSP correlativos con renumeración | ver commits |
| UX-11 | Hecho | Descripción de la TopBar debajo del título, en dos líneas; descripciones largas acortadas | `top-bar.tsx`, páginas |
| UX-12 | Hecho | `TableCell nowrap` para códigos, cifras con unidad y fechas | `table.tsx`, Recepción, Cargas, Pendientes, Compras |
| UX-13 | Hecho | Un solo estado vacío en Mantención sin equipos; una línea en Cargas sin pendientes; cobertura de stock sin barra vacía | mantención, cargas, bodega |
| UX-14 | Hecho | Íconos de fila neutros en Usuarios; estado esperado de la pestaña en texto en Recepción | `user-list.tsx`, `recepcion-table.tsx` |
| UX-15 | Hecho | Pesos 400–600 (`text-h1`/`display` a 600, `strong`/`b` a 600, `font-bold` → `font-semibold`); `text-2xs` reemplaza 9/10/11 px | `globals.css` y barrido |
| UX-16 | Hecho | Paleta del mecánico declarada como excepción | `DESIGN.md` |
| UX-17 | Hecho | Sin brillo en la barra de progreso ni *ping* en la campana; `Button loading`; emoji → Phosphor; sin `transition-all`; `DatePicker` (los opcionales se pueden vaciar) | ver commits |
| UX-18 | Hecho | Saludo por hora | `dashboard/page.tsx`, `lib/utils.ts` |

Documentación: `DESIGN.md` (tipografía, badges, menú, TopBar, período, exportar, excepción del mecánico) y `AGENTS.md` (regla 7, ruta de `DataTable`, reglas ESLint, período y exportar).

---

## Verificación

### Puertas deterministas

| Puerta | Resultado |
|---|---|
| `typecheck` | 0 errores (heap 6144, ver «Fuera del plan») |
| `lint` | 0 problemas, con las dos reglas nuevas como error |
| `check:secrets`, `check:drizzle-aliases` | OK |
| `db:verify-migrations` | 381 entradas hasta 0380, checksums OK |
| `test:fast` | 19.108 de 19.109; la que falló (`mant-app.test.tsx`) pasa sola 15/15 y falla sólo con la máquina cargada |
| pglite (6 suites tocadas) | 17 + 12 + 6 + 8 + 32 + 13 pruebas, todas en verde |
| `doctor` | Falla igual que en `main`: 3 errores preexistentes en `install-prompt.tsx` y `pin-pad.tsx` (app del mecánico, sin cambios en esta rama); puntaje 67 (main 68) |

### E2E (en el worktree, no en el checkout del dev)

- **Primera pasada, 28 specs:** 263 pasaron, 2 fallaron, 2 omitidas. Las dos fallas eran defectos reales: el nombre del menú de Capacitación se repetía entre faenas, y los campos móviles medían 15 px. Se corrigieron y las 4 specs afectadas pasaron 50/50.
- **Ronda de confirmación, 26 specs** (exportaciones movidas, Inicio, PDTP, inspecciones con códigos correlativos, concurrencia, sincronización sin conexión, programación, folios): **167 pasaron, 0 fallaron, 1 omitida**. En la misma ronda: vitest dirigido 8.009/8.009, typecheck 0 errores, lint 0 problemas.
- Specs nuevas: `capacitacion-paginada`, `pendientes-buscador-movil`.

### Navegador sobre el *build* de producción

`next build` y el servidor *standalone* en :4400 contra `bodega_dev` (clon de producción con *mock*), sesión del usuario QA. Es el mismo recorrido de la auditoría: 33 rutas de escritorio y 11 móviles.

| Métrica | Auditoría (dev) | Ahora (producción) |
|---|---|---|
| Elementos en MAYÚSCULAS por pantalla (mediana / máx.) | 15 / 63 | **0 / 0** |
| Elementos en MAYÚSCULAS en Capacitación | 7.525 | **0** |
| Alto de Capacitación en móvil | 1.196.074 px | **11.054 px** |
| Elementos desbordados en Capacitación (móvil) | 46.337 | 273 (el calendario, dentro de su contenedor desplazable) |
| Elementos con peso 700 por pantalla | 5–21 | **exactamente 1** en las 32 rutas: la marca |
| Texto bajo 11 px | 1 ruta | **ninguna** |
| Errores de consola y respuestas fallidas | 0 | 0 |
| Desborde horizontal del documento (móvil) | no | no |
| axe, violaciones graves o críticas (10 pantallas) | — | **0** |
| Teclado: paradas sin foco visible (3 pantallas × 14 Tab) | — | **0**; el *skip link* es la primera |
| *Hover* en primario, exportar y menú | — | los tres cambian por tokens |
| Movimiento reducido: texto oculto | — | 0 |

La primera medición dejó cuatro restos, que se corrigieron y se volvieron a medir sobre un segundo *build*. Las cifras de la tabla son las de ese recorrido final:

- `strong, b` a peso 600: el `bold` del navegador dejaba algunos `<strong>` en 700.
- Ticks de 10 px en el gráfico de TI, ahora a 11 px.
- Exportaciones hechas a mano que quedaban (Solicitudes, Compras, Entregas, Seguimiento, reporte PDTP, expediente del incidente), ahora sobre `ExportLink`.
- Títulos de gráfico que las mayúsculas escondían en Title Case, ahora en caja de oración («Indicadores operacionales», «Tendencia operativa»…).

En las capturas finales se ven:

- el buscador móvil de Mis pendientes a alto completo y 16 px;
- los códigos `INSP-2025-0006` en la lista;
- Control operacional con el período en la cabecera («10 ago – 7 nov»), sin formulario y con «1.390 h» formateado.

Las capturas no se versionan porque muestran nombres y correos del clon de producción.

### Migración en `bodega_dev`

0380 aplicada: 61 incidentes renumerados (`EV-2025-0001` … `EV-2026-0050`) y 87 inspecciones (`INSP-2025-0001` … `INSP-2026-0077`), todos con `legacy_code`. Las secuencias quedaron en el máximo de cada año.

---

## Fuera del plan, y por qué

- **Heap del typecheck a 6144 (CI y guardián local).** Con heap holgado, `tsc --extendedDiagnostics` marca 5,80 GB en `main` y 5,82 GB en la rama (+0,3 %). `main` pasaba a 5120 sin margen y la rama moría por heap dos veces seguidas. El *build* ya usa 8192 en el mismo runner.
- **16 px en todos los campos móviles.** El comentario del `Input` decía 16 px, pero `text-base` mide 15 px en esta escala. Lo encontró la E2E nueva.
- **Fichas de prevención:** cifras sueltas `String(n)` pasan por `formatQty`. Las etiquetas cortas de motivos de carga viven en un mapa local de la bitácora.
- **Accesibilidad:** el nombre accesible de la exportación de Seguimiento empieza ahora con su texto visible (WCAG 2.5.3).

---

## Riesgos y pendientes

1. **Despliegue de las renumeraciones.** En producción, la migración 0380 renumera incidentes (~1) e inspecciones (~87); la 0381 renumera CAPA (~51 reales), actas CPHS (~13) y planes de emergencia (~10).
   - Avisar a prevencionistas y jefaturas que los códigos cambiaron. Cada ficha muestra «Código anterior» y la búsqueda lo encuentra.
   - Los textos ya enviados (correos, tareas CAPA, documentos generados) conservan el código viejo.
   - Desplegar código y migraciones juntos. Si el código anterior crea algo después de migrar, nace con código aleatorio; volver a correr el SQL de la migración lo corrige, porque es idempotente.
2. **Folio del canal público de reportes (RPT).** Ahora es correlativo. No es una llave: ninguna ruta busca ni actúa por ese código. Sí deja ver cuántos reportes van en el año, como cualquier folio público. Si se prefiere ocultarlo, es un cambio de una línea.
3. **Sin cobertura:**
   - lector de pantalla real;
   - Safari/iOS real (el zoom se verificó por tamaño calculado, no en un iPhone);
   - recorrido manual de roles distintos del QA (sí los cubre la suite E2E completa, ver «Cierre»).

---

## Cierre (2026-11-07, «termina lo faltante»)

Rama `feat/pulido-cierre`, sobre el merge `3f3b6089f`.

| Pendiente del pulido | Cómo quedó |
|---|---|
| Códigos aleatorios en el resto de Prevención | Decisión del usuario: **todas** las familias. CAPA, CPHS, RD, PE, PT, CGRD, RPT, CMP y COORD/FISC/OAL/EXT nacen como `PREFIJO-AAAA-NNNN` vía `nextCodeTx`. La migración **0381** agrega `legacy_code` en 9 tablas y renumera sólo los códigos aleatorios: los de catálogo (`CAMP-…`) y los *fixtures* no se tocan. «Código anterior» se muestra y se puede buscar. En `bodega_dev`: 155 CAPA, 13 actas CPHS, 10 planes y 48 permisos renumerados; campañas de catálogo intactas. |
| Títulos y rótulos en Title Case | ~200 textos en ~100 archivos pasan a caja de oración. Se conservan nombres propios, órganos oficiales, siglas, niveles de riesgo con nombre y los documentos Excel/PDF. Tres `loading.tsx` ahora calzan con el título de su página. |
| React Doctor en rojo | 0 errores. `pin-pad` tenía un actualizador de estado con efectos que **enviaba el PIN dos veces** en StrictMode (3 pruebas nuevas fallan con el código anterior). `install-prompt` lee el navegador después de hidratar. |
| `mant-app.test.tsx` inestable | No era un tiempo de espera: un refresco del catálogo del test anterior se escribía en la base del siguiente. Se drena en `afterEach`. Pasó 5/5 con la máquina 6 veces más lenta. |
| Rango por defecto de Analítica | Abre exactamente en «Últimos 30 días» (`trailingDaysRange`, día de Chile), así que el atajo aparece marcado. El selector de mes de Facturación y Compras DTE vuelve a limitarse a 24 meses (`minMonth`). |

### Verificación final

| Puerta | Resultado |
|---|---|
| Typecheck, lint, secretos, alias de Drizzle | OK |
| Migraciones | 382 entradas verificadas |
| `test:fast` | 19.134 pruebas, 0 fallas |
| `test:pglite` (suite completa) | 4.673 pruebas, 0 fallas |
| React Doctor | 0 errores (antes 3) |

**Suite E2E completa (163 specs, 1.113 pruebas): 1.106 pasaron, 1 falló y 6 se omitieron.**

La falla era `prevencion-inspecciones-lectura` a 390 × 844: «Derivar a CAPA» quedaba un 0,1 % bajo el pliegue, porque los rótulos pasaron de 11 a 12 px. Las comprobaciones laterales, que son el propósito de la prueba («sin scroll horizontal»), pasaban. Ahora la prueba lleva el botón a la vista antes de exigir que entre completo; sigue fallando si se recorta por los lados. Corrida otra vez, pasa.
