# Despliegue de la Fase 1 Trinorma

Para quien despliega y carga los datos en producción. El deploy lo corre el usuario. Cada carga de datos en producción necesita su autorización explícita y un respaldo previo.

## 1. Qué trae

Rama `feat/mantencion-trinorma`, sobre `main` a47271fd3, que ya incluye la 0397 de uso personal.

| Commit | Paquete |
|---|---|
| WP0 | Migración `0398_furry_luckman` y código compartido (identidad de equipo, faena por nombre o alias, tipo de acción); parámetros de Mantención |
| WP3 | OT: tipo de acción, especialidades, faena de ejecución, trabajo realizado y horas hombre; la OT desde un hallazgo nace correctiva |
| WP1 | Tipo y alias de faena, empresa propietaria y «ubicación por confirmar»; `scripts/apply-trinorma-maestros.ts` |
| WP4 | Panel de mantención con el historial: trabajos por tipo, días en taller, horas hombre, pautas, hallazgos, filtro por equipo, Excel y PDF por faena |
| WP2 | Importador del consolidado: `scripts/import-consolidado-mantencion.ts` |
| 0399 | Preventiva declarada anterior a la plataforma (opción A del usuario, 21-11): migración `0399_fixed_dreadnoughts`, estado «sin información de preventiva», validaciones del servidor, ficha, formulario, exportaciones y `scripts/apply-trinorma-lecturas-preventivas.ts` |

**Migraciones.** Producción está en la 0396 (397 migraciones, verificado el 21-11). Este deploy aplica la **0397** (uso personal), la **0398** y la **0399**, en el mismo deploy. Las dos últimas son aditivas:

- tablas nuevas;
- columnas nulas o con valor por defecto;
- índices y CHECK;
- sin DROP.

Probadas el 21-11 sobre una copia limpia de producción (el respaldo de ese día, restaurado en `bodega_prodtest_0399`): las tres entraron sin errores (397 → 400) con el camino completo de `npm run db:migrate`, y el índice único de código se creó porque no hay duplicados. La consulta de duplicados en producción, en solo lectura, dio 0 filas el mismo 21-11.

**Cambio visible del estado de las pautas.** Un equipo con pauta y lectura que no tiene ninguna preventiva (firmada ni declarada) y ya pasó el primer servicio queda «Sin información de preventiva», ya no «al día» por convención. Un equipo nuevo que todavía no llega al primer servicio sigue calculando la próxima en la base. Hoy no cambia nada a la vista en producción: los únicos equipos con lectura (H-4, H-12, H-14, H-15 y H-17) no tienen pauta, así que siguen «Sin pauta» (comprobado en la copia del 21-11).

**Permisos.** No hay permisos nuevos. Sí hay una concesión nueva, decidida por el usuario el 2026-11-21: el administrador de contrato recibe `mant:records:view_worksite` y `mant:export`, es decir, ve y exporta el Panel, los registros, el historial y los equipos de **sus** faenas. Va en `GRANT_ADDITIONS` y la aplica una sola vez el paso `sync-rbac` que `deploy-prod.sh` ya corre.

**Privacidad (decisión del usuario, 2026-11-21, opción B).** El detalle de un trabajo del historial ya no muestra la cuenta de correo con que se envió el formulario. El dato sigue guardado, porque la identidad de cada formulario se calcula con él; el responsable y el conductor se siguen viendo.

**Parámetros.** En Parámetros operativos → Mantención:

- «Exigir el tipo de acción» parte **apagado**;
- las filas de prueba se importan marcadas;
- el plazo de hallazgos es de 7 días.

## 2. Antes del deploy

1. La rama pasó las puertas:
   - typecheck;
   - lint;
   - test:fast;
   - test:pglite;
   - db:verify-migrations;
   - E2E de las áreas tocadas.

   El resultado está en el informe de QA, en `qa/reports/`.
2. Fusionar a `main` coordinando con las otras sesiones (turno de merge).
3. **Control del índice único**, de solo lectura y el mismo día del deploy. Debe devolver **0 filas**: si alguien cargó un código repetido después del clon del 21-11, la 0398 no se aplicaría. El índice cubre también los equipos dados de baja, y una vez creado, el código de un equipo dado de baja no se puede reutilizar.

   ```sql
   BEGIN READ ONLY;
   SELECT regexp_replace(upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g')), '^([A-Z]+)0+([0-9])', '\1\2') AS clave,
          count(*), array_agg(code), array_agg(is_active)
   FROM fuel_vehicles WHERE code IS NOT NULL AND btrim(code) <> ''
   GROUP BY 1 HAVING count(*) > 1;
   ROLLBACK;
   ```
