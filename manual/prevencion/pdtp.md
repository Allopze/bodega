# Programa de Trabajo Preventivo SG-SST

El programa preventivo se crea y mantiene en un constructor guiado. No es
necesario conocer las hojas ni la grilla semanal del Excel: el archivo 2026
es una fuente de migracion y una referencia, no la interfaz de trabajo.

## Crear un programa

1. Entra a `Programa de Trabajo Preventivo SG-SST` y usa `Nuevo programa`.
2. Elige el periodo y un punto de partida:
   - `Programa vacio`: crea una vista general para construir una base nueva.
   - `Plantilla`: usa una version publicada e inmutable.
   - `Periodo anterior`: copia su estructura para el nuevo año.
3. Completa los seis pasos: datos basicos, objetivos, actividades, cuando se
   realiza, evidencias y revision.
4. En cada actividad selecciona una frecuencia, `Cuando se necesite` o
   `Cuando ocurra un evento`. La plataforma muestra cuantas obligaciones
   generara antes de guardar.
5. Desde `Revision`, vuelve al resumen y envia el borrador al flujo de
   aprobacion configurado.

Duplicar un programa, una actividad o una plantilla conserva objetivos,
reglas, vistas y checklist. Nunca copia ejecuciones, evidencias ya rendidas ni
firmas. Mover o editar varias actividades tampoco rompe su calendario,
checklist o pertenencia a vistas.

## Plantillas versionadas

Desde el paso `Revision` puedes publicar la estructura lista como plantilla.
Si publicas otra vez con el mismo nombre se crea una version nueva; los
programas existentes permanecen fijados a la version original. `Plantillas`
en la cabecera del listado muestra la huella de cada version y los programas
que la usan.

## Importar un archivo existente

La importacion avanzada acepta solo `.xlsx`. Valida tipo, firma ZIP, limites
de expansion y estructura antes de leer el libro. Primero crea un lote de
staging y muestra altas, cambios, P, E, advertencias y hash sin modificar el
programa. Si hay E historicas, exige una faena autorizada, aceptación expresa
y motivo; las registra como migradas sin evidencia adjunta, conservando su
celda de origen. El apply es atomico y existe rollback mientras no haya cambios
posteriores. Esto no sustituye la reconciliacion y aprobacion productiva.

## Ejecutar y controlar el programa

Una vez activo, la pantalla muestra el programa por vista, faena y periodo, e
integra el checklist de verificacion, el plan de accion y el seguimiento de
cada actividad ejecutada.

Las actividades que no tienen una fecha fija se gestionan en `Trabajo por
eventos`. La pantalla distingue dos modalidades:

- `Cuando se necesite`: una persona autorizada registra la necesidad y explica
  el motivo que abre el caso.
- `Cuando ocurra un evento`: el caso conserva el tipo, identificador y fecha
  del hecho que lo origino. Una integracion no puede omitir esa fecha.

Cada caso crea una obligacion con plazo y evidencia minima. Los estados son
`Pendiente`, `Vencida`, `Reportada`, `Completada` y `Cancelada`. Reportar el
trabajo lo envia a aprobacion; solo la aprobacion lo convierte en cumplimiento.
Si todavia no ocurren casos, la interfaz muestra `Sin casos`: no lo interpreta
como 0 % ni como 100 %.

El cron PDTP envia avisos a ejecutores con acceso a la faena cuando una
obligacion entra en las ventanas de 7 dias, 1 dia o vencida. Cada aviso se
registra una sola vez por obligacion, persona y ventana.

## Como usarla

1. Entra a `Programa de Trabajo Preventivo SG-SST`.
2. Elige el anio.
3. Elige la hoja y la faena.
4. Revisa el estado del programa: cantidad ejecutada por actividad y mes.
5. Para verificar una ejecucion, abre `Ver verificacion` en la celda
   correspondiente.

En `Vista anual`, las columnas N° y Actividad quedan visibles al desplazarte
horizontalmente. Usa `Ver programa y responsables` dentro de la actividad para
consultar ese contexto sin ensanchar la matriz. Los períodos y estados se
muestran como, por ejemplo, `Jul · Sem 2` y `Enviada`.

## Checklist de verificacion

1. En la ficha de una actividad (modo edicion del programa), abre la pestana
   `Checklist` para definir o editar la plantilla de verificacion de esa
   actividad (secciones e items, editados como JSON asistido y validados al
   guardar).
2. En la ejecucion de un periodo, usa `Iniciar verificacion` para crear una
   instancia del checklist.
3. Marca cada item como `cumple`, `no cumple` o `no aplica`. Los items
   `no cumple` requieren una observacion.
4. Cuando termines, usa `Enviar revision`: el checklist queda `completado` y
   se calcula el porcentaje de cumplimiento de esa instancia.

## Plan de accion (automatico)

- Al enviar la revision, cada item `no cumple` genera automaticamente una
  accion correctiva en el plan de accion de la ejecucion (responsable,
  prioridad y plazo derivados de la seccion y, si el item lo define, de su
  nivel de riesgo). Tambien puedes agregar acciones manuales.
- Cada accion tiene un responsable, un plazo y un estado
  (`pendiente` → `en_proceso` → `completado` → `verificado`, o `reabierto`
  si se reabre).
- Registra `Seguimiento` sobre una accion: observacion, cambio de estado y,
  si corresponde, evidencia fotografica.
- Quien tenga permiso de verificacion usa `Verificar y cerrar` para cerrar la
  accion, o `Reabrir` si el cierre no fue efectivo.

## Cumplimiento integral

El panel de indicadores muestra tres ejes — ejecucion (cantidad), verificacion
(checklist conforme) y cierre (acciones cerradas a tiempo) — y el porcentaje
ponderado resultante.

El cumplimiento calendarizado y la respuesta a necesidades/eventos tienen
denominadores distintos. Una actividad a demanda solo entra a su indicador
cuando existe un caso real; nunca se convierte en una cuota semanal ficticia.

## Historia de una referencia importada

En el detalle del programa, `Historia y referencias del documento importado`
conserva nombres, cargos, fechas, control de cambios y leyenda de roles tal como
fueron declarados en la fuente. Es una referencia documental: no equivale a una
firma de Chome. Si una persona declarada se vincula con un usuario interno, la
reconciliacion es explicita, exige motivo y conserva siempre el nombre original.

## Vista de acciones y exportacion

- La vista `Plan de accion` (dentro de Prevencion) lista todas las acciones
  del programa con filtros por estado, prioridad, faena y vencidas.
- Usa `Exportar Excel` para descargar el programa junto con hojas separadas de
  plan de accion y seguimiento.

## Navegación del programa

- En `Programa` se consulta y ejecuta el plan de la faena y período elegidos.
- `Trabajo por eventos` concentra obligaciones a demanda, disparadas, vencidas
  y pendientes de aprobacion dentro del alcance de faena del usuario.
- `Aprobaciones` y `Acciones correctivas` son vistas internas del mismo
  programa: se accede a ellas desde el submenú de Programa y conservan sus
  permisos propios.

## Acciones principales

- `Aprobaciones`
- `Exportar programa`
- `Aprobar (JDPR)`
- `Registrar` actividades
- `Iniciar verificacion` / `Enviar revision`
- `Verificar y cerrar` / `Reabrir`
