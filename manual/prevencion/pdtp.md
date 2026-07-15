# Programa de Trabajo Preventivo SG-SST

Esta pantalla muestra el programa preventivo por hoja, faena y periodo, e
integra el checklist de verificacion, el plan de accion y el seguimiento de
cada actividad ejecutada.

## Como usarla

1. Entra a `Programa de Trabajo Preventivo SG-SST`.
2. Elige el anio.
3. Elige la hoja y la faena.
4. Revisa el estado del programa: cantidad ejecutada por actividad y mes.
5. Para verificar una ejecucion, abre `Ver verificacion` en la celda
   correspondiente.

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

## Vista de acciones y exportacion

- La vista `Plan de accion` (dentro de Prevencion) lista todas las acciones
  del programa con filtros por estado, prioridad, faena y vencidas.
- Usa `Exportar XLSX` para descargar el programa junto con hojas separadas de
  plan de accion y seguimiento.

## Acciones principales

- `Aprobaciones`
- `Exportar programa`
- `Aprobar (JDPR)`
- `Registrar` actividades
- `Iniciar verificacion` / `Enviar revision`
- `Verificar y cerrar` / `Reabrir`
