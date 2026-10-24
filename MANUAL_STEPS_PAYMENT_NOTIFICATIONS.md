# Pasos manuales únicos: `artagram-payment` + `artagram-notifications`

Los volúmenes de `postgres_data` y `rabbitmq_data` ya existen y son
persistentes, así que los scripts de inicialización (`init-multiple-dbs.sql`,
`definitions.json`) **no se re-ejecutan solos** en el stack que ya corría
antes de estos cambios. Hay que correr estos pasos una sola vez, en orden,
cuando Docker vuelva a estar disponible.

## 1. Crear `db_payment` en el Postgres ya corriendo

```bash
cd /home/tomas/Documents/Arsw/Artagram/artagram-infra
docker compose -f compose.yml -f compose.services.yml exec postgres \
  psql -U artagram -d artagram -c "CREATE DATABASE db_payment OWNER artagram;"
docker compose -f compose.yml -f compose.services.yml exec postgres \
  psql -U artagram -d artagram -c "GRANT ALL PRIVILEGES ON DATABASE db_payment TO artagram; GRANT ALL PRIVILEGES ON DATABASE db_payment TO artagram_app;"
```

`artagram-notifications` usa MongoDB (`db_notificaciones`), que Mongo crea
solo en la primera escritura — no necesita ningún paso manual.

## 2. Recrear RabbitMQ para que cargue el vhost/shovel nuevos

`enabled_plugins` y los cambios de `definitions.json` (vhost `notifications`,
exchange espejo, colas, shovel) solo se aplican si el contenedor arranca de
cero con esos archivos montados — un simple `restart` no alcanza porque
`load_definitions` corre en el boot del nodo:

```bash
docker compose -f compose.yml up -d --force-recreate rabbitmq
```

Luego, otorgar al usuario `artagram` (el de `RABBITMQ_DEFAULT_USER`, que
a propósito NO se redeclaró en `definitions.json` para no chocar con su
hash real) permiso de escritura en el vhost `notifications` — esto es lo
que le permite al shovel entregar ahí:

```bash
docker exec artagram-rabbitmq rabbitmqctl set_permissions -p notifications artagram ".*" ".*" ".*"
```

Verificar que todo quedó bien:

```bash
docker exec artagram-rabbitmq rabbitmqctl list_vhosts
docker exec artagram-rabbitmq rabbitmqctl list_shovels
docker exec artagram-rabbitmq rabbitmqctl list_queues -p notifications name messages
docker exec artagram-rabbitmq rabbitmqctl list_users
```

## 3. Levantar los dos servicios nuevos y el gateway

```bash
docker compose -f compose.yml -f compose.services.yml up -d --build \
  artagram-payment artagram-notifications artagram-gateway
```

## 4. Smoke test

```bash
# Salud de cada servicio
curl -s http://localhost:8089/actuator/health
curl -s http://localhost:8090/actuator/health

# Flujo de pagos (requiere un JWT válido, igual que con los demás servicios)
curl -s -X POST http://localhost:8089/api/suscripcion/checkout \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"plan":"PRO"}'
curl -s -X POST "http://localhost:8089/api/suscripcion/confirmar?tx=sim_manual" \
  -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:8089/api/suscripcion/actual -H "Authorization: Bearer $TOKEN"

# Notificaciones
curl -s http://localhost:8090/api/notificaciones -H "Authorization: Bearer $TOKEN"
curl -N http://localhost:8090/api/notificaciones/stream -H "Authorization: Bearer $TOKEN"

# A través del gateway (una vez wireado)
curl -s http://localhost:8080/api/suscripcion/actual -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:8080/api/notificaciones -H "Authorization: Bearer $TOKEN"

# Confirmar que el puente de eventos funciona: registrar un usuario real vía
# artagram-auth y verificar que las colas payment.user.registered /
# notifications.* (vhost notifications) reciben mensajes:
docker exec artagram-rabbitmq rabbitmqctl list_queues name messages
docker exec artagram-rabbitmq rabbitmqctl list_queues -p notifications name messages
```

Si `rabbitmqctl list_shovels` muestra el shovel en estado distinto de
`running`, revisar `docker logs artagram-rabbitmq` — el error más probable
es credenciales (`artagram:artagram` hardcodeadas en el shovel dentro de
`definitions.json` deben coincidir con `RABBITMQ_DEFAULT_USER`/`PASS`
reales del `.env`; si se cambiaron, hay que actualizar el shovel también).
