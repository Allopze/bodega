# Historial de mantenciones — vista unificada, 2026-11-25

`/mantencion/registros/historicos` pasó de ser la lista plana de respuestas de Forms («Historial anterior») a una
vista única de **formularios + órdenes de trabajo + registros firmados**, con resumen, matriz de equipos por mes,
Excel, vista previa, ficha tipo resumen y una línea de tiempo en la hoja de vida de cada equipo. Sin migración, sin
permiso nuevo y sin cambios en `modules/*` (la ruta y su guard no cambian).

## Qué cambió

- **Una sola fuente.** La lista, el resumen, la matriz y el Excel salen del mismo arreglo (`loadMaintenanceHistory`,
  que reutiliza `loadMaintenanceWork` del Panel con `detail`): su total es el «Trabajos del período» del Panel, que
  ahora enlaza a la lista (cierra PANN-4). Mismo corte de los formularios (2026-12-01) y mismo alcance por faena.
- **Tres vistas** (`?vista=`): `historial` (por defecto, últimos 12 meses), `matriz` («Equipos por mes») y
  `formularios` («Respuestas de formularios»): la lista plana de siempre, con la conciliación de equipo y faena y
  todas las respuestas (también pruebas y posteriores al corte).
- **Lista legible:** orden por columna, agrupar por equipo o mes, filtros (período, faena —también cerradas—,
  origen, búsqueda y, en «Más filtros», responsable y especialidad), tipo en un solo control con conteos, vista
  previa lateral, «Exportar Excel» (`mant:export`, mismo alcance, auditado).
- **Ficha del trabajo del formulario:** resumen en lenguaje natural, «trabajo anterior/siguiente» del mismo
  equipo (cronológico) y los datos originales plegados.
- **Hoja de vida del equipo:** línea de tiempo de las tres fuentes (sin corte, sin repetir lo que ya muestra su OT);
  la vista de un equipo sigue al equipo trasladado (decisión 2026-11-22).
- **Renombrado:** «Historial anterior» → «Historial de mantenciones»; «Importar historial anterior» → «Importar
  respuestas de formularios». El valor «Historial de formularios» del Excel del Panel no cambia.

## Verificación

Árbol probado: rama `feat/historial-mantenciones` (base `b848c1423`), worktree aparte, sin los cambios sin commitear de
otras sesiones. Base de datos E2E desechable propia y puerto propio (no se usó `bodega_e2e` ni `:3100`).

- **PASS · puertas.** `typecheck` y `lint` completos con exit 0; `test:fast` **22.405 pasan, 1 falla, 277 omitidas**
  (1.522 archivos); `test:pglite` **5.801 pasan, 1 omitida** (447 archivos); `db:verify-migrations` 403 entradas hasta la
  0402 (este trabajo no agrega migración). La única falla de `test:fast` es `scripts/backup-env-whitelist.test.ts`, que ya
  falla en la base (`b848c1423`): el compose inyecta `ONWAY_CAPTCHA_*` y la lista de variables del respaldo no las trae.
- **PASS · E2E sobre build de producción** (`next build` + servidor, no `next dev`): `mantencion-historial.spec.ts` **8/8**
  y `mantencion-historico.spec.ts` **1/1**, sin errores de consola ni respuestas 4xx/5xx del origen. Verifican en
  navegador: la lista une formularios y OT con el mismo total que el Panel (y el Panel enlaza a ella), paginación de 25,
  búsqueda, orden y agrupación por URL, vista previa con teclado y su enlace a la ficha, descarga real del `.xlsx` leída
  con `exceljs` (mismas filas que la lista y con un filtro), celda de la matriz que lleva a su lista, ficha con datos
  originales plegados y vecinos cronológicos, línea de tiempo en la hoja de vida y 390 px sin desborde de la página.
- **PASS · PGlite del servicio** (`mantencion-history-pglite.test.ts`, 40 casos; `mantencion-history-export-pglite.test.ts`,
  35): el total de la lista es el del Panel para 8 perfiles de visor; corte del 01-12; pruebas, OT anuladas y sin ingreso
  a taller fuera; un registro con OT no se repite; alcance por faena; la hoja de vida sigue al equipo y `?faena=`
  explícita no lo amplía; `includesOrders`; contenido de cada fuente (`detail`); vecinos; y, para el Excel, autorización
  (sin lectura del historial no hay libro), alcance, mismas filas que la lista, filtros releídos en el servidor, celdas con
  fechas reales, ninguna fórmula, auditoría, metadatos y tope de filas.
- **PASS · pruebas de componentes:** 101 en `components/mantencion/historial` (tabla, vista previa, filtros, matriz, línea
  de tiempo, resumen) más las de la hoja de vida y el Panel.
