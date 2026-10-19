# ArtaGram — Infraestructura, Contratos y Plan de Migración (`artagram-infra`)

Repositorio central de infraestructura local (Docker Compose), definición de contratos entre microservicios, topología de RabbitMQ, inicialización de bases de datos y documentación de arquitectura para la migración del monolito `ARTAGRAM-backv1`.

---

## Estructura del Repositorio

```text
artagram-infra/
  compose.yml                    Infraestructura base (Postgres 16, Redis 7, Mongo 7, RabbitMQ 3, MinIO)
  compose.services.yml           Orquestación de los 8 servicios Java (Gateway, Auth, Users, Feed, Lienzo, Chat, Media, IA)
  .env.example                   Variables de entorno locales con valores por defecto
  postgres/
    init-multiple-dbs.sql        Crea db_auth, db_usuarios, db_feed y db_lienzo además de artagram
  rabbitmq/
    definitions.json             Exchange artagram.events (topic), artgram.dlx, colas por servicio y DLQs
  scripts/
    GenerarLlavesRsa.java        Generador 100% Java 21 del par de llaves RSA (2048 bits) en secrets-dev/
  docs/
    artagram_arquitectura(3).drawio  Diagrama oficial de arquitectura objetivo
    PLAN_MIGRACION_ARTAGRAM.md       Plan maestro de migración por fases replanteado sobre el monolito real
    contracts.md                     Contratos de puertos, rutas del Gateway, JWT RS256, eventos AMQP y 12 UUIDs demo
    IA-ACTUAL.md                     Auditoría técnica del módulo de IA multimodal (Groq / Fake) del monolito
    DECISIONES.md                    Registro de decisiones arquitectónicas tomadas
```

---

## Uso Rápido en Local

1. **Generar el par de llaves RSA de desarrollo (`secrets-dev/`):**
   ```powershell
   java scripts/GenerarLlavesRsa.java
   ```

2. **Levantar las 5 piezas de infraestructura (PostgreSQL, Redis, MongoDB, RabbitMQ, MinIO):**
   ```powershell
   docker compose -f compose.yml up -d
   ```

3. **Levantar la pila completa de microservicios:**
   ```powershell
   docker compose -f compose.yml -f compose.services.yml up -d --build
   ```

---

## Puertos Expuestos en Local

| Servicio | Puerto | Consola / URL |
|---|---|---|
| API Gateway (`artagram-gateway`) | `8080` | `http://localhost:8080` |
| Autenticación (`artagram-auth`) | `8081` | `http://localhost:8081/.well-known/jwks.json` |
| Usuarios y Suscripción (`artagram-users`) | `8082` | `http://localhost:8082/swagger-ui.html` |
| Feed (`artagram-feed`) | `8083` | `http://localhost:8083/swagger-ui.html` |
| Lienzo en Vivo (`artagram-lienzo` / `backv1`) | `8084` | `http://localhost:8084/swagger-ui.html` |
| Chat y Notificaciones (`artagram-chat`) | `8085` | `http://localhost:8085/swagger-ui.html` |
| Media Worker (`artagram-media-worker`) | `8086` | `http://localhost:8086/actuator/health` |
| AI Worker (`artagram-ai-worker`) | `8087` | `http://localhost:8087/actuator/health` |
| PostgreSQL 16 | `5432` | `jdbc:postgresql://localhost:5432/{db_auth\|db_usuarios\|db_feed\|db_lienzo}` |
| Redis 7 | `6379` | `redis://localhost:6379` (`db 0`: Lienzo, `db 1`: Feed/Gateway) |
| MongoDB 7 | `27017` | `mongodb://artagram:artagram@localhost:27017/{db_chat\|db_ia}?authSource=admin` |
| RabbitMQ 3 | `5672` / `15672` | UI: `http://localhost:15672` (`artagram` / `artagram`) |
| MinIO (S3 Local) | `9000` / `9001` | UI: `http://localhost:9001` (`artagram` / `artagram123`) |
