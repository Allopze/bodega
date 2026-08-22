# Plan actualizado — Reporte de Equipos e inspecciones de flota

Fecha de actualización: 2026-08-22.

## Decisión operacional definitiva

El mecánico **no participa como usuario de Chome**. No se crea rol `mecanico`, no se le otorgan permisos y no se diseña una sesión para taller.

El flujo correcto es:

1. El operador y el mecánico completan el reporte físico en terreno/taller.
2. El **jefe de faena** —rol técnico existente `jefe_terreno`— traspasa el reporte a la plataforma.
3. La foto o PDF del papel firmado queda como evidencia fuente del run.
4. El jefe de faena responde los ítems contra el equipo real de Flota y completa el acta digital.
5. Otra persona autorizada revisa el run; la segregación ejecutor/revisor se mantiene.
6. Una falla genera hallazgo. Si corresponde, deriva CAPA y una OT enlazada.
7. Sacar el equipo de servicio sigue siendo una decisión confirmada por quien administra vehículos; una inspección no lo hace automáticamente.
8. Completar la OT acredita evidencia CAPA y devuelve el activo a operativo sólo si esa OT administraba su estado y no existe otra OT activa que lo mantenga detenido.

## Estado de F0–F8

### F0 — RBAC y alcance

- `jefe_terreno` es el jefe de faena en el modelo actual.
- `prevention:inspections:ingest` identifica de forma explícita el traspaso del documento físico.
- El rol puede ver, ejecutar e ingerir inspecciones dentro de sus faenas.
- No existe ni debe agregarse un rol `mecanico`.

### F1 — Equipo de flota como sujeto

- Programas y runs aceptan `subjectVehicleId` con FK real.
- Recurso de emergencia y vehículo son sujetos mutuamente excluyentes.
- La validación servidor comprueba que el activo pertenece a la misma faena.
- El nombre del activo se congela como evidencia y el selector agrupa recursos y vehículos.
- El scheduler propaga el vehículo desde el programa al run.

### F2 — Ingesta por jefe de faena

- La carga del reporte físico requiere `prevention:inspections:ingest`.
- La acción y el servicio vuelven a comprobar permiso y alcance por faena.
- El documento fuente admite imagen/PDF y queda versionado como evidencia del run.
- Ninguna pantalla ni prueba debe hablar de una sesión de mecánico.

### F3 — Responsable CAPA

- El responsable se elige entre usuarios activos asignables de la faena, no sólo entre ejecutores de inspecciones.
- La creación de CAPA y OT derivada es transaccional e idempotente por hallazgo.

### F4 — Reporte de Equipos

- La definición `reporte_equipos` representa una instancia diaria por equipo y turno.
- Horómetro y valores cuantitativos usan campos numéricos.
- El acta conserva resultado, restricciones y las firmas/nombres del papel; la foto o PDF es la evidencia del trazo.
- `applicableTo` declara que el jefe de faena es quien traspasa el registro a Chome.

### F5 — Hallazgo, CAPA y propuesta de detención

- Las fallas críticas derivan hallazgos con prioridad y detención propuesta.
- Crear CAPA puede crear una OT enlazada en la misma transacción.
- Cambiar el estado operacional exige el permiso de administración de vehículos.

### F6 — Cierre OT → evidencia CAPA

- Completar la OT activa evidencia CAPA automática.
- Reabrir o cancelar una OT completada supersede esa evidencia sin borrar la historia.
- La OT tiene código durable, prioridad, responsable, SLA, tareas, repuestos, mano de obra, garantía, causa raíz, downtime, costos y aprobación segregada.
- El estado del activo se sincroniza sólo durante el ciclo administrado por la OT.

### F7 — Programación y PDTP

- La plantilla 2026 vincula la ejecución del Reporte de Equipos con la actividad n=25.
- La revisión segregada acredita la n=26 al pasar el run a `reviewed`.
- La n=28 permanece fuera del crédito por run porque es una revisión semanal del conjunto de reportes y hallazgos.
- La programación usa frecuencia diaria, un programa por equipo/turno y materialización idempotente por `(programId, scheduledFor)`.

### F8 — Verificación

Las pruebas se ejecutaron después de terminar los cambios, por instrucción del usuario. Evidencia local de cierre:

- unitarias/focused verdes y `test:fast`: 536 archivos aprobados, 29 omitidos; 4566 pruebas aprobadas, 266 omitidas;
- PGlite completo: 76/76 archivos y 854/854 pruebas;
- PostgreSQL real secuencial de inspecciones: 50/50 pruebas para FK, scope, idempotencia y transacciones;
- E2E Chromium final secuencial sobre base desechable: 470 aprobados, 3 omitidos y 0 fallos;
- el E2E de `jefe_terreno` acredita subir papel, digitar la falla y completar sin capacidad de revisión; los escenarios segregados existentes acreditan revisión, CAPA, OT y detención confirmada;
- migraciones 0204/0205 generadas, cadena de 206 entradas verificada y segunda generación sin drift;
- ESLint, TypeScript, secretos, auditoría de seguridad, aliases Drizzle y build limpios;
- React Doctor: 76/100, 19 advertencias revisadas; no quedan hallazgos nuevos del servicio y las capacidades booleanas independientes de Flota/Mantenciones son RBAC intencional.

## Cierre de Control operacional asociado

### Auditoría posterior al cierre — 2026-08-22

La revisión adversarial posterior corrigió 18 brechas de contrato en Mantenciones, Flota y el hub operacional: transiciones y downtime de OT, invalidación/segregación de aprobación de costos, tareas cerradas, lectura canónica por tipo de medidor, responsables activos y acotados por faena, fallback de recordatorios, políticas globales, MTTR correctivo, permiso de equipos de servicio, búsqueda/exportación/paginación coherentes de Flota y alcance SQL de sus documentos. También se amplió a 120 s el setup de PostgreSQL real porque la cadena fría de 206 migraciones ya excede el timeout histórico de 60 s; no se relajaron aserciones.

Evidencia posterior: 61 regresiones unitarias focalizadas verdes; `test:fast` final 536 archivos/4.580 pruebas aprobadas (29/266 omitidas); PGlite completo 76/76 archivos y 854/854 pruebas, más 6/6 focalizadas de Flota tras hacer real el límite de detalles por página; PostgreSQL real 50/50; E2E Chromium focalizado 22/22, más repetición final de Flota 2/2; migraciones verificadas y segunda generación sin drift; ESLint, TypeScript, secretos, auditoría de seguridad, aliases Drizzle y build final limpios. React Doctor no pudo repetirse: el sandbox bloqueó DNS y la ejecución externa del paquete fue rechazada por política de seguridad, por lo que el 76/100 anterior no se presenta como prueba del estado posterior. Sin commit, push, despliegue ni verificación de producción.

Además del puente Inspección → CAPA → OT, la remediación incorpora:

- paginación server-side y exportación Excel de Flota/Mantenciones;
- búsqueda, filtros, deep links, tarjetas móviles y controles accesibles;
- planes preventivos configurables por fecha/uso;
- gestión documental versionada y políticas obligatorias por clase de activo;
- SLA, recordatorios, escalamiento y scheduler versionado;
- hub `/control-operacional`, contrato unificado de activos y reportes Excel de disponibilidad, MTBF, MTTR, downtime, backlog, cumplimiento y costos;
- detalle de Flota sin la consulta N+1 de impacto por mantención.

T35–T39 quedaron cerradas con evidencia local. T30 permanece pendiente porque corresponde al ledger/reproceso CO-027 ya abierto en T19, no al flujo de inspecciones. No hay prueba de despliegue ni de producción en este plan.
