# Notas de pedido y repuestos con stock — verificación, 2026-11-26

El mecánico pide repuestos para su OT con una nota de pedido. Jefatura los saca de la bodega, los compra o los rechaza. El
repuesto que llega entra al stock de la faena reservado para la OT, el registro lo descuenta, anular repone y cerrar la OT
libera. Migración 0403 y 3 permisos nuevos. El detalle está en [notas-pedido-2026-11-26.md](notas-pedido-2026-11-26.md).

- **PASS · puertas:**
  - typecheck y lint con exit 0;
  - `test:fast`: 22.635 pasan y 1 falla (`backup-env-whitelist`, la misma que en la base);
  - `test:pglite`: 5.934 pasan;
  - `db:verify-migrations`: 404 entradas.
- **PASS · E2E aislada:**
  - `notas-pedido.spec.ts` pasa 7/7 sobre build de producción, con base y puerto propios;
  - en los 16 specs de las áreas tocadas, sólo fallan 2 rojos previos de la unidad km/h.
- **PASS · revisión final (Opus):** sin bloqueantes; el importante y dos menores, corregidos con prueba.
- **PASS · recorrido visual:** escritorio y móvil. Tres defectos corregidos.
- **LÍMITES:**
  - concurrencia real sin probar contra Postgres;
  - la compra completa no está en la E2E;
  - antes de producción, inventario de arranque con jefatura.
  - La rama no está en `main` ni desplegada.

# Historial de mantenciones unificado — verificación, 2026-11-25

`/mantencion/registros/historicos` pasó de «Historial anterior» (lista plana de respuestas de Forms) a una vista única de
formularios + órdenes de trabajo + registros firmados, con resumen y gráficos, matriz «Equipos por mes», Excel, vista previa,
ficha tipo resumen y una línea de tiempo en la hoja de vida del equipo. Sin migración ni permiso nuevo. El detalle está en
[mantencion-historial-2026-11-25.md](mantencion-historial-2026-11-25.md).

- **PASS · puertas:** typecheck y lint con exit 0; `test:fast` 22.405 pasan y 1 falla (`backup-env-whitelist`, ya roja en la
  base `b848c1423`); `test:pglite` 5.801 pasan (447 archivos); `db:verify-migrations` 403 entradas.
- **PASS · E2E sobre build de producción:** `mantencion-historial.spec.ts` 8/8 y `mantencion-historico.spec.ts` 1/1, sin
  errores de consola ni 4xx/5xx; descarga real del `.xlsx`, matriz, vista previa, ficha, línea de tiempo y 390 px.
- **PASS · revisión independiente de solo lectura:** sin críticos ni altos; medios y bajos corregidos con prueba, y dos
  defectos reales del Excel que sacaron las pruebas de servicio.
- **PASS · datos reales (producción, solo lectura):** la lista y el Panel devuelven los mismos trabajos en tres períodos
  (1.705 · 2.343 · 35); cargar el período entero tarda ~100 ms. Hoy hay 0 registros firmados y 0 OT vigentes: la vista es
  de formularios hasta que se usen las otras fuentes. Una respuesta con fecha 2027-07-20 (error de digitación) queda fuera
  de la lista y del Panel.
- **SIN CAMBIO · rojo previo en la base:** 7 specs de Mantención (`1-app:166`, `3a-equipos:33`, `3b-pautas:65`,
  `4-permisos:72`, `5-ot:280`, `panel-looker-cobertura:63`, `panel-looker:83`) fallan igual en `b848c1423` (comprobado con
  un build aparte): son de la unidad km/h por equipo.
- **LÍMITES:** Safari/Android reales, lector de pantalla, rendimiento con volumen y el tope real de 20.000 filas del Excel
  no se verificaron. La rama no está en `main` ni desplegada.

# Panel de mantención estilo Looker — cierre de verificación, 2026-11-24

Cuatro pestañas en `/mantencion/panel` (`Hoy`, `Planificación`, `Camiones`, `Máquinas`) con filtro
cruzado por URL, «Exportar Excel» en las tres nuevas, migración 0401 y el importador del consolidado con
detalle por ítem. El detalle está en
[mantencion-panel-looker-2026-11-23.md](mantencion-panel-looker-2026-11-23.md).

- **PASS · puertas** (worktree limpio de `HEAD`, sin los cambios sin commitear de otra sesión): typecheck, lint y
  `check:secrets` con exit 0; `db:verify-migrations` 402 entradas hasta la 0401; `test:fast` 22.101 pruebas
  pasan, 0 fallan, 277 omitidas (1.471 archivos); `test:pglite` 5.685 pasan, 0 fallan, 1 omitida (442 archivos).
