# To-do de remediación UI/UX — Inspecciones

Fecha de inicio: 2026-08-24  
Auditoría base: `AUDITORIA_UI_UX_INSPECCIONES.md`  
Leyenda: `[ ]` pendiente · `[~]` en curso · `[x]` resuelto y verificado

## Estado general

- [x] Corte 1 — Bandeja fiel a la tarea y creación segura
- [x] Corte 2 — Ejecución móvil, evidencia y continuidad
- [x] Corte 3 — Reporte de Equipos, revisión y CAPA
- [x] Corte 4 — Plantillas y programación
- [x] Corte 5 — Inicio de Prevención, pruebas y capturas finales
- [x] Corte 6 — E2E completos y evidencia visual de estados operativos

## Hallazgos

### Bandeja y creación

- [x] **UX-I-01** — Crear representación móvil sin tabla horizontal para bandeja y checklist.
- [x] **UX-I-08** — Mostrar `completed` como “Pendiente de revisión” en superficies orientadas a tarea.
- [x] **UX-I-09** — Unificar filtros de resumen, total paginado y filas.
- [x] **UX-I-10** — Llevar “Programaciones vencidas” a una vista real de vencidas.
- [x] **UX-I-11** — Transferir estado, faena, búsqueda y vista rápida al Excel.
- [x] **UX-I-12** — Hacer la búsqueda estable, funcional y disponible en móvil sólo donde aplica.
- [x] **UX-I-13** — Exigir selección consciente de plantilla/faena y reiniciar sujeto al cambiar alcance.
- [x] **UX-I-14** — Priorizar inspecciones vencidas/urgentes en la bandeja.
- [x] **UX-I-32** — Consolidar acciones secundarias en móvil.
- [x] **UX-I-34** — Mantener visible el pie de confirmación de diálogos móviles largos.

### Ejecución y continuidad en terreno

- [x] **UX-I-02** — Acercar checklist y acciones principales mediante composición task-first y barra persistente.
- [x] **UX-I-03** — Adjuntar evidencia en el mismo recorrido de respuesta, sin segunda pasada.
- [x] **UX-I-06** — Corregir la promesa offline y proteger el trabajo que realmente se encola.
- [x] **UX-I-15** — Separar progreso obligatorio de total y explicar el denominador del cumplimiento.
- [x] **UX-I-16** — Confirmar guardado de forma persistente y cercana.
- [x] **UX-I-17** — Deduplicar bloqueos y enlazarlos al ítem que debe corregirse.
- [x] **UX-I-19** — Mostrar ubicación guardada, propósito y opcionalidad.
- [x] **UX-I-30** — Sustituir el token visual inexistente.

### Reporte de Equipos, responsabilidades y CAPA

- [x] **UX-I-04** — Presentar la planilla física antes de la digitación.
- [x] **UX-I-05** — Usar visor de imagen/PDF y refresco sin perder borrador.
- [x] **UX-I-07** — Explicar ejecutor/transcriptor/revisor y anticipar la segregación.
- [x] **UX-I-18** — Exigir responsable CAPA y mostrar gravedad/plazo antes de derivar.
- [x] **UX-I-31** — Unificar permisos de encabezado y celdas de acciones.

### Plantillas y programación

- [x] **UX-I-20** — Alinear copy de incorporación, borrador, aprobación y reemplazo.
- [x] **UX-I-21** — Añadir representación móvil y filtros para plantillas/programaciones.
- [x] **UX-I-22** — Seleccionar actividades PDTP por número y nombre.
- [x] **UX-I-23** — Abrir o identificar inequívocamente la ejecución creada.
- [x] **UX-I-24** — Confirmar activación/detención y explicar impacto.
- [x] **UX-I-25** — Evitar periodicidad contradictoria o mostrar claramente la prevalencia.
- [x] **UX-I-26** — Mostrar tipo de sujeto y origen/riesgo en la programación.
- [x] **UX-I-27** — Llevar acciones globales al `PageHeader` y evitar duplicados.
- [x] **UX-I-28** — Reemplazar lenguaje de sembrado por una instrucción para usuario.
- [x] **UX-I-33** — Resolver el estado contradictorio de plantillas retiradas.

### Entrada diaria y evidencia final

- [x] **UX-I-29** — Incorporar ejecuciones/revisiones de inspección a Inicio de Prevención.
- [x] Añadir/actualizar pruebas focalizadas de filtros, estados, formularios y responsividad.
- [x] Ejecutar TypeScript, ESLint y pruebas focalizadas.
- [x] Ejecutar React Doctor sobre cambios y revisar regresiones.
- [x] Regenerar capturas oficiales desktop/mobile, inspeccionarlas y actualizar auditoría.

### Evidencia posterior solicitada

