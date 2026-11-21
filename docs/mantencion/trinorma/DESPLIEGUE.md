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

**Migraciones.** Producción está en la 0396. Este deploy aplica la **0397** (uso personal) y la **0398**. La 0398 es aditiva:

- tablas nuevas;
- columnas nulas o con valor por defecto;
- índices y CHECK;
- sin DROP.

Se aplicó sin errores sobre un clon de producción del 21-11. Eso incluye el índice único de código de equipo: producción no tiene códigos duplicados.

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

Lo corre el usuario con `scripts/deploy-prod.sh`. El servicio `migrate` aplica la 0397 y la 0398.

Verificación de solo lectura:

```sql
BEGIN READ ONLY;
SELECT count(*) FROM drizzle.__drizzle_migrations;                       -- 399
SELECT indexname FROM pg_indexes WHERE indexname = 'fuel_vehicles_code_key_unique';
SELECT count(*) FROM worksites WHERE kind = 'operacion';                 -- todas, hasta correr los maestros
SELECT to_regclass('mant_historical_inspections');
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
   - no mueve ningún equipo de faena.

   En el clon del 21-11, la segunda corrida no hizo nada.
2. **Maestros, `--apply`,** con las mismas opciones, después de revisar la simulación.
3. **Equipos que faltaban en la flota, simulación y luego `--apply`:**

   ```
   apply-trinorma-equipos-faltantes.ts --actor-email <correo> --inventario <INVENTARIO….xlsx>
   ```

   Da de alta 10 equipos que el consolidado trae y la flota no:
   - CA-85, H-1, H-2, H-13;
   - KCB-001, KCB-002, KCB-003, KCB-010;
   - KRR-002 y SXCV-49.

   La faena sale de la base de noviembre del Jefe de Mantención, o del inventario de octubre. Los de Pacífico y KCB-003 van con «ubicación por confirmar». No crea:
   - CA-47, CA-81 y CA-82, que están dados de baja;
   - la estructura de limpieza y la hidrolavadora, que no tienen código ni patente;
   - LCTC-21, que es CR-50.

   En el clon: 10 altas, y la segunda corrida no hizo nada.

   Corriendo después el importador, se ligan 100 trabajos más: los sin equipo bajan de 112 a 12.
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

   Todas las filas resuelven su faena. Con los equipos faltantes ya dados de alta, 12 mantenciones quedan sin equipo: patentes que no están en ninguna planilla (WX-6495, GRDW-63, ZV-6852) y la estructura de limpieza.

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
   SELECT w.code, w.name, s.folio_code FROM worksites w LEFT JOIN mant_worksite_settings s ON s.worksite_id = w.id
    WHERE w.code IN ('HORCONES', 'MANT-ARA');  -- HORCONES «Arauco» ARA; MANT-ARA «Arauco (anterior)» sin folio
   ROLLBACK;
   ```

   Después, abrir `/mantencion/panel` con la faena Biodiversa y el período de junio de 2025 a noviembre de 2026. En el clon dio: 485 trabajos, 52 % de correctivas (189 de 366 clasificados), 121 días en taller y 1.670,5 horas hombre.

## 5. Reversión

- **Código.** Volver a desplegar el commit anterior. La 0398 es aditiva: el código anterior la ignora. Si de verdad hubiera que deshacer el esquema, `docs/mantencion/trinorma/0398-reversion.sql` va a una migración **nueva**. Nunca se toca el journal.
- **Datos.** La vuelta atrás segura es el respaldo del paso 2.3. Para deshacer sólo la importación, tomar la hora del registro `mant_historical_import` en `audit_log`, en una transacción y con respaldo:
  - borrar las filas de `mant_historical_findings`, `mant_historical_inspections` y `mant_historical_schedule_checks` importadas desde esa hora;
  - borrar las de `mant_historical_records` con `source_file` del consolidado;
  - en las 142 del 18-11, volver a null las columnas nuevas.

  Los maestros dejan un registro de auditoría por cambio. Eso incluye los códigos de los tractos (motivo «vuelve el código anterior a la carga de vencimientos del 13-11») y el traspaso del folio.

## 6. Después

- Encender «Exigir el tipo de acción» cuando el Jefe de Mantención lo pida.
- **No volver a correr `scripts/apply-vencimientos-planilla-2026-11.ts`** con la planilla de noviembre: volvería a rotar los códigos de los tres tractos.
- Crear el contrato «Horcones» de la faena Arauco cuando se carguen los contratos. Antes hay que confirmar el mandante con Finanzas:
  - las HES son de Celulosa Arauco y Constitución S.A.;
  - pero una factura de diciembre de 2025 se emitió a Maderas Arauco S.A.
- **Faenas de KCH-129 y KCH-130, probablemente cruzadas.** La carga del 13-11 dejó KCH-129 (KXZD-19) en Horcones, ahora Arauco. El inventario de octubre lo pone en Cabrero, y pone KCH-130 (KXZD-20) en Horcones. Se corrige con «Trasladar equipos» cuando se encienda (C4).
- Decisión pendiente del usuario: el traslado (C4).
