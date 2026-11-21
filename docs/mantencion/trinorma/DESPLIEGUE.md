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

**Permisos.** No hay permisos nuevos, así que no hace falta `db:sync-rbac` por esta rama.

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
   apply-trinorma-maestros.ts --actor-email <correo> --inventario <INVENTARIO_EQUIPOS_ACTUALIZADO_FAENAS_10-2026.xlsx>
   ```

   Lo que hace:
   - pasa Flor del Laja a depósito y Oficina Central a administración;
   - crea 8 alias;
   - asigna propietarios a 159 equipos (los terceros salen sólo por cantidad);
   - pone la marca «ubicación por confirmar» a 32 equipos (Pacífico y faenas cerradas);
   - no mueve ningún equipo de faena.

   En el clon del 21-11: 26 cambios. La segunda corrida no hizo nada.
2. **Maestros, `--apply`.** La **unión de las dos Arauco** (HORCONES pasa a llamarse «Arauco»; las 18 filas del historial de MANT-ARA pasan a HORCONES; MANT-ARA pasa a «Arauco (anterior)») sólo corre con `--unir-arauco`. Tiene autorización aparte. Si MANT-ARA tuviera equipos o contratos, se omite sola.
3. **Importador, simulación:**

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

   Todas las filas resuelven su faena. 112 no tienen equipo: 16 equipos que no están en la flota. Hay 66 mantenciones y 270 inspecciones en conflicto por las patentes cruzadas de KCH-133, KCH-135 y KCH-136.

   Si el alias «Cholguan» todavía no existe, el importador igual resuelve CHOLGUAN, gracias al respaldo que ya tenía.
4. **Importador, `--apply`.** La segunda corrida debe dar todo «sin cambios».
5. **Verificación de solo lectura:**

   ```sql
   BEGIN READ ONLY;
   SELECT count(*), count(*) FILTER (WHERE action_type IS NOT NULL), count(*) FILTER (WHERE is_test) FROM mant_historical_records;  -- 2344, 2344, 2
   SELECT count(*) FROM mant_historical_inspections;    -- 1333
   SELECT count(*) FROM mant_historical_findings;       -- 1132
   SELECT count(*) FROM mant_historical_schedule_checks; -- 6
   ROLLBACK;
   ```

   Después, abrir `/mantencion/panel` con la faena Biodiversa y el período de junio de 2025 a noviembre de 2026. En el clon dio: 485 trabajos, 52 % de correctivas (189 de 366 clasificados), 121 días en taller y 1.670,5 horas hombre.

## 5. Reversión

- **Código.** Volver a desplegar el commit anterior. La 0398 es aditiva: el código anterior la ignora. Si de verdad hubiera que deshacer el esquema, `docs/mantencion/trinorma/0398-reversion.sql` va a una migración **nueva**. Nunca se toca el journal.
- **Datos.** La vuelta atrás segura es el respaldo del paso 2.3. Para deshacer sólo la importación, tomar la hora del registro `mant_historical_import` en `audit_log`, en una transacción y con respaldo:
  - borrar las filas de `mant_historical_findings`, `mant_historical_inspections` y `mant_historical_schedule_checks` importadas desde esa hora;
  - borrar las de `mant_historical_records` con `source_file` del consolidado;
  - en las 142 del 18-11, volver a null las columnas nuevas.

  Los maestros dejan un registro de auditoría por cambio.

## 6. Después

- Encender «Exigir el tipo de acción» cuando el Jefe de Mantención lo pida.
- Decisiones pendientes del usuario:
  - patentes de KCH-133, KCH-135 y KCH-136;
  - los 16 equipos del consolidado que no están en la flota;
  - si los administradores de contrato ven el Panel y exportan el PDF;
  - la unión de Arauco;
  - el traslado (C4).