- **PASS · E2E del tablero y de la exportación:** `mantencion-panel-looker.spec.ts` 15 + 1 omitido (el visor de
  la matriz con foto preventiva nativa, hasta 2026-12-01), `…-export.spec.ts` 8/8 y `…-cobertura.spec.ts` 7/7,
  sin errores de consola ni respuestas 4xx/5xx del origen. Verifican en navegador: descarga real del .xlsx y
  lectura con `exceljs` en las tres pestañas (hojas, «Filtros», «Correctivos» con las 31 filas del filtro y no
  las 25 visibles), alcance por faena (un usuario de una faena que pide otra recibe las hojas vacías, sin
  nombrarla), el botón ausente sin `mant:export` (con control negativo que falló como debía), listas de Código
  y Frecuencia acotadas por pestaña, tope de 8 columnas de la matriz con 10 pautas, teclado (barras, conductor y
  leyenda), cumplimiento del mes como promedio (60 %, no 43 %) y los valores de «Consolidado por horas».
- **PASS · «Exportar Excel» de las pestañas nuevas:** acción de servidor con `mant:export` + el gate de la página,
  alcance por faena en el servidor, auditoría, tope de filas y de ids, y saneo de fórmulas (comprobado con un
  libro real: ninguna celda es fórmula). Revisión independiente de solo lectura: sin hallazgos críticos ni
  altos; 1 medio y 3 bajos corregidos con prueba.
- **PASS con salvedades · `test:e2e` completo:** 1.221 pruebas, **1.213 pasan, 8 omisiones condicionales y 0
  fallos reproducibles** (antes: 64 fallos). Es un consolidado de tres invocaciones, no una corrida ininterrumpida:
  el intento 1 no ejecutó nada (el `webServer` agotó 600 s con la máquina cargada), el intento 2 construyó aparte
  y se detuvo en la prueba 1.186 (1.171 pasan, 1 falla, 14 omitidas), y las 35 restantes pasan 35/35. El fallo
  (`prevencion-miper-revision-lectura:119`, que dejó 6 omitidas en cadena) **no se reprodujo**: el spec pasa 7/7
  aislado; la causa no se determinó. Árbol probado: `d21f8bdc8`.
- **PASS · reimportación en dev:** consolidado real sobre `bodega_dev`, 266 de 266 ítems de detalle leídos
  (contrastados con un conteo independiente), 0 rechazos, 0 ambigüedades; la segunda simulación no dejó cambios.
- **PASS · arreglos con prueba o medición antes y después:** `Hoy` sin menú de pestañas (`PanelTabs`); TopBar sin
  tope de líneas a 1024 px (`lg:block` pisaba `line-clamp-2`; `reflow-anchos:158` ahora pasa); 7 defectos de la
  revisión visual (listas de Código/Frecuencia sin acotar por pestaña, etiquetas truncadas, X del visor a
  1,36:1, eje decimal y plural, mensaje triplicado, texto de vacío, popovers en iOS); «Horas programadas»;
  enlaces de fotos del histórico sin validar el esquema (React 19 ya neutralizaba `javascript:`; `data:`, `http:` y
  hosts ajenos seguían siendo enlaces).
- **PASS · automatización:** la segunda «Faena E2E» (explicaba 61 de 64 fallos) tenía causa raíz demostrada
  —`isVisible()` sin espera contra un `Suspense` que React 19 revela ~300 ms tras `load`; el duplicado salía en
  2 de 20 corridas— y el helper ahora espera la tabla. El aborto de `POST /api/apps/visita` es un artefacto del
  navegador: 18 pantallas medidas, todas con 204 y registradas; no se pierden visitas.
- **UX FINDING · decisión pendiente:** a 1024 px, **80 de 130 pantallas (61,5 %)** quedan con la descripción del
  TopBar recortada a 2 líneas (25 pierden 3 o más) y 21 superan 73 px de alto; antes el TopBar crecía sin tope.
  Evidencia: `evidencia-topbar-1024-2026-11-24.md`. Rediseñarlo es de diseño y no se hizo.
- **LÍMITES:** capturas con datos sintéticos de una base E2E desechable (el flujo con `bodega_dev` y el usuario
  QA fue denegado tres veces por el clasificador, también con la aprobación del usuario); la matriz con datos
  reales tiene como máximo 4 columnas y Máquinas queda sin pautas (el tope de 8 se verificó con datos sintéticos);
  la llamada directa a la acción de exportación sin `mant:export`, el tope de 20.000 filas con volumen real y
  la apertura de los .xlsx en Excel no se probaron; otros helpers con el patrón `isVisible().catch` pueden
  saltarse pruebas en silencio (no se verificó si las 2 omisiones de `pdtp-habilitacion` lo son); 4 specs fallan
  sólo en `next dev` por hidratación; sin Safari/Android reales ni lector de pantalla.
