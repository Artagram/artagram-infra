# Evidencias de los escenarios de disponibilidad

Capturas de la salida real de cada comando, con su hora, tomadas contra
producción (AWS us-east-1) el 2026-11-19. Cada imagen es un paso; en las
capturas se reemplazó el número de cuenta de AWS por `<cuenta>`.

## Escenario 2: caída de una réplica del feed en pico de carga

500 usuarios cargando el feed con k6 (`pruebas-carga/escenario2-feed.js`),
2 réplicas de feed y del gateway; a los 90 s se detiene una réplica de feed.

| Medida | Pide | Resultado |
|---|---|---|
| Peticiones atendidas | ≥ 99 % | **99,99 %** (1 falla en 49 812) |
| Réplica caída retirada | < 30 s | **~5 s** (`DEACTIVATING`, ECS la saca de Cloud Map) |
| p95 por página | < 1 s | **128 ms** |

- `paso-1`: estado inicial, 2 réplicas sanas de 1 vCPU.
- `paso-2`: se detiene una réplica en pleno pico.
- `paso-3` a `paso-14`: seguimiento cada 5 s; la réplica sale a los ~5 s y ECS
  levanta un reemplazo que queda sano a los ~50 s.
- `paso-15`: resultado de k6 con los umbrales cumplidos.

Hallazgo: en un primer intento, con feed en 0,25 vCPU, la disponibilidad se
cumplía (99,94 %) pero el p95 fue de 13 s porque feed se saturaba. Se subió a
1 vCPU (`ecs/task-definitions/artagram-feed.json`).

## Escenario 3: caída del worker de IA

| Medida | Pide | Resultado |
|---|---|---|
| Solicitudes perdidas | 0 | **0**: siguió `PENDIENTE` 90 s con el worker en 0 tareas |
| Pendientes procesadas tras la recuperación | < 5 min | **31 s** |
| Feed, chat y lienzo durante la caída | sin variación | todo 200, p95 similar a la línea base |

- `paso-1`/`paso-2`: worker corriendo y latencia base de feed, chat y lienzo.
- `paso-3`: el worker termina; se espera a que su contenedor esté detenido.
- `paso-4`: con el worker caído se pide un análisis: queda `PENDIENTE`.
- `paso-5`: feed, chat y lienzo responden igual durante la caída.
- `paso-6`: 90 s después la solicitud sigue en cola.
- `paso-7`/`paso-8`: el worker vuelve y procesa la pendiente en 31 s.
- `paso-9`: el análisis completo.

## Escenario 4: reconexión en el lienzo

Ver `escenario4/`.