- **PASS · revisión independiente de solo lectura:** sin hallazgos críticos ni altos; 5 medios y 10 bajos. Corregidos con
  prueba: exportar sin permiso de lectura del historial (M1), el enlace de la línea de tiempo con una cifra que la lista
  no repetía (M2), el botón posterior a importar que llevaba a una lista sin lo importado (M3), la ventana de 14 meses de
  la matriz sin avisar (M4), el rango de fechas inválido ignorado en silencio (M5), nombre accesible de la vista previa que
  no contenía el texto visible, faena inventada que dejaba un estado vacío engañoso, textos distintos para el taller
  externo, «Limpiar filtros» que dejaba el tipo, orden con lo sin dato primero y página conservada al ordenar. Las pruebas
  del Excel sacaron dos defectos reales, corregidos: una `?faena=` fuera de alcance daba un libro vacío (la lista la trata
  como «sin filtro») y «Filtros aplicados» listaba `taller: null`.
- **PASS · revisión visual** a 1440 y 390 px (lista, resumen, matriz, vista previa, ficha, «Respuestas de formularios» y
  línea de tiempo). Ajustes que salieron de ahí: los gráficos van en un bloque plegable, «Más filtros» (A2), el % de
  correctivas no se repite (A5), la matriz no lleva el resumen encima y la línea de tiempo va antes de «Hoja de vida».
- **PASS · datos reales (producción, SOLO LECTURA, autorizado por el usuario el 2026-11-25).** Un bundle de la capa de
  servicio corrido por stdin en el servicio `backfill-invoice-reconciliation`, con el cliente de la app protegido contra
  escrituras (`insert`, `update`, `delete` y `transaction` revientan) e imprimiendo sólo agregados. Log:
  `~/backups-prod/prod-2026-11-25-historial-verificacion.txt`. En producción hay 2.346 respuestas de formularios, **0
  registros firmados y 1 OT (anulada)**: hoy la vista es de formularios, y las otras dos fuentes empiezan a llenarse desde
  ahora. Resultados:
  - La lista y el Panel devuelven **exactamente los mismos trabajos** (mismos ids) en tres períodos: últimos 12 meses
    (1.705), todo el historial (2.343) y mes en curso (35); el resumen suma lo mismo.
  - Los 3 trabajos que separan 2.346 de 2.343 son las 2 respuestas de prueba y **1 con fecha 2027-07-20** (un error de
    digitación del formulario): no aparece en la lista ni en el Panel, sólo en «Respuestas de formularios».
  - 8 respuestas sin equipo vinculado (6 en los últimos 12 meses), 0 sin faena, 142–149 «sin clasificar» según el período.
  - Rendimiento: cargar el período entero tarda 85–135 ms; filtrar y ordenar, 35 ms (1.800 KB de JSON en el servidor para
    «todo el historial»; al navegador sólo llegan las 25 filas de la página).
  - Línea de tiempo del equipo con más historia: 77 trabajos, igual que la lista de ese equipo; carga en 6 ms.
- **SIN CAMBIO · rojo previo en la base.** Al correr los specs de Mantención vecinos fallan 7 (`mantencion-1-app:166`,
  `3a-equipos:33`, `3b-pautas:65`, `4-permisos:72`, `5-ot:280`, `panel-looker-cobertura:63`, `panel-looker:83`; 53 más no
  corren por dependencia). **Fallan igual en la base `b848c1423`** (comprobado con un build aparte: mismos 7 fallidos,
  mismos 53 sin correr): todos son de la unidad km/h por equipo, cuyos commits no actualizaron esos specs. Pasan los demás
  (111): resto de Mantención, `ficha-vehiculo`, `control-operacional-navegacion`, `densidad-kpi*` y `reflow-anchos`.

## Decisiones y límites conocidos

- La línea de tiempo no aplica el corte: una respuesta de Forms posterior al 01-12 y un registro de la plataforma
  del mismo trabajo pueden aparecer los dos. Por eso su enlace al historial completo no lleva una cifra.
- La lista cuenta por la faena del trabajo; con `?equipo=` sigue al equipo. En ese caso el total puede diferir del
  Panel (que no sigue al equipo) para quien sólo ve la faena a la que el equipo llegó.
- La matriz dibuja a lo más 14 meses y 60 equipos (lo dice en pantalla). La faena de una fila es la del trabajo más
  reciente, no la actual del equipo.
- No se parsea la lectura del formulario (texto libre): se muestra tal cual.
- La lista lee todo el período en cada petición (hoy unos pocos miles de filas); si el volumen nativo crece, habría
  que filtrar y paginar en SQL. El Excel corta en 20.000 filas y lo dice dentro del libro.
- Defecto previo, no tocado: `DatePicker` (`components/ui/date-picker.tsx`) formatea con `formatDate` un `Date` local
  a medianoche: en un host al este de Santiago (p. ej. `TZ=UTC`) muestra el día anterior. En Chile no se nota.
- Observación de código compartido: `sanitizeCell` (`lib/reports/export-module/excel-builder.ts`) antepone `'` a los
  textos que empiezan con `=`, `+`, `-` o `@`; el apóstrofo se ve en Excel en todos los libros.
- `scripts/backup-env-whitelist.test.ts` falla en la base (`b848c1423`): el compose inyecta `ONWAY_CAPTCHA_*` y la lista
  de variables del respaldo no las trae. No es de este trabajo.

## No cubierto

- Safari/Android reales, lector de pantalla y teclado en el Select de Radix.
- Rendimiento con volumen real (no se midió).
- El tope real de 20.000 filas (la prueba lo simula con un valor menor).
