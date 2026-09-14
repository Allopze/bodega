# Capítulo 07: Control anual de capacitaciones y brechas

> **Marco:** Decreto Supremo 40 (ODI) y Decreto Supremo 44 (programa de capacitación).
> **Ruta operativa:** `/prevencion/capacitacion`
> **Rutas históricas:** `/prevencion/capacitacion/competencias`, `/prevencion/capacitacion/brechas` y `/prevencion/capacitacion/[sessionId]` conservan el acceso compatible al expediente de sesiones anterior. `/prevencion/capacitacion/catalogo` conserva compatibilidad, pero redirige al control anual.

## 1. Qué controla la pantalla

La pantalla operativa usa un catálogo predefinido para el programa 2026: 14 cursos y 6 campañas. Cada combinación de actividad, faena y posición del cronograma es una **ocurrencia**. El prevencionista de faena no crea cursos ni sesiones desde esta bandeja: revisa la ocurrencia y la marca como **Hecha** o **No hecha**.

El catálogo sólo tiene mapeos PDTP explícitos. Actualmente conectan con el programa las ocurrencias CAP-02 (N°54), CAP-03 (N°63), CAP-04 (N°56), CAP-07 (N°55), CAP-11 (N°58), CAM-01/CAM-02/CAM-06 (N°85), CAM-03 (N°86), CAM-05 (N°87) y CAM-04 (N°89). Las demás actividades del PDTP conservan sus propios módulos o su registro histórico.

## 2. Registrar una ocurrencia

```
[Abrir /prevencion/capacitacion]
               │
               ▼
[Elegir faena y revisar el programa anual]
               │
               ▼
[Abrir la ocurrencia pendiente]
       ┌───────┴────────┐
       ▼                ▼
[Adjuntar evidencia] [Escribir observación]
       │                │
       └───────┬────────┘
               ▼
     [Marcar Hecha o No hecha]
```

1. Selecciona la faena. Una faena inactiva aparece como historial de solo lectura; sus documentos se pueden descargar, pero no se puede cambiar su estado.
2. Revisa el código, actividad, audiencia y período programado. El programa anual visible es el catálogo controlado 2026.
3. Para **Hecha**, adjunta al menos un archivo. Se aceptan PDF, DOCX, XLS/XLSX, JPG o PNG, con un máximo de 25 MB por archivo. Se pueden adjuntar varios archivos, uno por solicitud.
4. Para **No hecha**, la observación es opcional, pero sirve para dejar el motivo o la reprogramación.
5. Confirma el estado. El sistema registra quién lo cambió, cuándo, la versión de la ocurrencia y los identificadores de las evidencias.

Una corrección de **Hecha** a **No hecha** anula las evidencias activas para el uso operativo, pero no las elimina: quedan visibles como historial. Si luego se vuelve a marcar como hecha, se debe adjuntar evidencia nueva.

## 3. Relación con PDTP y exportación

Cuando una ocurrencia tiene actividades PDTP mapeadas, el sistema deja un evento durable de cumplimiento. Si el programa aún no está activo, el evento queda para reconciliación; al activarse se conserva el año planificado y, cuando corresponde, la aprobación automática del hecho de origen. Una falla de acreditación no borra el registro de la capacitación.

**Exportar Excel** descarga el control anual y sus evidencias. Sin filtro de faena agrega las hojas históricas del expediente de sesiones; con una faena seleccionada respeta ese filtro y también permite consultar el historial de una faena inactiva.

## 4. Expediente y brechas históricas

La matriz de competencias (`/prevencion/capacitacion/competencias`) y las brechas (`/prevencion/capacitacion/brechas`) siguen disponibles para consultar las habilitaciones por persona, vencimientos y requisitos. El detalle de una sesión anterior se abre en `/prevencion/capacitacion/[sessionId]`, con las acciones históricas compatibles según permisos. Estas rutas no son una segunda bandeja para crear ocurrencias del catálogo anual.

Si una brecha bloqueante aparece en el expediente, coordina la capacitación correspondiente y revisa el cumplimiento en el catálogo anual cuando exista una ocurrencia controlada para esa actividad.
