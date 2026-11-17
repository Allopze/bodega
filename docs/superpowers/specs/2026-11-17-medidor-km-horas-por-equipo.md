# Medidor km u horas por equipo — propuesta (2026-11-17)

**Estado:** propuesta, sin implementar. Espera las decisiones de la sección 5.

## Pedido

> «Camiones pueden hacer horas y kilómetros, depende de qué estén haciendo; cambiar entre uno y otro debe ser fácil para el usuario.» (usuario, 2026-11-17)

Caso que lo gatilló: KPL-133 (PFJX-24) y KPL-134 (VDGS-52), camiones de Santa Fe. Su reporte diario anota horómetro (+4–6 h por turno: 6602 → 6638 y 1532 → 1552 del 2 al 9-11). En las cargas Copec aparecen dos series mezcladas, ambas guardadas como `odometer`:

- **Horas:** KPL-133 de 5957 a 6112 entre marzo y mayo. KPL-134 de 627 a 1298 entre enero y agosto.
- **Km:** KPL-133 de 48.611 a 53.083 entre enero y octubre, unos 500 km/mes. KPL-134 de 5.416 a 19.935.

En la plataforma figuran como «camión», `meter_type = odometer`, `performance_unit = km_per_liter` y pauta «Camiones y tractos» (km).

## Hallazgo central

La unidad de un equipo vive hoy en **dos fuentes que ya pueden divergir**:

| Módulo | De dónde sale la unidad | Dónde se lee |
|---|---|---|
| Mantención | Del **tipo**: `fuel_equipment_types.default_meter_type` vía `unitFromMeter` | `lib/services/mantencion/fleet.ts:112`, `equipment-resolve.ts:137` y `:188`, `fleet-incorporation.ts`, `records-create-context.ts:62`, `work-orders/query.ts:260`, `schedule-assign.ts:54`, `catalogs.ts:77` |
| Combustible, GPS, Copec y terreno | Del **vehículo**: `fuel_vehicles.meter_type` y `performance_unit` | Combustible en general |

La unidad ya viaja por fila en casi todo:

- `fuel_meter_readings.meter_type`
- `fuel_equipment_loads.meter_type` y `performance_unit`
- `fuel_tae_submissions.meter_type`
- `fuel_operation_records.medido_por`
- `mant_records.unit`
- OT con `entry_odometer` y `entry_hourmeter`

Lo único que obliga a una sola unidad por equipo es:

- `fuel_vehicles.meter_type`
- `mant_schedules.unit`, una por pauta
- `mant_equipment_profiles`, con una pauta y una lectura inicial
- la serie de rendimiento, que tiene una sola ancla

## Cómo se cambia hoy

Hay dos caminos. Los dos son globales y ninguno deja un historial consultable.

1. **Cambiar el tipo** (Flota › Editar vehículo › Tipo).
   - Se bloquea si el equipo tiene registros de Mantención o una pauta en otra unidad (`equipment-resolve.ts:388-392`, `equipment.ts:452`). Para KPL-133 y KPL-134 está bloqueado.
   - Cuando sí pasa, no recalcula la serie de rendimiento.
2. **Cambiar «Tipo de medidor»** (Flota › Editar vehículo › Combustible, `vehicle-form.tsx:414`).
   - No tiene bloqueo.
   - Recalcula **toda** la historia con la unidad nueva (`actions-module/vehicles.ts:326-340`).
   - Deja Mantención en la unidad vieja.

## Lo que se rompe si un equipo alterna

- **Mantención:**
  - `recentRecords` (`fleet.ts:297`) y `loadVehicleHistory` (`records-create-context.ts:113`) no filtran por `mant_records.unit`. Después de 120.000 km, una lectura de 5.000 h se rechaza o deja el estado de pauta sin sentido.
  - El registro del teléfono no lleva la unidad (`contracts.ts:78`).
  - La OT derivada de un hallazgo de inspección rotula la lectura con `vehicle.meterType` (`prevention-inspections/runs.ts:~964`).
- **Rendimiento:** `computeVehicleSeries` usa una sola ancla. Con dos series da `meter_regression`, `implausible` y outliers falsos. `recomputeVehicleSeries` reetiqueta todo el pasado.
- **Ingesta:**
  - Copec decide `meterType` desde el vehículo (`meter-readings.ts:152-179`), y de ahí sale la mezcla actual.
  - El formulario de terreno fuerza el medidor del vehículo.
  - La planilla de operaciones descarta la lectura cuyo `medido_por` no calza con la del vehículo.
