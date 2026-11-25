# Carga de Mantención del 24-11-2026: equipos, pautas, ubicación física y alertas

Estado: **borrador para aprobar** (no hay código ni escrituras en prod). Autor: sesión del 2026-11-24.
Fuentes: encargo del usuario del 24-11, respuestas de Alexis del 24-11, `INVENTARIO_EQUIPOS_ACTUALIZADO_17-11-26.xlsx`,
`Cartera_carros_cotejo_documentos`, y una lectura **solo lectura** de prod el 24-11 (176 equipos, 17 faenas, 0 traslados, 0 registros).

## 1. Intención

Dejar Mantención lista para que los mecánicos registren sobre datos correctos: 220 equipos del dataset con su faena, tipo y pauta,
las pautas ajustadas a lo que Alexis marcó, una regla de alertas que no moleste por equipos que no corresponden, y dos figuras nuevas:
**taller** (lugar físico) y **sin ubicación** (estado, no faena). El mecánico registra lectura de partida en su primera visita.

**Metas:** (1) carga idempotente, transaccional y con simulación; (2) alertas solo donde corresponden; (3) carros, bateas y
camionetas dentro de Mantención (correctivas y OT); (4) talleres y «sin ubicación» sin aparecer como faenas.

**No-metas:** crear faenas (ENAP, Campo Pangui, Rodantes); crear mecánicos o usuarios; contenido de las pautas de camionetas y carros;
cargar lecturas desde archivos; desactivar Pacífico; borrar nada.

**Anti-metas (fracaso aunque «funcione»):** un traslado que no deje folio, motivo y auditoría; «Sin ubicación» visible en Prevención o
en indicadores; alertas «al día» sin respaldo; tocar Combustibles al cambiar la unidad de KPL-133/134.

## 2. Restricciones del repositorio (AGENTS.md)

- La faena de un equipo existente cambia **solo** con `transferVehiclesTx` (`lib/services/fleet-transfers.ts`). Nada de `UPDATE` directo.
- Migraciones: solo `npm run db:generate`; checksum con `node scripts/verify-migration-chain.mjs --update-checksums`; nunca editar el journal.
- Cambios de negocio en `lib/` + `app/`. `modules/` solo para navegación, permisos y seed.
- Exportaciones en Excel; fechas con `formatDate`; hoy con `todayInChile()`.
- Prod: lo despliega el usuario; las cargas en prod corren con simulación, respaldo previo y autorización explícita.

## 3. Estado de prod (lectura del 24-11, solo lectura)

- 176 equipos, todos activos; 17 faenas (10 activas, 5 inactivas con 18 equipos, 2 vacías). 36 equipos con la marca «ubicación por confirmar».
- `fleet_transfers` = 0: el traslado nunca se ha usado; las 176 estadías abiertas son «desde siempre».
- Mantención: 125 perfiles, 5 lecturas iniciales, 0 registros, 1 OT. Pautas: «Camiones y tractos» (70 equipos), «Maquinaria pesada» (49 equipos, 37 ítems, v1, nunca editada) y una «Camion» vacía.
- Catálogo de talleres `mant_workshops`: 10 externos (incluye «Eduardo Silva»); **no** hay Taller Cholguán ni Taller Biodiversa.
- Catálogo de marcas: 17. Tipos de equipo sin medidor: Batea, Carro (+ Estanque, Hidrolavadora, Otro).

**Cruce con el dataset (220):** 176 ya existen (0 conflictos, ningún equipo de prod queda fuera); 44 no existen: 8 bajas (no se crean; los anexos B y C no tienen nada
en prod) y **36 altas** (24 activos, 11 `sin_ubicacion`, 1 fuera de servicio). De los existentes: 108 ya están en su faena y 4 no tienen faena destino (KA-134, KA-136, CA-16, CA-86). Con las decisiones de este documento hay **57 traslados**:
51 que pide el dataset, CA-16 → Flor del Laja y 5 `sin_ubicacion` que pasan a la faena técnica (KCB-004, KCB-006, TO-23, TO-34, GR-08).

## 4. Decisiones del usuario (definitivas)

