# Camiones de producción en horómetro, Biodiversa en odómetro — sólo Mantención (2026-11-25)

**Estado:** en implementación en la rama `feat/mantencion-unidad-por-equipo` (worktree `bodega-wt/mant-unidad`). Sin datos de producción tocados.

## Decisión del usuario (2026-11-25)

> «Todos los camiones de producción son en horómetro, menos los de Biodiversa, que son en odómetro. Aplícalo.» Luego: «me interesa sólo Mantención por ahora».

Alcance: **sólo Mantención**. Combustible y Flota no cambian: `fuel_vehicles.meter_type` y `performance_unit` se quedan como están, así que no se recalcula ningún rendimiento ni se reabre ninguna decisión de anomalía. Incluye los tractocamiones.

Esto reemplaza el plan anterior de este archivo (que cambiaba el medidor del vehículo) y el supuesto de la spec `2026-11-17-medidor-km-horas-por-equipo.md`: el medidor no alterna por períodos, lo fija la faena.

## Hecho de partida

Mantención sacaba la unidad del **tipo** (`fuel_equipment_types.default_meter_type`, vía `unitFromMeter`). Con el tipo «Camión» en odómetro, no podía haber camiones en horas y otros en km. En `bodega_dev`: 59 camiones y 11 tractos activos, 72 perfiles de camión/tracto, 70 con la pauta «Camiones y tractos» (km) y 510 registros en km. No existe una pauta de camiones en horas.

## Diseño

1. **La unidad vive en el perfil de Mantención:** `mant_equipment_profiles.unit` (`km` | `h`, nulo = la del tipo). Migración `0402`, sin backfill: mientras sea nula nada cambia. Es sólo de Mantención.
2. **Regla de alta** (`lib/mantencion/equipment-unit.ts`): camión o tractocamión (`performance_family = 'camiones'`) en la faena de código `BIODIVERSA` mide en km; en cualquier otra faena, en horas. Los demás tipos miden como su tipo.
3. **Todo lector de la unidad usa el medidor efectivo** (`effectiveMeterSql` en `lib/services/mantencion/unit-sql.ts`: el del perfil y, si no hay, el del tipo) en vez del tipo.
4. **Las lecturas se filtran por la unidad activa.** Un registro en km no alimenta el estado de una pauta en horas; queda como historia.
5. **Los equipos existentes se mueven con un script de una sola vez** (simulación por defecto, respaldo previo, servicios reales), no con la migración.

## Líneas de trabajo

- **A. Flota y registros:** `fleet.ts`, `records-create-context.ts`, `app-history.ts`, `work-orders/query.ts`, `fleet-incorporation.ts`, `schedule-assign.ts`, `schedules.ts`, `catalogs.ts`. Incluye las guardas por unidad (`recentRecords`, `loadVehicleHistory`).
- **B. Looker:** `looker/resolve.ts`, `preventive.ts`, `corrective.ts`.
- **C. Equipo:** `equipment-resolve.ts`, `equipment.ts`, `equipment-import.ts`, `padron-identity.ts`, `vehicle-form`, `seed.ts`, `seed-equipment.ts` y el servicio `setEquipmentUnit`.
- **D. Script de datos:** `scripts/apply-medidor-camiones-2026-11.ts` (después de C).
- **E. Integración:** typecheck, lint, `test:fast`, `test:pglite`, adaptar pruebas que fijaban «la unidad sale del tipo», recorrido en navegador sobre `bodega_dev`.

## Riesgos

- Combustible sigue midiendo estos camiones en km/L; un mismo camión queda con dos unidades (Combustible y Mantención) hasta que se decida alinear Combustible.
- Un traslado entre faenas **no** cambia la unidad del equipo (queda la fijada en su perfil).
- «Maquinaria pesada» trae ítems de maquinaria de oruga (grupo «Tren de rodado y herramienta»): jefatura debe revisar cuáles aplican a camiones.
- Los camiones movidos quedan sin lectura inicial en horas: su estado preventivo arranca con el primer registro en horas o con una preventiva declarada en horas desde la ficha.

## Lo que mostró la lectura de producción (2026-11-25, sólo lectura, autorizada por el usuario)

- La faena `BIODIVERSA` existe con ese código; sus 8 camiones y tractos se quedan en km.
- **62 camiones y tractos** activos con ficha de Mantención se moverían a horas (Arauco, Cholguán, Ecoservitran, Flor del Laja, Masisa, Santa Fe, Servimar, Teno y «Sin ubicación»).
- Todos tienen la pauta «Camiones y tractos» (km). Ninguno tiene lectura inicial, preventiva declarada, registros, ni órdenes de trabajo: **mover la unidad no pierde ningún dato**.
- La pauta «Maquinaria pesada» (300 / 600 / 900 / 1200 h) existe, vigente, con 52 equipos.
- **No hay horómetro de camiones en la plataforma:** el horómetro de GPS (`fleet_gps_latest_positions.hour_meter`) es `0.00` en todos, ninguna carga de combustible lo trae (`fuel_loads.hour_meter_reading`) y la serie de Copec es de kilómetros. El consolidado de formularios del repo mezcla horas y km sin columna de unidad, trae valores basura (111, 1111, 11111) y no tiene lecturas para 21 de los 62.

## Decisiones

1. ~~Pauta en horas.~~ **Resuelta (usuario, 2026-11-25):** «Maquinaria pesada». El script la toma con `--pauta-horas "Maquinaria pesada"`.
2. ~~Lectura inicial en horas.~~ **No bloquea:** no hay una fuente confiable y ninguno de los 62 tiene una lectura en km que perder. Se corre sin `--lecturas`; el horómetro entra con el primer registro del mecánico o con una preventiva declarada en horas.
3. ~~Los 6 camiones de «Sin ubicación».~~ **Sí pasan a horas** (usuario, 2026-11-25).
4. **Escribir en producción: pendiente de autorización explícita.** El usuario autorizó sólo leer. Orden: fusionar la rama, desplegar (migración `0402`, la corre el usuario), respaldo con `pg_dump`, simulación y recién entonces `--apply`.
