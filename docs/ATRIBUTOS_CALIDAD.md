# Atributos de calidad: cómo se cumple cada escenario

Resume, para cada escenario del documento *Atributos de Calidad – Artagram*,
qué lo implementa, dónde está y cómo se demuestra. Las pruebas de carga están
en [`pruebas-carga/`](../pruebas-carga/README.md) y el tablero en Grafana
(`http://<alb>/grafana/`, tablero **Artagram - Tablero técnico**).

| # | Escenario | Mecanismo | Evidencia |
|---|---|---|---|
| 1 | Latencia de trazos con concurrencia | `RealtimeBroadcaster` (canvas) difunde por un tópico de Redis a todas las réplicas; cada entrega mide `trazo_propagacion_seconds{canal}` | `pruebas-carga/escenario1-trazos.js` (p95 de punta a punta y trazos perdidos) + panel "p95 de propagación" |
| 2 | Caída de una réplica del feed | Health check de contenedor en ECS (`/actuator/health/liveness` cada 10 s, 2 fallos) que saca la tarea de Cloud Map; el gateway usa TTL DNS de 5 s, rota conexiones y reintenta GET ante 502/503/504 | `pruebas-carga/escenario2-feed.js` deteniendo una tarea a mitad de prueba + panel "Réplicas que responden" |
| 3 | Caída del worker de IA | Cola `ai.analyze` durable, 3 intentos con espera exponencial y luego `ai.analyze.dlq`; feed guarda el análisis como `PENDIENTE` y el frontend muestra "procesando" | Detener `artagram-ai-worker`, pedir análisis, encenderlo: se procesan los pendientes |
| 4 | Reconexión en el lienzo | `stompClient.ts`: reintento cada 1 s con el token vigente, re-suscripción, cola de trazos terminados sin conexión y nueva carga del estado desde el servidor al reconectar (lienzo, banner y fiesta) | Prueba `stompClient.test.ts`; en vivo: modo avión unos segundos mientras se dibuja |
| 5 | Credencial de Google falsificada | `GoogleTokenVerifier` (auth): firma con las llaves de Google, emisor, audiencia, vigencia y correo verificado; 401 sin emitir token y log `Ingreso con Google rechazado: motivo=…` | `GoogleTokenVerifierTest`; `POST /api/auth/google` con un token alterado |
| 6 | Token de acceso inválido | Gateway: valida RS256 contra el JWKS de auth (también en `/ws`), responde `401 NO_AUTENTICADO` sin reenviar, registra `AUTENTICACION_RECHAZADA` con origen y motivo, y tras 10 fallos en 1 min bloquea el origen 15 min (contador en Redis, compartido entre réplicas) | `pruebas-carga/escenario6-token-invalido.js` + `BloqueoOrigenesTest` + panel "Peticiones rechazadas" |
| 7 | DoS sobre el banner | `BannerRateLimiter`: 100 eventos/s por usuario y comunidad con Redisson (contador en Redis); `banner_eventos_descartados_total` y log con usuario y comunidad | `pruebas-carga/escenario7-banner.js` + alerta `AbusoEnBanner` |
| 8 | Análisis estático continuo | SonarQube Cloud + JaCoCo en `deploy-service.yml`; `mvn verify` exige 90 % de líneas en backend; el frontend exige 50 % | Checks del PR en GitHub |
| 9 | Cambio de proveedor de IA | Interfaz `ProveedorIa` en ai-worker; el adaptador activo se elige con `IA_PROVEEDOR` (`groq` o `fake`). Uno nuevo es una clase más con su `@ConditionalOnProperty` | `SeleccionProveedorIaTest` |
| 10 | Latencia alta en el lienzo | Prometheus (scrape 10 s) + regla `LatenciaTrazosAlta` (p95 > 200 ms por 20 s) visible en Grafana; logs JSON con `traceId` en todos los servicios, propagado por HTTP (`X-Trace-Id`), STOMP (cabecera `traceId`) y RabbitMQ (cabecera `X-Trace-Id`) | Panel "Alertas activas"; consulta de CloudWatch abajo |

## Seguir un trazo lento (escenario 10)

1. La alerta `LatenciaTrazosAlta` aparece en Grafana (Alerting y panel
   "Alertas activas").
2. En CloudWatch Logs Insights, grupo `/ecs/artagram-canvas`:

   ```
   fields @timestamp, mensaje, traceId
   | filter mensaje like /Entrega de tiempo real lenta/
   | sort @timestamp desc
   | limit 20
   ```

3. Con un `traceId`, buscar en todos los grupos `/ecs/artagram-*`:

   ```
   fields @timestamp, servicio, nivel, mensaje
   | filter traceId = "<traceId>"
   | sort @timestamp asc
   ```

## Operación durante las pruebas

Los escenarios 1, 2 y 7 piden **dos o más réplicas**. Fuera de las pruebas
todo corre con 1 para ahorrar crédito. Antes de probar:

```bash
for s in artagram-gateway artagram-feed artagram-canvas; do
  aws ecs update-service --cluster artagram-cluster --service $s --desired-count 2
done
```

Y al terminar se vuelve a 1 (o a 0 si se apaga todo).

## Límites conocidos

- **Escenario 1 en Modo Fiesta**: la prueba usa lienzos de comunidad de 8
  personas en vez de salas de fiesta, porque una sala exige rondas y turnos de
  herramientas. Los dos modos difunden por el mismo `RealtimeBroadcaster`.
- **Capacidad del escenario 1**: 400 usuarios × 30 eventos/s son 12 000
  mensajes/s de entrada y unos 84 000/s de salida. Con tareas de canvas de
  0,5 vCPU es probable que no alcance; para la prueba completa conviene subir
  canvas a 1 vCPU y 3 réplicas, o empezar con `SALAS=10` y crecer viendo el
  tablero.
- **IP real detrás de CloudFront**: el gateway confía en 2 proxies
  (`GATEWAY_PROXIES_CONFIABLES=2`). Quien llame directo al DNS del ALB puede
  falsear su IP en `X-Forwarded-For` y esquivar el bloqueo; se cierra
  restringiendo el security group del ALB a la lista de prefijos de
  CloudFront (`com.amazonaws.global.cloudfront.origin-facing`).
- **`/actuator/prometheus` del gateway** es público a través del ALB. No expone
  datos de usuarios, pero conviene bloquearlo en CloudFront/ALB.
