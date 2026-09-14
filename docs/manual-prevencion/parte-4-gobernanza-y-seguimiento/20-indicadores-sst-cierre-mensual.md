# Capítulo 20: Indicadores Estadísticos SST y Cierre Mensual

> **Marco Normativo:** Decreto Supremo 40 (Artículo 12: Obligación de llevar estadísticas de accidentes), Decreto Supremo 67 (Siniestralidad efectiva y cotización adicional) y Decreto Supremo 44.  
> **Ruta en Plataforma:** Menú > Seguimiento > **Indicadores SST** (`/prevencion/indicadores`).  
> **Actividad PDTP Asociada:** N° 7 (Envío y cierre de estadística mensual de cada faena).

---

## 1. La Estadística Mensual de Faena

El cálculo de las tasas estadísticas no es solo un trámite administrativo: es el termómetro que mide la salud operacional de la faena e influye directamente en la **tasa de cotización adicional de la Ley 16.744** que la empresa paga ante la Mutual.

El cierre mensual de la estadística de tu faena es el acto formal que **acredita la actividad N° 7 del Programa de Trabajo Preventivo (PDTP)**.

---

## 2. Los Indicadores Clave y sus Fórmulas Legales

La plataforma calcula automáticamente las siguientes tasas una vez ingresados los datos del mes:

| Indicador | Sigla | Fórmula Legal (DS 40 / DS 67) | Interpretación Operativa |
|---|---|---|---|
| **Horas Hombre Trabajadas** | **HHT** | Suma de horas trabajadas por toda la dotación en el mes | Mide el volumen total de exposición al riesgo en la faena. |
| **Tasa de Frecuencia** | **TF** | $\frac{\text{N° Accidentes con Tiempo Perdido} \times 1.000.000}{\text{HHT}}$ | Cuántos accidentes con tiempo perdido ocurren por cada millón de horas hombre laboradas. |
| **Tasa de Gravedad** | **TG** | $\frac{\text{Días Perdidos} \times 1.000.000}{\text{HHT}}$ | Cuántos días de trabajo se pierden por licencias médicas por cada millón de horas trabajadas. |
| **Tasa de Accidentabilidad** | **TA** | $\frac{\text{N° Accidentes Totales}}{\text{Dotación Promedio}} \times 100$ | Porcentaje de trabajadores accidentados en el período. |
| **Tasa de Siniestralidad** | **TS** | $\frac{\text{Días Perdidos Totales}}{\text{Dotación Promedio}} \times 100$ | Nivel de daño y severidad que sufren los trabajadores. |

---

## 3. Paso a Paso: Cómo Realizar el Cierre Mensual (Actividad PDTP N° 7)

Este procedimiento debe ejecutarse entre los **días 25 y el último día del mes en curso**:

```
[Solicitar HHT y Dotación a RRHH/Jefe de Faena]
                      │
                      ▼
[Ir a /prevencion/indicadores]
                      │
                      ▼
1. Seleccionar Faena y Período Mensual
2. Ingresar Horas Hombre Trabajadas (HHT)
3. Confirmar Accidentes y Días Perdidos del Mes
4. Verificar Cálculo Automático de Tasas
                      │
                      ▼
[Presionar "Cerrar Período Mensual"]
                      │
                      ▼
[Acreditación Inmediata de la Actividad N° 7 en el PDTP]
```

### Paso 1: Obtención de Datos de Entrada
Antes de abrir la pantalla, coordina con la oficina de personal o el Jefe de Terreno:
*   **Total HHT del mes:** Suma de las horas normales y horas extras trabajadas por toda la dotación en el mes (no descuentes las horas de charla ni descansos reglamentarios; descuenta licencias médicas previas y vacaciones).
*   **Dotación Promedio:** Número de trabajadores asignados a la faena durante el mes.

### Paso 2: Carga en la Plataforma
1. Ingresa a `/prevencion/indicadores`.
2. Filtra por tu **Faena** y selecciona el mes que vas a cerrar (ej. *Septiembre 2026*).
3. En la tarjeta del mes, haz clic en **"Registrar datos del período"**.
4. Digita las **HHT** y la **Dotación Promedio**.
5. **Revisión de Accidentes:** El sistema traerá automáticamente los accidentes y días perdidos registrados en el módulo de *Incidentes* (`/prevencion/incidentes`). Si una licencia médica emitida por la Mutual llegó con atraso, puedes ajustar los días perdidos reales correspondientes al mes.

### Paso 3: El Acto de Cierre
1. Revisa las tasas proyectadas en el panel.
2. Si los valores son coherentes con la realidad de la faena, haz clic en el botón verde **"Cerrar período mensual"**.
3. **Confirmación:** El sistema bloqueará los datos para evitar alteraciones accidentales y registrará tu firma electrónica con fecha y hora.
4. **Impacto en el PDTP:** La celda de la actividad **N° 7** en `/prevencion/pdtp` cambiará inmediatamente de amarillo a **verde** para tu faena.

---

## 4. ¿Qué Hacer si Llega una Licencia Médica con Atraso? (Rectificación de Período)

En ocasiones, una resolución médica de la Mutual reconoce días de reposo de un accidente semanas después de que el mes fue cerrado:

*   El sistema permite al Prevencionista de Faena presionar **"Solicitar reapertura o rectificación"**.
*   Ingresa el motivo fundamentado (ej. *Se recepciona dictamen de Mutual que otorga 12 días de licencia adicionales para accidente de Juan Pérez ocurrido el día 18*).
*   Se ajusta el valor y se vuelve a cerrar el período. El sistema mantendrá la bitácora auditable de la modificación para tranquilidad de la empresa.