4. Respaldo de producción con `pg_dump`, en una sesión SSH aparte con `< /dev/null`, y anotar la ruta.

## 3. Deploy

Lo corre el usuario con `scripts/deploy-prod.sh`. El servicio `migrate` aplica la 0397, la 0398 y la 0399.

Verificación de solo lectura:

```sql
BEGIN READ ONLY;
SELECT count(*) FROM drizzle.__drizzle_migrations;                       -- 400
SELECT indexname FROM pg_indexes WHERE indexname = 'fuel_vehicles_code_key_unique';
SELECT count(*) FROM worksites WHERE kind = 'operacion';                 -- todas, hasta correr los maestros
SELECT to_regclass('mant_historical_inspections');
SELECT count(*) FROM information_schema.columns
 WHERE table_name = 'mant_equipment_profiles' AND column_name LIKE 'prior_preventive%';  -- 6
ROLLBACK;
```

## 4. Carga de datos, en este orden

Cada paso parte en **simulación**. Se lee el informe, y `--apply` sólo corre con la autorización del usuario.

**Cómo se corren en producción.** La imagen no trae los `.xlsx`, y `/app/scripts` no es escribible. Se usa el patrón de siempre:

- bundle con esbuild del script, más un envoltorio que escribe el `.xlsx` embebido en base64 en `/tmp` y llama al `main` con los argumentos;
- se manda por stdin a `docker compose run --rm -T <servicio de un solo uso> sh -c "cd /app && node --input-type=module -"`;
- en una sesión SSH en la que ese sea el **único** lector del stdin.

El correo del actor es el de la cuenta de quien carga. Debe estar activa.

1. **Maestros, simulación:**

   ```
   apply-trinorma-maestros.ts --actor-email <correo> --inventario <INVENTARIO_EQUIPOS_ACTUALIZADO_FAENAS_10-2026.xlsx> --unir-arauco
   ```

   Lo que hace:
   - pasa Flor del Laja a depósito y Oficina Central a administración;
   - **une las dos Arauco.** El usuario eligió el 21-11 unirlas con el nombre «Arauco» y el contrato «Horcones»:
     - «Horcones» (HORCONES) pasa a llamarse «Arauco», sin mover sus equipos;
     - la «Arauco» del seed (MANT-ARA) pasa a «Arauco (anterior)» y sigue inactiva;
     - las 18 filas del historial que apuntan a MANT-ARA pasan a HORCONES;
     - el folio ARA de Mantención pasa a HORCONES. Sin él, la faena no aparece en el Panel.

     La unión se omite sola si MANT-ARA tiene equipos o contratos, y el folio no se traspasa si MANT-ARA ya emitió folios. El contrato «Horcones» no lo crea este script: se crea con los contratos;
   - crea 9 alias, entre ellos «Horcones», para que las planillas que todavía dicen Horcones la reconozcan;
   - **devuelve a los tres tractos de Biodiversa su código** (decisión del usuario, 21-11):
     - SRCJ-47 vuelve a ser KCH-133;
     - SRCJ-42 vuelve a ser KCH-135;
     - SRCJ-39 vuelve a ser KCH-136.

     La carga de vencimientos del 13-11 los había rotado, porque la planilla de la faena los traía cruzados. Manda el inventario de octubre. Se corrigen los tres juntos o ninguno: si alguno tiene otro código, el paso se omite y lo informa. Las patentes y los vencimientos no cambian;
   - asigna propietarios a unos 160 equipos (162 en el clon, con los tres tractos). Los terceros salen sólo por cantidad;
   - pone la marca «ubicación por confirmar» a 32 equipos (Pacífico y faenas cerradas);
   - **crea el contrato «Horcones» de la faena Arauco** y su mandante, Celulosa Arauco y Constitución S.A. (93.458.000-1), con inicio el 01-08-2025. Decisión del usuario, 21-11:
     - un solo contrato, con las Líneas 2 y 3 descritas en las notas (la plataforma no tiene líneas dentro de un contrato);
     - el cobro (plazo de 30 días, ciclo del 21 al 20, cobro por viaje) lo carga Facturación: el servicio operacional no escribe esos campos;
     - **sin equipos asignados**. KA-137 queda fuera, porque atiende el contrato de Asir (decisión del usuario, 21-11, C16). Falta KRR-005 y trasladar KCH-130;
   - no mueve ningún equipo de faena.

   En el clon del 21-11, la segunda corrida no hizo nada.