| # | Decisión |
| --- | --- |
| D1 | Mecánicos: no se crean. Se mantienen Marcelo Bastías (Cholguán), Deibis González (Masisa) y Javier Roa (Biodiversa). |
| D2 | **No se añaden faenas.** ENAP, Campo Pangui y Rodantes no se crean. |
| D3 | **Taller** = lugar físico, no faena. «Taller Cholguán» y «Taller Biodiversa» se crean; no aparecen como faenas. |
| D4 | **Sin ubicación** = estado visible del equipo; la faena técnica «Sin ubicación» queda oculta (no aparece en Prevención ni en indicadores por faena). |
| D5 | Equipos de Pacífico → Flor del Laja, salvo los 6 con otro destino explícito en el dataset (CR-45 → Cholguán; CR-47, CR-48, KA-124 → Masisa; H-13, KPL-116 → Santa Fe). |
| D6 | Carros y bateas (sin medidor) entran a Mantención: **correctivas y OT**, sin lectura obligatoria, sin alertas. |
| D7 | Traslados con la **fecha real** del dataset (31-08 / 30-09); la ventana de fechas se amplía **solo** para esta carga. |
| D8 | Ciclo de 1.200 h: se mantiene la regla actual (`suggestInterval`): a 2.100 h sugiere 300; el mecánico puede ajustar a mano. |
| D9 | KPL-133 y KPL-134: **unidad por equipo**, solo en Mantención. Para Combustibles siguen siendo camiones. |
| D10 | La última preventiva que declara el mecánico en su primera visita **cuenta y calcula la próxima**, marcada «declarada por el mecánico, sin respaldo». Jefatura puede reemplazarla con respaldo. |
| D11 | H-13 → patente LCCT-14 (el inventario lo confirma). |

## 5. Decisiones mías (validar al leer)

- C1. GRDW-63 conserva el tipo **Batea** (decisión del 22-11) y su ubicación es Taller Biodiversa. H-16 conserva «fuera de servicio» de prod; ambos van al informe.
- C2. Rodantes = contrato de Santa Fe: sus equipos **se quedan en la faena Santa Fe** (que sigue activa). Administración = **Oficina Central** (en prod no hay otra).
  Cholguán/Teno se mapean a «Cholguan - Arauco»/«Teno - Arauco». ENAP/Campo Pangui: sin traslado; el lugar va en la observación del equipo.
- C3. CA-61 (dataset `sin_ubicacion`) está en **Taller Eduardo Silva** (inventario): ubicación = ese taller, no «sin ubicación». GR-08 (perdido) → «sin ubicación».
- C4. Los equipos con código = patente (GRDW-63, JTBP-17, SXCV-49…) **no reciben código**. Los 13 códigos de bateas y carros de Alexis sí.
- C5. Tipos que no existen (cama baja, furgón, remolque, acoplado, barredora): se crean con el slug del inventario (medidor `none`; barredora `hour_meter`), sin tocar GRDW-63.
- C6. Marcas: las 37 marcas del dataset que faltan en el catálogo cerrado se crean (con alias CAT→Caterpillar, M BENZ→Mercedes…). La marca de KCB-012 se limpia (el comentario «¿De Baja?» pasa a observación).
- C7. RT: se cargan solo fechas ISO; `homologada`/`no_existe` no se cargan. Anexo D: SOAP y permiso de circulación de los 13 carros; póliza solo si el número viene completo.
  Propietario: «Chome» solo donde está vacío. `responsable` no se carga (no existe campo y no son usuarios).
- C8. La marca «ubicación por confirmar» se limpia en los equipos a los que el dataset da destino; se pone (junto con la faena técnica) en los 24 `sin_ubicacion`.
- C9. Equipos activos en faenas inactivas (Servimar, Cabrero, Ecoservitran, Panguipulli: 8) quedan donde están; si tienen pauta con frecuencia y lectura, generan alertas. Pendiente de Alexis.

## 6. Enfoques considerados

**Ubicación física.** (A) Referencia opcional del equipo a un taller + «sin ubicación» como faena técnica oculta y estado visible; los talleres viven en `mant_workshops`.
(B) Taller como faena de tipo «taller»: reusa traslados, pero es una faena nueva y contradice D2. (C) Derivarlo de la OT abierta: no representa los 13 equipos en taller sin OT.
**Elegido: A.**

