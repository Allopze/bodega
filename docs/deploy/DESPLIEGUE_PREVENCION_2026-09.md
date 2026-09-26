# Despliegue de las correcciones de Prevención (2026-09)

Procedimiento para llevar a producción la rama `prevencion/fixes-production-readiness`.

Qué trae la rama:
- La migración **0329**: columna `pdtp_activities.manual_evidence_policy` y el índice único "un programa activo por año".
- Los cambios de comportamiento B01–B03 y C01 (detalle en `qa/reports/2026-09-26-prevencion-fixes.md`).
- Los 9 crons de Prevención en el contenedor `cron`.

El despliegue en sí es el de siempre (`npm run deploy:prod`). Este documento cubre lo que hay que hacer **antes**, las contingencias y la verificación **después**.

## 1. Antes: consultas de solo lectura sobre producción

Correrlas contra la base de producción con un usuario de solo lectura. Ninguna escribe.

**Q1. Años con dos programas activos.** Si devuelve filas, la migración se bloquea: `scripts/migration-preflight.mjs` corre dentro de `migrate.mjs` y aborta con `PDTP años con programas activos duplicados`. Prevención decide cuál queda activo y pasa la otra versión a `closed` antes de desplegar.

```sql
select year, array_agg(id order by version) as programas
from pdtp_programs where status = 'active'
group by year having count(*) > 1;
```

**Q2. Envíos pendientes que dejarán de poder aprobarse.** Después del despliegue, aprobar exige un archivo real salvo en las 19 actividades con excepción, y una fila migrada con su texto automático no se aprueba (PREV-B02, PREV-M03). La consulta replica esa regla. Como 0329 todavía no existe al correrla, la excepción se expresa con la lista de números de la migración. Las filas que devuelve habrá que rechazarlas con un motivo para que se reenvíen con evidencia.

```sql
with pendientes as (
  select e.id, a.n, e.worksite_id, e.month, e.week, e.origin, e.evidence_status,
         e.evidence_url, e.evidence_photos, e.evidence_text,
         (p.year = 2026 and a.n in (11, 15, 16, 18, 52, 57, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78)) as excepcion
  from pdtp_executions e
  join pdtp_activities a on a.id = e.activity_id
  join pdtp_programs p on p.id = a.program_id and p.status = 'active'
  where e.status = 'submitted' and e.origin <> 'integration' and e.executed_quantity > 0
)
select id, n, worksite_id, month, week, origin, evidence_status
from pendientes
where not (
    -- tiene alguna referencia con el formato que la descarga sabe servir
    coalesce(evidence_url, '') like 'storage/pdtp-evidence/%'
    or exists (select 1 from jsonb_array_elements_text(evidence_photos) f where f like 'storage/pdtp-evidence/%')
  )
  and not (
    -- la excepción deja aprobar una observación propia
    excepcion and coalesce(trim(evidence_text), '') <> '' and evidence_status <> 'migrated_without_attachment'
  )
order by n, month, week;
```

Esta consulta **no** comprueba que los archivos referenciados sigan en disco: una fila con una ruta válida cuyo archivo desapareció tampoco se podrá aprobar. Esa verificación solo se puede hacer en el servidor, cruzando las rutas con `storage/pdtp-evidence/`. Además, las filas de un mes ya cerrado no se pueden rechazar hasta reabrir el mes.

**Q3. Candidatas a excepción.** Actividades activas cuyo respaldo podría vivir fuera de la plataforma. La migración ya marca como `declaration_allowed` las N°11, 15, 16, 18, 52, 57 y 66–78 del programa 2026. Cualquier otra se decide con Prevención **antes** del despliegue. Si se agrega alguna, va en una migración aparte generada con `npm run db:generate -- --custom`; nunca editando 0329.

```sql
select a.n, a.activity, a.mechanism, a.schedule_mode, a.evidence_requirement
from pdtp_activities a join pdtp_programs p on p.id = a.program_id
where p.status = 'active' and a.status = 'active'
  and a.n not in (11, 15, 16, 18, 52, 57, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78)
order by a.n;
```

**Q4. Referencias de evidencia con formato antiguo.** Deberían ser 0. Si hay filas, anotarlas: la descarga PDTP solo sirve rutas `storage/pdtp-evidence/<nombre>`, tanto en `evidence_url` como en `evidence_photos`, y una referencia antigua no cuenta como archivo para aprobar.

```sql
select count(*) from pdtp_executions
where origin <> 'integration'
  and (
    (coalesce(evidence_url, '') <> '' and evidence_url not like 'storage/pdtp-evidence/%')
    or exists (select 1 from jsonb_array_elements_text(evidence_photos) f where f not like 'storage/pdtp-evidence/%')
  );
```

