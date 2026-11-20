# Evidencias de los escenarios de calidad

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

Dos navegadores reales (Firefox con Playwright) en el mismo lienzo de
producción. Al navegador A se le corta la red, dibuja sin conexión mientras B
también dibuja, y se le devuelve la red
(`pruebas-carga/escenario4-navegador.mjs`). Tres corridas seguidas:

| Medida | Pide | Resultado |
|---|---|---|
| Aviso de pérdida de conexión | inmediato | **~30 ms** después del corte |
| Reconexión | < 5 s | **3,94 s**, 3,95 s y 3,94 s |
| Lienzos tras reconectar | idénticos | **idénticos** (misma huella SHA-256 de los píxeles en A y B) |

- `navegador-1` a `navegador-5`: A a la izquierda y B a la derecha, en cada
  paso: inicio, trazo en vivo, corte de red (aviso en A), dibujo sin red y
  estado final con los tres trazos en ambos.
- `automatizada-1` a `automatizada-3`: pruebas unitarias del cliente STOMP
  (reconexión, cola de mensajes y resincronización).
- `resumen.txt`: salida de las tres corridas.

Hallazgos que la prueba encontró y se corrigieron en el frontend antes de
estas corridas: la reconexión podía tardar ~22 s porque un intento colgado
esperaba el timeout del navegador (ahora `connectionTimeout` de 2 s y
reconexión inmediata con el evento `online`), y el trazo dibujado sin red se
pintaba dos veces al resincronizar.

## Escenario 6: petición con token de acceso inválido

Un atacante (una tarea de Fargate con k6, IP pública `32.192.197.107`) manda
20 peticiones por minuto durante 3 min a `/api/feed/siguiendo`: sin token, con
token vencido, con la firma alterada y firmado con otra llave
(`pruebas-carga/escenario6-token-invalido.js`).

| Medida | Pide | Resultado |
|---|---|---|
| Peticiones con token inválido frenadas en el gateway | 100 % | **100 %**: 61 de 61 (10 con 401 `NO_AUTENTICADO`, 51 con 429 `ORIGEN_BLOQUEADO`) |
| Peticiones que llegan a los microservicios | 0 | **0**: las peticiones reenviadas a feed no cambian en ninguna de las dos réplicas del gateway (1 y 0 antes y después) |
| Intentos registrados | 100 % | **100 %**: 10 `AUTENTICACION_RECHAZADA` + 51 `PETICION_BLOQUEADA` = 61, cada uno con ruta y traceId |
| Origen bloqueado | < 1 min | **27 s** después del primer intento (al décimo fallo), por 15 min |

- `paso-1`: métricas de las dos réplicas del gateway antes del ataque.
- `paso-2`/`paso-3`: el ataque desde Fargate y el resumen de k6 con los umbrales cumplidos.
- `paso-4`: métricas después: rechazos, un bloqueo, 51 peticiones bloqueadas y
  las peticiones reenviadas a feed sin cambios. Los rechazos por
  `TOKEN_VENCIDO` son de otros orígenes (sesiones vencidas de navegadores), no del atacante.
- `paso-5`: CloudWatch Logs Insights: los 61 intentos del atacante registrados por tipo.
- `paso-6`: línea de tiempo: 10 rechazos, el bloqueo y las peticiones cortadas con 429.
- `paso-7`: feed no registró nada de la ruta atacada.

El bloqueo vive en Redis, así que vale para las dos réplicas del gateway (cada
una atendió la mitad de las peticiones bloqueadas: 25 y 26).

Hallazgo: las peticiones que llegaban con el origen ya bloqueado se cortaban
con 429 pero no quedaban en el log. Se agregó el evento `PETICION_BLOQUEADA`
y la métrica `gateway_peticiones_bloqueadas_total` (artagram-gateway `3254db5`).
