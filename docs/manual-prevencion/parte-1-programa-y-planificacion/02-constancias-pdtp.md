# Capítulo 02: Registro de Constancias del Programa Preventivo

> **Ruta en Plataforma:** Menú > Prevención > **Constancias** (`/prevencion/constancias`).  
> **Permisos Requeridos:** `prevention:constancias:view` (ver) y `prevention:constancias:execute` (registrar).

---

## 1. ¿Cuándo se Utiliza una Constancia?

En el Programa de Trabajo Preventivo (PDTP), la gran mayoría de las actividades se ejecutan en submódulos especializados (Inspecciones, Capacitación, Incidentes, etc.). 

Sin embargo, existen **9 actividades específicas** que no cuentan con un formulario digital interactivo porque corresponden a reuniones de coordinación, verificaciones documentales o actividades autodeclaradas en terreno:

| N° Actividad | Nombre de la Actividad en el PDTP | Frecuencia Habitual | Responsable en Faena | Evidencia Mínima Exigible |
|---|---|---|---|---|
| **N° 3** | Envío de informe de gestión mensual | Mensual | PRF / Administrador | Correo formal o comprobante de recepción |
| **N° 6** | Reunión técnica mensual de prevención | Mensual | PRF / Jefe de Terreno | Acta de reunión firmada con lista de asistencia |
| **N° 20** | Verificación de documentación de ingreso | Mensual / Ingreso | PRF | Lista de chequeo documental de ingresos |
| **N° 22** | Difusión de alerta de seguridad en terreno | Por evento | PRF / Supervisor | Registro de asistencia a la charla de alerta |
| **N° 28** | Inspección física de bodegas y pañoles | Mensual | PRF / Jefe de Terreno | Pauta escaneada o informe fotográfico |
| **N° 42** | Revisión de matriz de control operacional | Trimestral | PRF | Minuta de revisión firmada |
| **N° 44** | Verificación de botiquines y camillas | Mensual | PRF | Checklist físico firmado o fotos |
| **N° 61** | Entrega de boletín informativo o circular | Mensual | PRF / Supervisor | Registro de entrega o comprobante de difusión |
| **N° 82** | Verificación de señalética y vías de evacuación | Semestral | PRF | Reporte de inspección de señalética |

---

## 2. Paso a Paso: Cómo Registrar una Constancia

Sigue estos pasos para ingresar una constancia válida en la plataforma:

```
[Entrar a /prevencion/constancias]
               │
               ▼
[Presionar "Nueva Constancia"]
               │
               ▼
1. Seleccionar la Faena y la Actividad del PDTP
2. Seleccionar el Mes y Semana correspondiente
3. Escribir descripción detallada de lo ejecutado
4. Adjuntar Evidencia (PDF de lista firmada o Foto)
               │
               ▼
[Presionar "Guardar y Acreditar"]
```

### Paso 1: Ingreso a la Pantalla
Dirígete a `/prevencion/constancias`. Verás el listado de constancias ingresadas previamente en tus faenas autorizadas. Haz clic en el botón superior derecho **"Nueva constancia"**.

### Paso 2: Selección de la Actividad y el Período
1. **Faena:** Selecciona tu centro de trabajo (Biodiversa, Cholguan, Horcones, Masisa, Santa Fe o Teno).
2. **Actividad del Programa:** Elige en el desplegable cuál de las 9 actividades estás respaldando. El sistema solo te mostrará aquellas que acreditan vía constancia.
3. **Período (Mes y Semana):** Elige el período que vas a saldar (por ejemplo: *Septiembre - Semana 2*).
   > [!WARNING]
   > El sistema no te permitirá registrar constancias en semanas previas a la fecha en que se activó formalmente el programa preventivo anual.

### Paso 3: Descripción de la Actividad Ejecutada
En el campo de texto describe con claridad:
*   Quiénes participaron (ej. *Jefe de Terreno Juan Pérez, Supervisor Carlos Soto y 12 operadores*).
*   Lugar exacto de la faena (ej. *Sector Pañol Central y Patio de Maniobras*).
*   Principales conclusiones o acuerdos tomados.

### Paso 4: Carga de Evidencia Obligatoria
Una constancia sin respaldo documental puede ser observada en una auditoría externa:
*   **Documentos PDF:** Actas de reunión escaneadas con firmas de los asistentes, listas de asistencia o informes técnicos.
*   **Fotografías:** Imágenes nítidas del trabajo en terreno o del cartel/vitrina donde se difundió la información.
*   Presiona **"Subir archivo"** o arrastra el documento a la zona indicada.

### Paso 5: Guardar y Validar
Presiona **"Guardar constancia"**. Si los datos son correctos:
1. El sistema generará un número de constancia único (ej. `CST-2026-0045`).
2. Se actualizará en tiempo real la celda correspondiente en el Programa de Trabajo Preventivo (`/prevencion/pdtp`), pasando de color amarillo a verde.

---

## 3. Consejos para Evitar Observaciones en Auditorías

> [!IMPORTANT]
> **Autodeclaración con Respaldo Real:**  
> Los fiscalizadores de la Dirección del Trabajo y auditores de empresas mandantes prestan especial atención a las constancias, porque a diferencia de las inspecciones digitales que capturan fecha y hora en el teléfono, la constancia es autodeclarada por el prevencionista.
> *   **No subas documentos sin firmas:** Toda acta o lista de asistencia debe llevar firma manuscrita de los participantes.
> *   **No uses textos genéricos:** Evita frases como *"Se cumplió la actividad conforme a lo planificado"*. Sé específico sobre qué se hizo ese día en esa faena.
