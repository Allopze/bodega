# Detección de anomalías y reglas de alerta

La pantalla `Anomalías` (ubicada en `Combustibles > Anomalías`) analiza en tiempo real las cargas de combustible e identifica patrones irregulares o posibles fraudes.

## Tipos de anomalías detectadas

- **Exceso de capacidad de estanque**: Cargas que superan la capacidad nominal en litros registrada para el estanque del vehículo.
- **Rendimiento fuera de rango**: Consumo de km/litro u hora/litro significativamente inferior al rendimiento esperado del equipo.
- **Cargas múltiples o consecutivas**: Dos o más cargas realizadas para una misma patente en un intervalo de tiempo inviable.
- **Odómetro o Horómetro retrocedido**: Inconsistencia en la lectura de kilometraje respecto a la última carga registrada.

## Cómo gestionar reglas de alerta

1. Ingresa a `Combustibles > Anomalías > Reglas`.
2. Revisa los umbrales de tolerancia configurados (ej. *Alerta si la carga supera el 105% de la capacidad del estanque*).
3. Modifica los valores límite de ser necesario si tu rol de administración lo autoriza.

## Revisión y resolución de alertas

1. En la lista de `Anomalías pendientes`, haz clic sobre una carga marcada con alerta.
2. Examina los antecedentes del vehículo y el voucher cargado.
3. Clasifica la anomalía como:
   - **Justificada**: Error de digitación de odómetro o carga excepcional autorizada.
   - **Confirmada / Fraude**: Se deriva a investigación administrativa.