## 2. Antes: comunicación

La jefatura de Prevención avisa a los responsables **48 h antes**:
- Desde el despliegue, declarar una actividad como realizada exige adjuntar una foto o un PDF, salvo en las actividades del RE-20 y de ingreso de personal, donde basta una observación escrita que diga dónde está el respaldo.
- Un envío pendiente de otra persona ya no se puede reemplazar.
- Los envíos pendientes sin archivo (Q2) se devolverán para completarlos.
- El porcentaje de la planilla ahora cuenta solo lo aprobado, y muestra aparte lo que está "por aprobar". El panel muestra "cumplimiento a la fecha" además del avance anual.

## 3. Contingencias

`deploy-prod.sh` imprime al inicio `imagen: <IMAGE> (rollback: <PREV_IMAGE>)`. Por defecto son `ghcr.io/allopze/bodega:latest` y `ghcr.io/allopze/bodega:prev`. Si el `docker-compose.yml` cambió, también imprime `saved previous Compose definition: <ruta>`.

**Falla cualquier paso antes de "Recreating app container".** Incluye la migración, los scripts encadenados del servicio `migrate` (`ensure-prevention-program-slots`, `backfill-cphs-mandatory-sessions`, `reconcile-epp-delivery-scale`) y los pasos de datos y diagnóstico posteriores.
- Aquí el rollback automático todavía no está armado. El script termina sin recrear `app` ni `cron`, que siguen corriendo con la imagen anterior.
- Pero la imagen nueva ya quedó con la etiqueta de producción, y el compose nuevo ya está instalado. Un reinicio posterior levantaría código nuevo contra el esquema viejo, o un `cron` viejo con el crontab nuevo (sus trabajos de Prevención fallarían cada hora con `DTE_CRON_RUNNER_CONFIGURATION`).
- En el servidor de producción:

  ```sh
  docker tag ghcr.io/allopze/bodega:prev ghcr.io/allopze/bodega:latest   # los nombres que imprimió el script
  cp "<ruta impresa en 'saved previous Compose definition'>" "$PROD_DIR/docker-compose.yml"   # solo si la imprimió
  ```

  Si el script dijo `(no existing … found, skipping)`, no hay imagen anterior y la vuelta atrás es manual.
- Para saber en qué estado quedó la base, mirar si el log del servicio `migrate` llegó a `[migrate] done`:
  - **Sin `done`:** 0329 no quedó aplicada (el preflight o la migración abortaron). Corregir la causa, normalmente Q1, y volver a desplegar.
  - **Con `done`:** 0329 ya está aplicada. Volver a desplegar es seguro, porque las migraciones aplicadas no se repiten y los scripts encadenados son idempotentes. No restaurar el `pg_dump` sin evaluarlo antes: la migración es aditiva y el código anterior funciona con ella.
- No volver a desplegar sin haber restituido la etiqueta. El script copia la imagen actual sobre `:prev` al empezar, y se perdería el punto de vuelta bueno.

**Falla la verificación posterior** (health, cron, smoke):
- Con `ROLLBACK_ARMED=1` el script revierte `app` y `cron` y restaura el compose.
- **Excepto** si el log dice `DTE cutover state: encrypted_only` o `unknown`, o `no previous image exists`. En esos casos el script se niega a revertir y la vuelta atrás es manual, con una imagen compatible con el keyring.
- La migración 0329 es aditiva: el código anterior funciona con la columna y el índice nuevos.

## 4. Después: verificación

1. Los 9 crons de Prevención aparecen en `cron_runs` en su primera ventana:
   - `pdtp-weekly-reminders` (lunes);
   - `prevention-capa-reminders`, `prevention-training-reminders`, `prevention-cphs-alerts`, `prevention-document-ack-reminders`, `sst-weekly-alerts`, `deadline-reminders` (diarios);
   - `prevention-incident-reminders` (cada hora);
   - `prevention-inspection-programs` (diario).

   `pdtp-evidence-gc` **no** debe aparecer.
2. El workflow de GitHub Actions `prevention-inspection-programs.yml` ya no existe, así que la materialización de inspecciones corre una sola vez al día (desde el contenedor).
3. Recorrido corto en `/prevencion/pdtp`:
   - registrar sin archivo muestra el mensaje de evidencia obligatoria;
   - el tablero y el listado de programas muestran la misma cifra.
4. Rechazar con motivo los envíos de Q2 que correspondan.

## 5. Qué no hacer

- **No crear el programa 2027** hasta la tanda T5 del plan de pendientes. Hoy la creación anual parte de la Base 2026 y pierde configuración (PREV-C03).
- No agendar `pdtp-evidence-gc` hasta la tanda T7 (barrido con auditoría y modo de prueba).
