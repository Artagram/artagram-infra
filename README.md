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

## Flujo de trabajo (ramas y política de merge)

Cada push a `main` despliega a producción, así que **nadie trabaja
directamente sobre `main`**. Esto aplica a los 12 repositorios de la
organización `Artagram`.

### Ramas
| Tipo | Nombre | Ejemplo |
|---|---|---|
| Funcionalidad | `feature/<funcionalidad>` | `feature/login-google` |
| Corrección | `fix/<descripcion>` | `fix/cors-notificaciones` |

- Las ramas siempre salen de un `main` actualizado:
  `git switch main && git pull && git switch -c feature/<funcionalidad>`.
- Si una funcionalidad toca varios repositorios (por ejemplo `auth` y el
  frontend), se usa **el mismo nombre de rama en todos** y se abre un PR en
  cada uno.

### Pull requests
1. `git push -u origin feature/<funcionalidad>` y abrir un PR hacia `main`.
2. El PR ejecuta solo build y tests, sin desplegar:
   - microservicios: job **`ci-cd / build-test`** (`mvn verify`, con JaCoCo
     y SpotBugs);
   - frontend: job **`Pruebas y Linting`** (lint, Vitest y build).
3. Se necesita **1 aprobación** de otro integrante.
4. Merge con **squash**: un commit por funcionalidad en `main`. El merge
   dispara el deploy del servicio afectado; dos merges seguidos del mismo
   servicio se despliegan uno detrás del otro (`concurrency` en
   `deploy-service.yml`).
5. La rama se borra automáticamente después del merge.

### Rulesets de la organización (configuración en GitHub)
Se configuran **una sola vez** en *Organization settings → Repository →
Rulesets → New branch ruleset*. Son varios rulesets, porque cada tipo de
repositorio reporta un check distinto. Si un ruleset exige un check que el
repositorio nunca ejecuta, sus PR quedan bloqueados para siempre.
Son tres en total: servicios, frontend e infra.

**Reglas comunes a los tres:**

| Campo | Valor |
|---|---|
| Enforcement status | `Active` |
| Target branches | `Include default branch` |
| Restrict deletions | ✅ |
| Block force pushes | ✅ |
| Require a pull request before merging | ✅, 1 aprobación, *Dismiss stale pull request approvals when new commits are pushed* |
| Allowed merge methods | Solo `Squash` |
| Bypass list | Vacía (ni los administradores se saltan la regla) |

**Lo que cambia entre ellos:**

| Ruleset | Target repositories | Require status checks to pass |
|---|---|---|
| `proteger-main-servicios` | Por nombre: los 10 `artagram-*` de microservicios | ✅ `ci-cd / build-test`, con *Require branches to be up to date* |
| `proteger-main-frontend` | Por nombre: `ARTAGRAM-frontv1` | ✅ `Pruebas y Linting`, con *Require branches to be up to date* |
| `proteger-main-infra` | Por nombre: `artagram-infra` | Sin checks (no tiene build propio en PR); solo PR + aprobación |

Además, en cada repositorio: *Settings → General → Pull Requests →
Automatically delete head branches*.

> **Plan de GitHub:** los rulesets en repositorios **privados** requieren el
> plan **GitHub Team** en la organización. Con el plan Free solo se aplican
> a repositorios públicos.

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