**Sin ubicación.** (1) Faena técnica oculta (la «Sin ubicación» inactiva que ya existe) + estado visible; (2) hacer `worksite_id` nulo: toca ~234 consultas que leen faenas.
**Elegido: 1.**

**Sin medidor.** (A) Mantención acepta equipos sin medidor para correctivas y OT; (B) cargarlos solo al maestro. **Elegido: A.**

## 7. Diseño

### 7.1 Ubicación física: taller y sin ubicación

- `mant_workshops` gana `kind` (`interno`/`externo`, por defecto `externo`) y `worksite_id` opcional (obligatorio para `interno`: el taller pertenece a una faena).
  Se crean «Taller Cholguán» (→ Cholguan - Arauco) y «Taller Biodiversa» (→ Biodiversa). No se toca `worksites`.
- `fuel_vehicles` gana `physical_workshop_id` (FK `mant_workshops`, nulo = en su faena). La faena **no cambia** por estar en taller.
  La ubicación del equipo se muestra como «En Taller X» en Flota y Mantención; el historial queda en `mant_equipment_history` (acción nueva `location_change`).
- Equipos en taller en la carga: Cholguán (CR-25, CR-30, CR-41, CR-45, CR-49, EO-07, EO-08), Biodiversa (GRDW-63, KA-145, KCB-001, KCB-002, KCB-003, KCB-010), CA-61 → Taller Eduardo Silva.
- **Sin ubicación:** `worksites.kind` admite `sistema`. La faena «Sin ubicación» (MANT-SUB) pasa a `sistema` y sigue **inactiva**.
  `transferVehiclesTx` acepta como destino una faena `sistema` aunque esté inactiva; ninguna otra inactiva. Estar en MANT-SUB = «sin ubicación» (estado visible en Flota, Mantención y el Excel de Flota).
  Hay que **auditar** toda agregación que una `fuel_vehicles` con `worksites` y agrupe por faena sin filtrar `is_active` (indicadores de flota, combustibles, GPS) y excluir `sistema` o rotularla «Sin ubicación».
  Los selectores de Prevención que revisé filtran faenas activas (108 de las 234 consultas que leen faenas filtran `is_active`); el resto hay que auditarlo. Una prueba recorre las pantallas con equipos en MANT-SUB y verifica que la faena no aparezca.
- El traslado desde la UI no cambia: la marca manual «ubicación por confirmar» sigue existiendo para equipos con faena conocida y ubicación dudosa.

### 7.2 Equipos sin medidor en Mantención

Hoy `unitFromMeter` devuelve `null` para `none` y `fleet.ts`, `records-create-context.ts` y las OT descartan esos equipos; `mant_records.reading` es NOT NULL y el contrato offline exige `reading`.

- `MantUnit` pasa a `km | h | null` en el perfil del equipo. Un equipo sin medidor tiene perfil, pauta (`CARROS-PEND`) y registros **sin lectura**.
- `mant_records.reading` → nulo; el servidor exige `reading` si el equipo tiene unidad y la rechaza si no la tiene. El contrato Zod del sync y la app (`step-lectura.tsx`) saltan el paso de lectura.
- Un equipo sin medidor solo registra **correctivas y OT**; una preventiva exige pauta con intervalos y lectura (la pauta pendiente no tiene).
- `mant_schedules.unit` solo admite `km`/`h`: `CARROS-PEND` se crea con `km` como valor técnico sin intervalos (no se usa). Cuando Alexis defina la pauta de carros (¿por tiempo?, ¿km del tracto?) se decide su unidad con su propia migración.
- Estado en lista/Panel: `sin_pauta` con etiqueta «Pauta por definir» si la pauta es `*-PEND`; no entra al denominador de cobertura.

### 7.3 Unidad por equipo (KPL-133/134)

`mant_equipment_profiles.unit_override` (`km`/`h`, nulo = la del tipo). `unitFromMeter` se resuelve con el override primero. Combustibles, tipos y rendimiento no cambian.
KPL-133/134 reciben `h` y pasan de «Camiones y tractos» a `P300-LIVIANA` (0 registros, sin riesgo de historial).

### 7.4 Regla 2.5 de alertas (en el servidor)