- **Anomalías:** el detector de retroceso y salto genera casos falsos sobre KPL-133 y KPL-134.

## Propuesta recomendada: «medidor activo» con historial fechado

1. **Tabla `fuel_vehicle_meter_periods`.**
   - Columnas: `vehicle_id`, `meter_type`, `performance_unit`, `effective_from`, `effective_to`, `reason`, `changed_by`.
   - `fuel_vehicles.meter_type` y `performance_unit` quedan como copia del período vigente, para no tocar a los ~40 lectores actuales.
   - Se backfillea un período abierto por vehículo.
2. **Mantención toma la unidad del vehículo**, no del tipo. El tipo queda sólo como valor por defecto al dar de alta.
3. **Las lecturas de Mantención se filtran por la unidad activa.** Al volver a la unidad anterior, el equipo retoma con su última preventiva y lectura en esa unidad. El registro del teléfono lleva `unit`: si no calza con el período, responde 409 «El equipo cambió de medidor».
4. **La ingesta resuelve la unidad por la fecha del período**: Copec por `effectiveOn`, GPS por el instante, terreno con el medidor vigente como valor por defecto. Una lectura que calza con la otra serie recibe una sugerencia «¿es horómetro?», que se corrige con un clic con el `MeterCorrectionDialog` que ya existe.
5. **Rendimiento por (equipo, medidor).**
   - La ancla es propia de cada unidad. Al cruzar de período no se calcula un delta entre unidades.
   - Nunca se promedia km/L con L/h; cada carga ya guarda su `performance_unit`.
6. **Una pauta por unidad.** La pauta sigue a la unidad activa. Al cambiar, se propone la última pauta que el equipo usó en esa unidad.
   - Hoy no existe una pauta de camiones en horas: hay que crearla, por ejemplo «Camiones en planta (h)».
   - «Lo que venza primero» no entra aquí: es la alternativa B.
7. **UI.**
   - En la cabecera de la ficha de Flota y de la de Mantención va un chip: «Mide en: Horas · desde 03-11 · Cambiar».
   - «Cambiar» abre un diálogo con `SegmentedControl` Km/Horas, `DatePicker` «desde», pauta, lectura inicial si hace falta y un motivo.
   - Debajo va el historial de medidor.
8. **Permisos:** reutilizar `mant:equipment:manage` o `admin:fleet_vehicles`, a menos que el supervisor de terreno también deba poder cambiarlo.

**Migración:** una sola, con la tabla de períodos, el backfill y `unit_change` en el `check` de `mant_equipment_history.action`. Todo lo demás no necesita migración.

### Alternativas

- **B. Ambos medidores en paralelo.** Cada lectura declara su unidad y la pauta es «lo que venza primero». Sólo conviene si el camión mezcla los dos usos en la misma semana. Las fases 1 y 2 de abajo son su base.
- **C. Dos tipos («Camión km» / «Camión horas»).** Es lo que existe hoy y no sirve: el cambio está bloqueado con registros o pauta, no deja historial y reescribe el pasado.

## Fases (cada una desplegable y con pruebas deterministas)

1. Guardas sin migración:
   - filtrar por unidad en `recentRecords`, `loadVehicleHistory` y el catálogo del teléfono;
   - corregir el rótulo de la OT derivada.
2. Serie de rendimiento partida por medidor, sin migración. La regresión exige que un equipo de una sola unidad salga idéntico.
3. Migración, períodos, backfill y servicio `changeVehicleMeter`, sólo hacia adelante.
4. Ingesta por período (Copec, GPS, terreno, planilla de operaciones). Mantención toma la unidad del vehículo y el teléfono manda la unidad.
5. UI (chip, diálogo, historial), paridad de permisos y cambio retroactivo con recálculo.
6. Reclasificar el pasado de KPL-133/134 con un script en simulación sobre datos reales.
7. Opcional: alternativa B.

## Preguntas abiertas

1. ¿KPL-133/134 alternan por semanas o meses, o mezclan km y horas en la misma semana? Esto decide entre A y B.
2. ¿Tienen físicamente horómetro y odómetro? ¿Quién anota cada uno: el operador en el surtidor, el reporte diario o el mecánico?
3. ¿Qué pauta en horas usan los camiones en planta? Hay que preguntarle a Alexis.
4. ¿Quién puede cambiar la unidad: jefatura de mantención y admin de contrato, o también el supervisor de terreno?
5. ¿Hay más equipos con uso mixto (camionetas, cargadores que salen a ruta)?
6. ¿El horómetro del reporte diario debe alimentar la lectura de Mantención?