2. **Maestros, `--apply`,** con las mismas opciones, después de revisar la simulación.
3. **Equipos que faltaban en la flota, simulación y luego `--apply`:**

   ```
   apply-trinorma-equipos-faltantes.ts --actor-email <correo> --inventario <INVENTARIO….xlsx>
   ```

   Da de alta 12 equipos que el consolidado trae y la flota no:
   - CA-85, H-1, H-2, H-13;
   - KCB-001, KCB-002, KCB-003, KCB-010;
   - KRR-002 y SXCV-49;
   - **el remolque batea GRDW-63, sin código y con tipo «Batea»** (decisión del usuario, 22-11: la planilla de disposición de equipos y el programa de salida lo describen como batea). El inventario lo llama KRR-01, que para el índice único es el mismo código que KRR-001 (otro carro, JC-6212), y la base del Jefe de Mantención lo llama H-4, que es una grúa horquilla Hyster. Va a Arauco con «ubicación por confirmar». El código se le pregunta al Jefe en su planilla;
   - **CA-35 (ZV-6852),** camioneta de Asir en Flor del Laja.

   La faena sale de la base de noviembre del Jefe de Mantención, o del inventario de octubre. Los de Pacífico, KCB-003 y GRDW-63 van con «ubicación por confirmar». No crea:
   - CA-47, CA-81 y CA-82, que están dados de baja;
   - la estructura de limpieza y la hidrolavadora, que no tienen código ni patente;
   - LCTC-21, que es CR-50;
   - WX-6495, una grúa de Asir sin código, cuyo texto el taller usa como comodín para otros trabajos;
   - JN-1255, que no es un equipo nuevo: probablemente es JG-1255 (KCB-001). Ese trabajo se liga a mano.

   En el clon: 12 altas, y la segunda corrida no hizo nada.

   Corriendo después el importador, se ligan 106 trabajos más.
4. **Importador, simulación:**

   ```
   import-consolidado-mantencion.ts --file <CONSOLIDADO….xlsx> --actor-email <correo> --report <informe.md>
   ```

   En el clon, que es la referencia (`qa/reports/2026-11-21-importador-consolidado-simulacion.md`):

   | Hoja | Resultado |
   |---|---|
   | Mantenciones | 2.202 nuevas y 142 completadas (las del 18-11, reconocidas sin duplicar) |
   | Inspecciones | 1.333 |
   | Hallazgos | 1.132 |
   | Pautas | 6 (2 de prueba) |
   | Rechazos | 0 |

   Todas las filas resuelven su faena. Con los equipos faltantes ya dados de alta, quedan 6 mantenciones sin equipo, todas para ligar a mano o dejar así:
   - las 4 de «WX6495 (FLOR DEL LAJA)»;
   - JN-1255;
   - la estructura de limpieza.

   Con los códigos de los tractos corregidos en el paso 1, las 64 mantenciones y 270 inspecciones de KCH-133, KCH-135 y KCH-136 se ligan solas: en el clon, 18, 24 y 22 trabajos, y 101, 92 y 77 inspecciones. Quedan 2 mantenciones en conflicto, «KCH-126 / KXZD-19» del 08-08-2025, para ligar a mano.

   Si el alias «Cholguan» todavía no existe, el importador igual resuelve CHOLGUAN, gracias al respaldo que ya tenía.
5. **Importador, `--apply`.** La segunda corrida debe dar todo «sin cambios».
6. **Verificación de solo lectura:**

   ```sql
   BEGIN READ ONLY;
   SELECT count(*), count(*) FILTER (WHERE action_type IS NOT NULL), count(*) FILTER (WHERE is_test) FROM mant_historical_records;  -- 2344, 2344, 2
   SELECT count(*) FROM mant_historical_inspections;    -- 1333
   SELECT count(*) FROM mant_historical_findings;       -- 1132
   SELECT count(*) FROM mant_historical_schedule_checks; -- 6
   SELECT count(*) FROM mant_historical_records WHERE equipment_match = 'conflict' AND vehicle_id IS NULL;  -- 2
   SELECT code, plate FROM fuel_vehicles WHERE plate IN ('SRCJ-39', 'SRCJ-42', 'SRCJ-47') ORDER BY code;  -- KCH-133 SRCJ-47, KCH-135 SRCJ-42, KCH-136 SRCJ-39
   SELECT c.code, c.name, w.code, cl.rut FROM contracts c JOIN worksites w ON w.id = c.worksite_id JOIN clients cl ON cl.id = c.client_id
    WHERE c.name = 'Horcones';  -- CTR-AAAA-NNNN · Horcones · HORCONES · 93458000-1
   SELECT w.code, w.name, s.folio_code FROM worksites w LEFT JOIN mant_worksite_settings s ON s.worksite_id = w.id
    WHERE w.code IN ('HORCONES', 'MANT-ARA');  -- HORCONES «Arauco» ARA; MANT-ARA «Arauco (anterior)» sin folio
   ROLLBACK;
   ```

   Después, abrir `/mantencion/panel` con la faena Biodiversa y el período de junio de 2025 a noviembre de 2026. En el clon dio: 485 trabajos, 52 % de correctivas (189 de 366 clasificados), 121 días en taller y 1.670,5 horas hombre.