`equipmentStatus` (`lib/mantencion/status.ts`) recibe `alertable` y un `reason`. Un equipo genera alertas preventivas solo si: activo (no baja), no `fuera_servicio`, faena real (no `sistema`),
pauta con frecuencia y lectura de partida. Si no: nunca `vencida`/`proxima`; estado informativo con la razón («Sin ubicación», «Fuera de servicio», «Pauta por definir», «Sin lectura de partida»).
`MantEquipmentState` gana `fuera_servicio` y `sin_ubicacion`; hay que actualizar todo `Record<MantEquipmentState, …>` (Panel, cobertura, indicadores, Excel, cliente). «Sin lecturas» se renombra **«Sin lectura de partida»**.
Los tres cálculos (`fleet.ts` ×2 y `client/fleet-view.ts`) usan la misma función de elegibilidad.

### 7.5 Pautas

- **Maquinaria pesada** (editor existente → versión 2, resumen «Carga 2026-11-24»): `h15`, `h19`, `h34` quedan **inactivos** (no se borran); `h25` «Medición desgaste de cadenas» aplica solo en 900 y 1.200 h.
- **`P300-LIVIANA`** («Pauta 300 h: grúas horquilla y equipos por horas»): unidad `h`, intervalo único 300, 27 ítems = maquinaria depurada sin «Tren de rodado y herramienta». **Contenido provisional**: Alexis debe validarlo.
  Se asigna a las grúas horquilla, KPL-133, KPL-134 y BA-02 (17 equipos).
- **`CAMIONETAS-PEND`** («Pauta camionetas (por definir)») y **`CARROS-PEND`** («Pauta bateas y carros (por definir)»): sin ítems ni frecuencia. No generan alertas; sus equipos admiten correctivas y OT.
- La pauta «Camion» sobrante no se toca. `MANTENER`: conserva la pauta; las altas con `MANTENER` (YX-2749, KV-2296) quedan sin pauta y se listan.

### 7.6 Lectura de partida en la primera visita

La app, si el equipo no tiene lectura inicial ni registros, pide la lectura actual (ya obligatoria) y opcionalmente **fecha, lectura y servicio de la última preventiva**. Esa preventiva se guarda en `prior_preventive_*` con
`source = "app: declarada por el mecánico"` y `evidence = "Declarada por el mecánico, sin respaldo"`, y cuenta en `equipmentStatus` marcada como «declarada, sin respaldo». Jefatura la reemplaza con respaldo en «Editar mantención».
Si el mecánico no la conoce, el equipo queda «Sin preventiva» (regla Trinorma intacta). La lectura de equipos de la columna `unidad = sin_medidor` no se pide.

### 7.7 Cargador

`scripts/apply-mantencion-carga-2026-11-24.ts` + `db/seed/mantencion-carga-2026-11-24.csv` (el dataset, 220 filas). Mismo patrón de `apply-trinorma-*`: una transacción, advisory lock, simulación por defecto (`--apply` escribe), informe Markdown, bitácora con actor «sistema: carga mantención 2026-11-24» y la fuente. Idempotente: la segunda corrida da 0 cambios.

Pasos, en este orden: (1) catálogos (talleres, marcas, tipos); (2) pautas (editar maquinaria, crear las 3 nuevas); (3) altas de los 36 equipos con perfil y pauta (reusa `apply-trinorma-equipos-faltantes` y `fleet-incorporation`);
(4) actualizaciones de los 176 existentes (patente, año, modelo/marca, tipo solo si coincide con un slug, códigos, pauta, unidad, documentos, propietario, estado `fuera_servicio` de KRR-008);
(5) ubicación (taller o sin ubicación); (6) **traslados** agrupados por (origen → destino, fecha) con motivo «Carga de mantención 2026-11-24 (inventario 17-11-26)» y quien autoriza por parámetro (`--autorizado-por`, lo indica el usuario al correrlo); no más de 100 por traslado (`MAX_VEHICLES_PER_TRANSFER`).
Identidad: `matchVehicle` (código y patente). Un equipo que no coincide con nada se crea; uno con conflicto aborta la carga. `*` en `cambio_desde` = fecha estimada: se usa 2026-11-24 y el motivo lo dice.
Los 8 `baja` no existen: no se crean ni se marcan; el informe lo dice.

