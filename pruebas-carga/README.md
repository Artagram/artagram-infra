# Pruebas de carga de los escenarios de calidad

Scripts de [k6](https://k6.io/) para medir los escenarios 1, 2, 6 y 7. El
mapa completo de escenarios está en
[`docs/ATRIBUTOS_CALIDAD.md`](../docs/ATRIBUTOS_CALIDAD.md).

## Preparación

1. Instalar k6 (Arch: `sudo pacman -S k6`; otros: <https://grafana.com/docs/k6/latest/set-up/install-k6/>).
2. Generar tokens de usuarios de prueba (el ingreso real es solo con Google):

   ```bash
   # Local (llaves de desarrollo)
   node generar-tokens.mjs --cantidad 400 --llave ../secrets-dev/jwt-private.pem > tokens.json
   # AWS: guarda el secret JWT_PRIVATE_KEY_PEM en un archivo temporal y bórralo al terminar
   node generar-tokens.mjs --cantidad 400 --llave /ruta/jwt-private.pem > tokens.json
   ```

   Cada corrida crea usuarios nuevos. `tokens.json` contiene credenciales
   válidas: no lo subas (está en `.gitignore`).
3. `BASE_URL` es el ALB (`http://artagram-alb-1008759631.us-east-1.elb.amazonaws.com`)
   o `http://localhost:8080` en local. Con `GATEWAY_JWT_ENABLED=true`.
4. Abrir Grafana en el tablero técnico para ver la prueba en vivo.

## Escenarios

| Script | Escenario | Qué exige (umbral de k6) |
|---|---|---|
| `escenario1-trazos.js` | 400 usuarios, 50 salas de 8, 30 eventos/s | `trazo_e2e_ms` p95 < 200 ms, errores < 1 %; al final imprime enviados, recibidos y perdidos |
| `escenario2-feed.js` | 500 usuarios cargando el feed | ≥ 99 % de peticiones atendidas, p95 < 1 s |
| `escenario6-token-invalido.js` | 20 peticiones/min con tokens inválidos | 100 % rechazadas en el gateway (401/429) y al menos un bloqueo |
| `escenario7-banner.js` | 1 atacante a 1000 eventos/s + 30 artistas | p95 de los artistas < 200 ms |

```bash
k6 run -e BASE_URL=$ALB -e TOKENS=tokens.json escenario1-trazos.js
k6 run -e BASE_URL=$ALB -e TOKENS=tokens.json -e SALAS=10 escenario1-trazos.js   # versión reducida
k6 run -e BASE_URL=$ALB -e TOKENS=tokens.json escenario2-feed.js
k6 run -e BASE_URL=$ALB -e TOKEN_VALIDO=$(node -e "console.log(require('./tokens.json')[0])") escenario6-token-invalido.js
k6 run -e BASE_URL=$ALB -e TOKENS=tokens.json escenario7-banner.js
```

### Escenario 2: tirar una réplica a mitad de prueba

Con `artagram-feed` en 2 tareas, unos 90 s después de empezar:

```bash
TAREA=$(aws ecs list-tasks --cluster artagram-cluster --service-name artagram-feed --query 'taskArns[0]' --output text)
date +%T; aws ecs stop-task --cluster artagram-cluster --task "$TAREA" --reason "prueba escenario 2"
```

El tiempo de retiro se ve en `aws servicediscovery list-instances` (la IP sale
de Cloud Map) y en el panel "Réplicas que responden". Para simular una réplica
que **no responde** sin morir (la parte del health check), en local basta
`docker pause artagram-feed`.

### Escenario 6: comprobar que nada llega a los microservicios

Durante la prueba, en CloudWatch Logs Insights sobre `/ecs/artagram-feed` no
debe aparecer ninguna petición a `/api/feed/siguiendo` con esos orígenes; en
`/ecs/artagram-gateway` aparecen los `AUTENTICACION_RECHAZADA` y el
`ORIGEN_BLOQUEADO`.