7. **Pauta, lecturas y preventivas declaradas,** cuando vuelva la planilla del Jefe de Mantención (plazo: jueves 26-11):
   1. **La pauta primero** (hoja 1). Si el Jefe la corrige, se cambia en la plataforma (Pautas) antes de cargar nada. El cargador no aplica sin `--pauta-confirmada`.
   2. **Cargador, en simulación el mismo día que vuelva la planilla:**

      ```
      apply-trinorma-lecturas-preventivas.ts --file <planilla devuelta.xlsx> --actor-email <correo de quien carga> --declarada-por <correo del Jefe de Mantención> --pauta-confirmada --report <informe.md>
      ```

      Quien carga y quien declara tienen que tener `mant:equipment:manage` (jefatura de mantención o administración). Por equipo carga la lectura inicial y la preventiva declarada **juntas**. Para cargarla, el Jefe tiene que haber elegido «Confirma» o «Corrige», indicado el servicio de pauta y puesto un respaldo. El respaldo tiene que ser un número de orden de trabajo o de factura: un relleno como «S/R», «N/A» o «-», o un texto sin número, no sirve. Sin respaldo válido, el equipo va al listado de pendientes y no se le carga nada, ni siquiera la lectura. Tampoco se cargan los equipos dados de baja.

      Para Arauco usa la lectura de noviembre de la hoja 3, si viene. La nota de la planilla (KCH-129, detenido) queda en la fuente y en el historial.
   3. **`--apply`** con la autorización del usuario, **a más tardar el 29-11**, para tener dos días de margen. Después, revisar:
      - la ficha de cada equipo cargado y el Excel de Equipos: la preventiva declarada se ve como «Declarada, anterior a la plataforma», con su respaldo, quién la declaró y la fuente;
      - el Panel de Biodiversa y su PDF, que muestran estados y no preventivas por equipo: los equipos sin preventiva figuran como «Sin información de preventiva» y no cuentan como al día.
   4. **Congelar cambios** en Mantención hasta la auditoría del 01-12.

## 5. Reversión

- **Código.** Volver a desplegar el commit anterior. La 0398 es aditiva: el código anterior la ignora. Si de verdad hubiera que deshacer el esquema, `db/repairs/trinorma/0399-reversion.sql` y después `db/repairs/trinorma/0398-reversion.sql` van a migraciones **nuevas**, en ese orden. Ambas están probadas en PGlite. Nunca se toca el journal.
- **Datos.** La vuelta atrás segura es el respaldo del paso 2.3. Para deshacer sólo la importación, tomar la hora del registro `mant_historical_import` en `audit_log`, en una transacción y con respaldo:
  - borrar las filas de `mant_historical_findings`, `mant_historical_inspections` y `mant_historical_schedule_checks` importadas desde esa hora;
  - borrar las de `mant_historical_records` con `source_file` del consolidado;
  - en las 142 del 18-11, volver a null las columnas nuevas.

  Los maestros dejan un registro de auditoría por cambio. Eso incluye los códigos de los tractos (motivo «vuelve el código anterior a la carga de vencimientos del 13-11») y el traspaso del folio.

## 6. Después