- [x] Ejecutar completas las suites E2E de catálogo, cierre y roles/permisos en Chromium.
- [x] Añadir un fixture y ruta de captura para una inspección en curso.
- [x] Añadir un fixture y ruta de captura para Reporte de Equipos en transcripción.
- [x] Generar las cuatro capturas base desktop/mobile, revisar su UI y reconciliar el manifiesto.
- [x] Actualizar la auditoría con la nueva evidencia y sus límites.

## Registro de avance

- **2026-08-24 16:45 CLT** — Creado el plan y el to-do a partir de los 34 hallazgos. Inicia Corte 1: bandeja, filtros, orden, exportación, búsqueda y creación segura.
- **2026-08-24 17:12 CLT** — Bandeja móvil convertida a tarjetas; búsqueda propia y estable; filtros compartidos por filas, resumen, paginación y Excel; vencidas priorizadas; KPI enlazado a la vista real de programación; estado orientado a tarea; alta sin faena/plantilla preseleccionadas; sujeto limpiado al cambiar faena; acciones móviles consolidadas. Prueba roja→verde del contrato de consulta (4/4), regresiones de cálculo (45/45) y TypeScript verde.
- **2026-08-24 17:22 CLT** — Ejecución móvil convertida a tarjetas por ítem, con navegación por secciones y barra inferior; progreso obligatorio separado del total; bloqueos unificados con saltos; evidencia auto-guarda y adjunta en un solo gesto; confirmación de guardado persistente; offline renombrado según su alcance real; ubicación restaurada y explicada. Reporte de Equipos muestra primero la planilla, soporta PDF y usa `router.refresh`; se aclaran transcripción/revisión y auto-revisión. CAPA exige responsable y anticipa gravedad/plazo. Prueba roja→verde de evidencia, 50 pruebas focalizadas totales, TypeScript y diff-check verdes.
- **2026-08-24 17:34 CLT** — Plantillas y programaciones ganan filtros y tarjetas móviles; incorporación declara borrador/aprobación; PDTP se elige por número y nombre; las acciones globales pasan al encabezado; alta sin preselección y pie fijo; intervalo efectivo aclara qué gobierna el calendario; detener/reactivar exige motivo; crear desde programa abre la inspección; sujeto y riesgo quedan visibles. Inicio de Prevención incorpora los mismos estados accionables de inspección que `Mi trabajo`. TypeScript no reporta fallos del módulo; el chequeo global queda bloqueado por un error ajeno en `compras/[id]/invoices-section.test.tsx`.
- **2026-08-24 17:59 CLT** — Cierre verificado: 57/57 pruebas focalizadas, 73/73 pruebas sobre PostgreSQL real desechable, 19/19 pruebas del capturador, ESLint focalizado y `tsc --noEmit` verdes. El build de producción con Next 16.2.12 pasó incluida su fase TypeScript. React Doctor subió de 82 a 83/100 y dejó de reportar las advertencias de accesibilidad, respuestas HTTP y lookups detectadas; persiste deuda estructural no bloqueante. El barrido final produjo 42 capturas sobre 5 rutas × 2 viewports: 10/10 vistas base HTTP 200, sin errores de cliente, scroll horizontal, artefactos inválidos, faltantes, huérfanos ni duplicados. Capturas revisadas visualmente y auditoría actualizada; UX-I-01–34 quedan resueltos localmente.
- **2026-08-24 19:11 CLT** — Se reabre el seguimiento a solicitud del usuario para ejecutar las tres suites E2E completas y añadir evidencia visual específica de ejecución en curso y Reporte de Equipos. Se usará una base PostgreSQL desechable explícita; Chrome DevTools MCP no está disponible, por lo que la verificación de navegador se hará con Chromium/Playwright y el capturador oficial.
- **2026-08-24 19:29 CLT** — Las tres suites E2E completas quedaron verdes en Chromium: 17/17 casos de catálogo, programación, cierre, CAPA, flota y roles/permisos. La corrida inicial expuso cuatro expectativas antiguas y un defecto real: una actividad PDTP ya acreditada desaparecía del selector al dejar de pertenecer al programa activo. El selector ahora conserva y rotula esas vinculaciones históricas para que puedan retirarse; los cinco escenarios corregidos y la matriz completa pasan.
- **2026-08-24 19:53 CLT** — Corte 6 cerrado. Se añadieron fixtures persistidos para una inspección en curso y Reporte de Equipos con planilla física; el capturador quedó protegido para no heredar el volumen real de archivos. La revisión visual corrigió la imagen rota del standalone, el tipo crudo `equipment` y el selector nativo de fotografías. Pasada final: 14 capturas `capture-ok`, incluidas 4 vistas base desktop/mobile, 4/4 HTTP 200, sin errores de cliente, scroll horizontal, artefactos inválidos, faltantes, huérfanos ni duplicados. Pruebas focalizadas 26/26, TypeScript, ESLint focalizado, `git diff --check` y build de producción verdes. React Doctor conserva 83/100 sin regresión; auditoría actualizada con evidencia y límites.