**Ampliar la ventana (D7):** `transferVehiclesTx` recibe un parámetro explícito `dateWindow: { min }` solo desde el cargador. La UI conserva la ventana. El trigger `FLEET_STAY_INVARIANT` y todo lo demás siguen igual. Los traslados reestampan combustible, GPS y anomalías desde la fecha, de ahí la importancia de la fecha real.

## 8. Pruebas

Flujos E2E secuenciales con estado (`e2e/mantencion-6-carga.spec.ts`, fixture sembrado desde el CSV con un subconjunto representativo):

1. Simulación → `--apply` → `--apply` otra vez: la segunda produce 0 cambios.
2. Mecánico de Cholguán ve solo equipos de Cholguán. En un equipo sin lectura de partida registra lectura y última preventiva; la plataforma calcula la próxima (última + 300) marcada «declarada, sin respaldo».
3. Maquinaria pesada: «Medición desgaste de cadenas» aparece en 900 y 1.200 h y no en 300 ni 600; los tres ítems eliminados no aparecen.
4. Un `sin_ubicacion`, un `fuera_servicio`, un `CAMIONETAS-PEND` y uno sin lectura de partida no generan alertas; un carro (sin medidor) acepta una correctiva.
5. Los de Santa Fe y Pacífico aparecen en su nueva faena con historial y fecha; los de Pacífico sin destino van a Flor del Laja.
6. Horcones aparece como Arauco y conserva sus registros.
7. «Sin ubicación» no aparece como faena en Prevención ni en indicadores; los equipos sí muestran «Sin ubicación». Taller Cholguán/Biodiversa no aparecen en selectores de faena.

Unitarias y PGlite: `equipmentStatus` (elegibilidad y razones), unidad por equipo, registro sin lectura, transferencia con ventana ampliada y destino `sistema`, idempotencia del cargador.
Puertas: `typecheck`, `lint`, `test:fast`, `test:pglite`, `db:verify-migrations`; suite completa al final, sin filtrar por nombre.

## 9. Riesgos

- **Agregaciones por faena** que muestren «Sin ubicación»: es la parte más amplia; se cubre con auditoría y la prueba 7.
- **App offline:** cambiar el contrato de `reading` obliga a versionar el catálogo de sync (`sync-catalog-version`) y probar un cliente con cola vieja.
- **Traslados masivos** nunca ejercidos en prod: ventana ampliada, reestampado de GPS/combustible/anomalías y asignaciones de proveedor; simulación con informe y respaldo antes de `--apply`.
- **Estados nuevos** rompen todo `Record<MantEquipmentState, …>`; el compilador los encuentra.
- **Pauta de carros** sin unidad real: valor técnico `km` hasta que Alexis defina.

## 10. Pendientes de negocio (Alexis)

Mecánicos de las faenas sin mecánico; contenido de `CAMIONETAS-PEND` y `CARROS-PEND`; validar `P300-LIVIANA`; confirmar «cadenas en 900 y 1.200 h» (hoy a 2.100 h sugiere 300); ubicación de los `sin_ubicacion`
(TO-23, GR-08, TO-34 perdidos; TO-27 en «una faena» sin nombre); número de serie de TO-27; 6 registros del inventario sin código ni patente; EO-05 («¿de baja?»); si Servimar, Cabrero, Ecoservitran y Panguipulli (8 equipos) siguen operando;
cuándo desactivar Pacífico (queda con 0 equipos tras la carga); 2 equipos sin pauta (YX-2749, KV-2296); patente de TO-37 y de los equipos sin patente.

## 11. Lo que queda al constructor

Nombres de columnas y migraciones (una sola, aditiva: `mant_workshops.kind/worksite_id`, `fuel_vehicles.physical_workshop_id`, `mant_equipment_profiles.unit_override`, `mant_records.reading` nulo, `worksites.kind` con `sistema`, acción de historial `location_change`);
textos de UI; el mapeo exacto de marcas y alias; el orden fino de los pasos del cargador; el informe `MANTENCION_CARGA_2026-11-24.md` en la raíz con archivos y líneas, diff por entidad, equipos de prod fuera del dataset (hoy 0), decisiones, pendientes y resultado de la suite.