- Encender «Exigir el tipo de acción» cuando el Jefe de Mantención lo pida.
- **No volver a correr `scripts/apply-vencimientos-planilla-2026-11.ts`** con la planilla de noviembre: volvería a rotar los códigos de los tres tractos.
- **Pauta, lecturas y última preventiva (lo que falta para el Panel del 01-12), en este orden:**
  1. **La pauta.** La de «Camiones y tractos» parte en 10.000 km, pero en los formularios el aceite de motor se cambia cada 37.000 a 50.000 km en los 9 equipos con historial. Con la pauta actual casi todo saldría vencido aunque las preventivas estén completas. El Jefe de Mantención la confirma o la corrige con el manual del fabricante; es la hoja 1 de su planilla, marcada como la más importante. Si cambia, se corrige en la plataforma antes de cargar nada.
  2. **Las 12 lecturas y las preventivas que él confirme,** juntas y cada una con su respaldo. La nota de KCH-129 dice que no carga combustible desde el 29-07. Si el administrador del contrato Horcones confirma que está detenido, la nota lo dice al cargar.

  La planilla está en `~/backups-dev/trinorma-2026-11/` y vence el jueves 26-11. La **versión 2** (`…_v2.xlsx`, generada con `generar_planilla_v2.py`) agrega lo que se supo el 21-11 por la noche:
  - la marca y el modelo de cada camión;
  - la hoja de consumo de aceite, que confirma 4 preventivas;
  - las preguntas por KCH-129 y KA-135;
  - el código de GRDW-63.

  Las hojas 2 y 3 conservan los encabezados y el orden de filas de la versión 1, y el cargador lee las dos versiones igual, cualquiera que devuelva el Jefe. **Las lecturas no se cargan solas:** sin preventiva registrada, el Panel supone que la última se hizo en el último múltiplo del intervalo base, y ese «al día» no tiene respaldo.
- **Contrato «Horcones»:**
  - Facturación carga el cobro: plazo de 30 días, ciclo del 21 al 20, cobro por viaje;
  - KA-137 no se asigna: atiende el contrato de Asir (C16). Falta decidir KRR-005, y KCH-130 se asigna después de su traslado.
- **Faenas de KCH-129 y KCH-130, cruzadas.** KCH-130 trabaja en Arauco desde mayo de 2026, pero la plataforma lo tiene en Santa Fe. KCH-129 no carga combustible desde el 29-07 (el inventario lo pone detenido en Cabrero), pero la plataforma lo tiene en Arauco. Para corregirlo:
  - un traslado por pantalla o con `transferVehiclesTx` admite fechas solo desde el día 1 del mes anterior (hoy, el 01-10-2026);
  - una fecha anterior es trabajo de la reconstrucción del recorrido (`scripts/reconstruct-worksite-stays.ts`), que salta los equipos que ya tienen un traslado.

  **Decisión del usuario, 21-11: opción B.** No se registra un traslado con fecha 01-10: no se podría deshacer, y la reconstrucción ya no podría corregir julio a septiembre. KCH-130 entra en la reconstrucción de toda la flota.
  - El 01-07 sale de las cargas de combustible, y por la regla del 18-11 (solo evidencia física, nunca Copec ni GPS) no sirve.
  - **Decisión del usuario, 21-11 por la noche (C16 y C17):** KCH-130 se traslada a Arauco con fecha **07-05-2026**, con respaldo en la OT 33866 (ingreso al taller ese día, faena Arauco, 687.185 km). Sus OT son de Santa Fe sin interrupción hasta el 23-04-2026 y de Arauco desde el 07-05. Si la acreditación de Planta Arauco, que se le pregunta al administrador del contrato Horcones, muestra otra fecha, manda la acreditación.
  - El 08-05, que citaban versiones anteriores de este documento, es el día en que se registró la OT 33866 en el formulario, no el de su ingreso al taller.
  - Que siguiera cargando combustible con la tarjeta de Calymag hasta el 29-05 no cambia la fecha: el combustible no prueba faena.
  - **KCH-129 no se mueve** hasta que el administrador del contrato Horcones diga cuál de los dos camiones tiene: su planilla de vencimientos del 05-11 pone a KCH-129 en Horcones (y no a KCH-130), y el 11-11 se despachó «equipo KCH129». Es la hoja 3 de la versión 2 de la planilla.
  - **Fecha propuesta para la reconstrucción en producción:** jueves 03-12-2026, después de la auditoría. Antes, una corrida en seco en el clon. La fecha la confirma el usuario.
- **Choques de código por ceros a la izquierda.** Se revisó todo el inventario de octubre (Base de Datos, Dados de baja y Equipos móviles) contra la regla del índice único. El único choque es KRR-01 (GRDW-63) con KRR-001 (JC-6212), y ningún código del inventario choca con otro equipo de la flota.
