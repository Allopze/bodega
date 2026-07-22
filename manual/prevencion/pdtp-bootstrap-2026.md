# Runbook de bootstrap PDTP 2026

Este procedimiento traduce el archivo 2026 al modelo general del constructor. No convierte la planilla en la interfaz del programa ni reemplaza el flujo normal de creación desde cero, plantilla o copia.

## Alcance y condiciones previas

Antes de escribir datos:

1. Congelar el archivo fuente y verificar que su SHA-256 sea `a6adc0fa017a9972dde09e5abdddb399cfce23526332807a122e52bfd15690a4`.
2. Aplicar migraciones con `npm run db:migrate` y ejecutar `npm run db:generate`; debe responder `No schema changes`.
3. Crear en la interfaz un programa 2026 en estado borrador y anotar su ID. El comando no elige ni crea silenciosamente un programa.
4. Usar un usuario activo con `prevention:pdtp:program:manage`. Para aplicar las E, ese usuario debe ser global o tener asignada la faena elegida.
5. Confirmar con Prevención a qué faena pertenecen las seis E y conservar el motivo que autoriza migrarlas sin archivo adjunto.
6. En staging o producción, tomar un respaldo verificable antes de aplicar.

El comando valida extensión/MIME, envolvente ZIP, límites de expansión, estructura P/E, ocho hojas, 89 actividades y el hash oficial. `--allow-compatible-source` se reserva para fixtures controladas; no debe usarse para saltar una diferencia del archivo productivo.

## 1. Dry-run sin base de datos

Local:

```bash
npm run pdtp:bootstrap-2026 -- \
  --file "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx" \
  --year 2026 \
  --user-id <ID_USUARIO> \
  --strategy dry-run \
  --worksite-strategy none
```

La salida obligatoria es: 8 objetivos, 89 actividades, 8 vistas, 843 celdas P, total P 1.035, 6 celdas E y total E 6. `mutatedDatabase` debe ser `false`. Guardar el JSON como evidencia del cambio.

## 2. Staging persistente sin aplicar

```bash
npm run pdtp:bootstrap-2026 -- \
  --file "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx" \
  --year 2026 \
  --user-id <ID_USUARIO> \
  --strategy stage \
  --worksite-strategy none \
  --program-id <ID_PROGRAMA_BORRADOR>
```

Esto crea o reutiliza un lote por programa/hash, pero no modifica actividades ni ejecuciones. Revisar el preview: altas/actualizaciones, calendario, membresías, checklists y vínculos preservados, metadatos, advertencias y las seis coordenadas E.

Un preview rechazado se cancela desde el constructor indicando un motivo de al menos diez caracteres. La cancelación queda con actor y timestamp y permite volver a analizar el mismo archivo en un lote nuevo.

## 3. Aplicación controlada

```bash
npm run pdtp:bootstrap-2026 -- \
  --file "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx" \
  --year 2026 \
  --user-id <ID_USUARIO> \
  --strategy apply \
  --worksite-strategy single \
  --program-id <ID_PROGRAMA_BORRADOR> \
  --worksite-id <ID_FAENA> \
  --accept-missing-evidence \
  --reason "Histórico validado por Jefatura de Prevención"
```

El comando:

- deriva el alcance real del usuario y falla si la faena es ajena;
- aplica actividades, calendario, vistas, metadatos y seis E dentro de una transacción;
- conserva coordenada, cantidad, hash/lote, actor y faena de cada E, con `migrated_without_attachment`;
- instala después nueve plantillas de checklist versionadas en las actividades correspondientes;
- deja visibles como `needs_review` las 22 actividades sin P; no presume que sean a demanda.

Repetir exactamente el comando sobre el mismo programa y archivo no duplica lote, ejecuciones ni checklists.

Después de que un responsable confirme en el constructor la modalidad, disparador, plazo, evidencia e indicador de las 22 actividades, la publicación de la base es explícita:

```bash
npm run pdtp:bootstrap-2026 -- \
  --file "PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx" \
  --year 2026 \
  --user-id <ID_USUARIO> \
  --strategy apply \
  --worksite-strategy single \
  --program-id <ID_PROGRAMA_BORRADOR> \
  --worksite-id <ID_FAENA> \
  --accept-missing-evidence \
  --reason "Histórico validado por Jefatura de Prevención" \
  --publish-reference
```

El servicio rechaza la publicación si queda una modalidad pendiente. Si el digest no cambió, repetir el comando reutiliza la misma versión de `Referencia preventiva 2026`.

## 4. Reconciliación posterior

No promover el programa sólo porque el comando terminó. Verificar y guardar evidencia de:

- 1 programa, 8 objetivos, 89 actividades y 8 vistas;
- 843 filas/celdas de planificación y suma 1.035;
- seis ejecuciones en la faena correcta, con celdas `M14`, `O15`, `G19`, `I19`, `K19` y `M19`;
- nueve checklists activos y, sólo tras resolver las 22 modalidades, una versión de la plantilla `Referencia preventiva 2026`;
- cero actividades, ejecuciones o relaciones duplicadas tras un segundo intento;
- advertencia pendiente de reconciliar la fórmula vacía de `Z7`;
- clasificación explícita de las 22 actividades sin P antes de aprobar el contenido.

## 5. Rollback del lote

El rollback sólo procede mientras no existan cambios posteriores incompatibles en el programa:

```bash
npm run pdtp:bootstrap-2026 -- \
  --year 2026 \
  --user-id <ID_USUARIO> \
  --strategy rollback \
  --worksite-strategy none \
  --batch-id <ID_LOTE> \
  --reason "Reversión autorizada durante la ventana controlada"
```

El servicio valida alcance sobre la faena registrada, elimina las E del lote y restaura el snapshot anterior. Si después del apply se instalaron checklists, se publicó la plantilla o se editó el programa, el rollback falla cerrado; en ese caso se restaura el respaldo y se reconcilian por separado los eventos de la ventana.

## 6. Staging y producción

Ejecutar el mismo script con el archivo de entorno explícito, nunca copiando secretos a la línea de comandos:

```bash
npx tsx --env-file=.env.staging scripts/bootstrap-pdtp-2026.ts <argumentos>
npx tsx --env-file=.env.prod scripts/bootstrap-pdtp-2026.ts <argumentos>
```

Secuencia obligatoria: respaldo probado → migraciones → dry-run guardado → stage y revisión humana → apply → reconciliación → pruebas de humo por rol/faena → inicio de marcha paralela. No retirar el mecanismo anterior ni declarar cutover con evidencia sólo local.
