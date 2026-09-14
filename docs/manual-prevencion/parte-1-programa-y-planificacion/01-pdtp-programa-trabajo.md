# Capítulo 01: El Programa de Trabajo Preventivo (PDTP) en Faena

> **Marco Normativo:** Decreto Supremo 44 (DS 44), Artículo 8: *Programa de trabajo preventivo del Sistema de Gestión de la Seguridad y Salud en el Trabajo (SG-SST)*.  
> **Ruta en Plataforma:** Menú > Prevención > **Programa de trabajo** (`/prevencion/pdtp`).

---

## 1. ¿Qué es el Programa de Trabajo Preventivo (PDTP)?

El Programa de Trabajo Preventivo es el instrumento legal y corporativo que define **todas las actividades de seguridad, salud ocupacional y medio ambiente que deben cumplirse durante el año** en cada faena de CHOME. 

El programa anual activo (`pdtp-2026-v1`) contiene **81 actividades vigentes** distribuidas en las 6 faenas operativas:
*   Biodiversa
*   Cholguan - Arauco
*   Horcones
*   Masisa
*   Santa Fe - Grúas
*   Teno - Arauco

### La Gran Regla: "El trabajo se ejecuta en terreno, el PDTP se acredita solo"
A diferencia de las planillas Excel antiguas donde había que pintar manualmente casillas y escribir textos, **en esta plataforma el PDTP se nutre automáticamente**:
*   Cuando terminas una inspección de extintores en el submódulo de *Inspecciones*, la actividad **N° 24** se marca como cumplida en tu faena.
*   Cuando registras la charla diaria en *Capacitación*, la actividad **N° 53** se acredita sola.
*   Cuando el Administrador de Contrato sube el comprobante de la DIAT en *Incidentes*, la actividad **N° 72** se aprueba de inmediato.

Solo aquellas actividades que no tienen un submódulo propio (por ejemplo, una reunión de coordinación especial) se acreditan mediante una **Constancia** (ver Capítulo 02).

---

## 2. Navegación por las Pantallas del PDTP

Dentro de `/prevencion/pdtp` encontrarás las siguientes secciones accesibles desde el menú o las pestañas superiores:

```
PROGRAMA DE TRABAJO
├── Tablero de Avance (Vista principal): Porcentaje de cumplimiento por faena y alertas.
├── Actividades (/prevencion/pdtp/actividades): Catálogo de las 81 actividades.
├── A demanda y por evento (/prevencion/pdtp/obligaciones): Actividades que se gatillan por sucesos.
├── Medidas (/prevencion/pdtp/acciones): Planes de acción derivados de desviaciones del programa.
├── Cobertura (/prevencion/pdtp/cobertura): Porcentaje de dotación o inventario alcanzado.
└── Constancias (/prevencion/constancias): Formulario para actividades autodeclaradas.
```

---

## 3. Cómo Leer la Planilla de Avance de tu Faena

Al ingresar a la vista de detalle de tu faena en `/prevencion/pdtp`, verás la matriz cronológica de las actividades distribuidas en semanas y meses (Enero a Diciembre).

### Significado de los Colores de Cada Celda:

| Color de Celda | Estado | Significado para el Prevencionista |
|---|---|---|
| 🟢 **Verde** | **Cumplida / Acreditada** | El trabajo se ejecutó en la fecha requerida, la evidencia está vinculada y el sistema validó el cumplimiento. No requiere acción. |
| 🟡 **Amarillo** | **Pendiente en plazo** | La actividad corresponde al mes o semana actual. Es tu tarea prioritaria para los próximos días. |
| 🔴 **Rojo** | **Vencida / Incumplida** | El período programado finalizó sin que se registrara la evidencia necesaria. Requiere plan de acción o justificación formal. |
| ⚪ **Gris / Rayado** | **No exigible** | La actividad no aplica para ese mes específico, o pertenece a un período previo a la fecha de activación del programa. |

---

## 4. Tipos de Programación de Actividades

No todas las 81 actividades se miden igual. Existen 3 modalidades en el sistema:

### A. Programación por Cuota Fija (Planificado vs. Real)
Son actividades de frecuencia predefinida (mensual, bimestral, trimestral o semestral).  
*Ejemplo:* Inspección de contenedores (N° 29, mensual).  
*Meta:* Realizar 1 inspección en el mes. Al cerrar la inspección, la meta pasa de `0/1` a `1/1` (100% verde).

### B. Programación por Cobertura
Son actividades que exigen alcanzar a un porcentaje del universo total de personas o equipos de la faena.  
*Ejemplo:* Inspección de extintores (N° 24) o examen de salud ocupacional (N° 50).  
*Meta:* Si tu faena tiene 40 extintores en inventario, el sistema exige inspeccionar los 40 durante el ciclo para alcanzar el 100%.

### C. A Demanda y por Evento (Triggered)
Son compromisos que no tienen un mes predeterminado en el calendario, sino que **se activan ante un hecho de la operación**:
*   Ingreso de un trabajador nuevo -> Activa la obligación de Inducción ODI y acompañamiento de 4 semanas (N° 15, 18, 19).
*   Ocurrencia de un accidente -> Activa el carril de notificación DIAT (N° 72) y el informe preliminar de investigación (N° 68).

Puedes revisar todas las obligaciones abiertas de tu faena en `/prevencion/pdtp/obligaciones`.

---

## 5. Descarga de Reportes y Evidencias para Auditorías

Cuando recibas una auditoría del mandante o una fiscalización de la Inspección del Trabajo:

1. Ve a `/prevencion/pdtp`.
2. Filtra por tu **Faena**.
3. Haz clic en el botón superior **"Exportar Excel"**.
4. El sistema generará una planilla Excel con formato oficial que contiene:
   *   El consolidado de avance anual.
   *   El detalle de cada una de las 81 actividades.
   *   El identificador único de cada evidencia registrada (número de inspección, acta o código de sesión de capacitación).

> [!TIP]
> **Consejo de terreno:** Descarga este reporte a fin de cada mes y mantén una copia guardada en tu computador para poder presentarla de inmediato si un auditor o fiscalizador llega a la faena sin previo aviso.