- **PENDIENTE:** migración 0401 y reimportación en producción (runbook en el informe; el importador carga todas
  las hojas, no sólo las 6 pautas), exportación a PDF de las pestañas nuevas, comparación contra una captura real
  de Looker (hace falta que alguien la aporte), decisión sobre el TopBar a 1024 px, y push y despliegue.

# Corrección del módulo de combustibles — 2026-11-05

Se corrigieron los 45 hallazgos de la auditoría estática del 2026-11-05, con un reparto por día
para el mes con un equipo reasignado. Durante la verificación aparecieron ocho defectos más, todos
corregidos. El detalle por hallazgo está en
[2026-11-05-auditoria-combustibles-codigo.md](2026-11-05-auditoria-combustibles-codigo.md) § 9.

- **PASS · puertas:**
  - typecheck y lint sin errores;
  - migraciones: 374 entradas, sin cambios de esquema pendientes;
  - `check:secrets` verde;
  - PGlite completo: 4.422 en verde.
- **PASS · navegador:** E2E de combustibles en Chromium, 46/46 (1 omitida), más el
  recorrido de «Revisión de Copec» en escritorio y en 390 px.
- **FALLA AJENA:** `test:fast` tiene 18.467 en verde y 4 fallidas en
  `oc-pdf-route-engine` por `PDF_ORIGIN_NOT_CONFIGURED`, una variable del ambiente
  que no tiene relación con combustibles.
- **RIESGO:** el chequeo de tipos de `next build` necesitó 6.144 MiB localmente. El
  CI usa 5.120.
- **RESUELTO:** el mes Copec con un equipo reasignado a mitad de mes se reparte por
  día según la faena de cada carga (§ 9.3, decisión del usuario).
- **PENDIENTE:** commit, CI, deploy y migraciones 0372/0373 en producción.

# Corrección del módulo de mantención — 2026-11-05

Se ejecutó el plan de corrección derivado de la auditoría estática del 2026-11-04. El detalle completo, con archivo y prueba por hallazgo, está en [2026-11-04-auditoria-mantencion-codigo.md](2026-11-04-auditoria-mantencion-codigo.md).

- **PASS — Puertas:** typecheck sin errores; lint 0 errores (1 warning preexistente); `check:secrets` verde; PGlite 4.350 pruebas verdes; migraciones 372 entradas verificadas.
- **PASS — Navegador:** 57 pruebas E2E de mantención en Chromium (app, jefatura, equipos, pautas, permisos y OT), incluida la apertura de la OT desde la tarjeta de taller.
- **PASS — `test:fast`:** 18.446 pruebas verdes, 0 fallos. Se corrigieron además los cuatro fallos ajenos que dependían del entorno (lock de LibreOffice, variable `$image` del deploy, flags de Chipax y correo DTE del shell) y el warning de lint de `ot-model.ts`.
- **LÍMITES:** no se ejecutó la suite E2E completa, Safari/Android reales ni lector de pantalla; la migración 0371 no se aplicó en producción.

# Historial anterior de mantención — verificación dirigida, 3 de noviembre de 2026

## Alcance y ambiente

Se probó el importador y la consulta del módulo vigente `/mantencion/*`, en una base PostgreSQL E2E creada para esta prueba y una aplicación local. Se usaron respuestas y usuarios sintéticos para el recorrido de navegador. La base y el servidor temporales se eliminaron al finalizar. La base activa `bodega` de producción se consultó sólo en lectura para contrastar equipos y faenas; no se escribió en ella.

## Resultado y evidencias

- **PASS — Archivo real en memoria:** las cinco hojas aportaron 2.157 trabajos. La primera importación temporal guardó 2.157; una segunda reconoció 2.157 sin cambios y no generó filas en `mant_records`.
- **PASS — Conciliación sobre la flota de producción consultada:** 1.370 filas se asociaron inequívocamente; 771 no encontraron equipo, 16 tienen discrepancias y 9 tienen una faena no resuelta. Los resultados describen la instantánea consultada, no una importación a producción.
- **PASS — Integración PostgreSQL/PGlite:** 60 pruebas dirigidas entre importación histórica, hoja de vida y registros existentes. Se verificaron reimportación, auditoría, conflictos, asociaciones manuales y alcance por faena.
- **PASS — Validaciones de código:** typecheck del repositorio, ESLint de los archivos modificados, 24 pruebas unitarias y de componentes dirigidas y `git diff --check`.
- **PASS — Navegador Chromium:** una prueba recorrió vista previa, confirmación, búsqueda, detalle, conciliación manual, enlace desde la ficha del equipo y reimportación. También confirmó que un supervisor de Biodiversa no ve un antecedente sin faena y no puede importar.
- **PASS — Adaptación:** vista previa de escritorio 1280 × 720 y lista de supervisión 390 × 844. La lista móvil presenta tarjetas y no desborda horizontalmente. Capturas locales: [vista previa](evidencia-mantencion-historico-2026-11-03/vista-previa-desktop.png), [supervisión móvil](evidencia-mantencion-historico-2026-11-03/historial-supervision-movil.png).
- **PASS — Consola y red:** la última ejecución no detectó errores de consola, errores de página, respuestas HTTP 5xx ni solicitudes fallidas; se ignoraron únicamente precargas `_rsc` canceladas según el contrato del repositorio.
- **PASS — Migración:** verificación de la cadena y checksums; una segunda generación informó que no hay cambios pendientes en el esquema.

## Problemas encontrados y corregidos durante el recorrido

- El selector de archivo se podía mostrar habilitado antes de activarse en el cliente. Se mantiene deshabilitado hasta completar la hidratación.
- El listado móvil inicialmente sólo mostraba parte de la tabla. Se reemplazó por la representación móvil reutilizable de la plataforma.
- Al completar una asociación, una actualización de página redundante cancelaba la petición de guardado después de recibir respuesta. Se quitó la actualización duplicada y la ejecución final no reprodujo esa cancelación.

## Advertencias y límites

- **AUTOMATION WARNING:** una ejecución anterior encontró una petición cancelada; se investigó y corrigió antes de la ejecución final. No se trató el fallo del localizador de una iteración intermedia como un defecto del producto.
- **COVERAGE GAP:** no se ejecutó la suite E2E completa, ni pruebas en Safari/Android reales, ni lector de pantalla. No se verificaron descargas ni permisos de los enlaces a Drive del archivo original.
- **COVERAGE GAP:** no se aplicó la migración ni se desplegó o importó el archivo en producción. El módulo de producción no tenía perfiles de equipo de mantención en la consulta realizada; la preparación de equipos es independiente de importar el historial.
- **IMPROVEMENT OPPORTUNITY:** las asociaciones pendientes requieren revisión de jefatura; la carga conserva las respuestas y permite localizarlas con el filtro de vínculos.
- **Seguridad del ambiente de prueba:** durante el diagnóstico se mostró accidentalmente una cookie de una sesión E2E temporal. El servidor con su clave temporal se detuvo, la base E2E se eliminó y se borraron las trazas de la prueba. No correspondía a una sesión de producción.
- **React Doctor:** el ejecutable disponible revisó los cambios sin señalar archivos de esta implementación; reportó siete advertencias en otros archivos. No pudo calcular la puntuación por falta de conexión al servicio de puntaje.

## Ajuste posterior: fotos y hora de envío

- Por indicación del usuario se conservan las horas trabajadas, pero se omiten las columnas de fotos y stickers y sólo se guarda la fecha de envío. La hora de envío puede intervenir en la identificación interna de una respuesta, pero no se muestra ni se guarda como dato operativo.
- **PASS — Excel real:** 2.157 filas procesadas en memoria; ninguna conservó columnas de fotos ni hora de envío y las 2.157 conservaron las horas trabajadas. Al reimportar una copia sin fotos ni horas de envío, las 2.157 se reconocieron sin nuevas filas.
- **PASS — Regresión dirigida:** pruebas de lectura e importación cubren la ausencia o cambio de fotografías y hora, la verificación del origen y la detección de cambios reales del contenido.
- **PASS — Chromium:** en una base E2E desechable, el detalle mostró la fecha sin hora ni enlaces de fotos; se importó una respuesta sin hora y, al reimportarla con hora y enlaces cambiados, no se crearon duplicados. Se comprobó también el alcance por faena y la resolución manual. No se guardaron trazas de sesión; el servidor y la base temporal se retiraron.
- **AUTOMATION WARNING:** una primera tentativa de navegador se interrumpió durante la compilación inicial y otra alcanzó el tablero tras vencer el tiempo de espera del login. La ejecución final, con el servidor compilado, pasó.
- **COVERAGE GAP:** el ajuste sigue en el workspace; no se desplegó ni se importó el archivo en producción.
