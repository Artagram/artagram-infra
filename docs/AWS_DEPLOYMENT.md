# Plan de Despliegue en AWS + CI/CD

Plan decidido (no un documento especulativo): los 10 microservicios corren en
**ECS Fargate** con autoscaling independiente por servicio, la capa de datos
vive en servicios administrados de AWS, y **GitHub Actions** es el único
mecanismo de CI/CD — construye las imágenes, las sube a ECR, y actualiza los
servicios de ECS. No cambia el código de ningún servicio: todos ya
externalizan su configuración vía variables de entorno, que es exactamente lo
que necesita una `task definition` de Fargate.

`ARTAGRAM-backv1` **no entra en este despliegue**. El gateway ya no le enruta
ningún tráfico real (confirmado: cero referencias a `LIENZO_SERVICE_URL` en
`artagram-gateway/application.yml`), así que no hace falta correrlo en AWS en
absoluto.

Cada microservicio tiene además su propia sección `## Diseño y Arquitectura`
→ `### Preparación para AWS` en su `README.md`, con detalles específicos de
ese servicio. Este documento cubre lo transversal.

---

## 1. Por qué ECS Fargate para los 10, y no un híbrido

Se evaluó dejar los servicios de carga más predecible (auth, users, feed,
chat, payment, notifications) en una EC2 compartida y solo los de carga
bursty/asíncrona (gateway, canvas, media-worker, ai-worker) en Fargate.
Se descartó: la complejidad de aprender ECS se paga igual (4 de 10 ya la
necesitan), y el híbrido obliga a mantener **dos mecanismos de deploy
distintos** en GitHub Actions (uno por SSH+docker-compose, otro por la API de
ECS) en vez de uno solo, uniforme, para los 10. El costo extra de Fargate en
reposo (tareas de baja carga) es aceptable frente a esa duplicación
operativa.

Dos decisiones de diseño que **ya existen en el código** hacen que escalar
horizontalmente (más de una tarea por servicio) sea seguro desde el día uno,
sin sticky sessions:

- **`RealtimeBroadcaster`** (en `artagram-canvas`): cada tarea tiene su propio
  `SimpleBroker` en memoria (solo entrega a sus propias conexiones
  WebSocket), pero publica cada mensaje en un topic de Redis Pub/Sub y TODAS
  las tareas lo reciben y lo entregan localmente. Una tarea nueva que arranca
  por autoscaling queda sincronizada de inmediato.
- **JWT RS256 sin estado de sesión en servidor**: cualquier tarea de
  cualquier servicio valida cualquier token con solo la llave pública — no
  hay sesión pegajosa que mantener.

---

## 2. Mapeo de infraestructura local → AWS

| Pieza local (Docker Compose) | Equivalente en AWS | Notas |
|---|---|---|
| PostgreSQL 16 (`db_auth`, `db_usuarios`, `db_feed`, `db_payment`, `db_lienzo`) | **RDS for PostgreSQL** (1 instancia, 5 bases) | `db_lienzo` **sí se migra** — es la base de `artagram-canvas` (el microservicio real), no de `ARTAGRAM-backv1`; el nombre es heredado pero el dueño actual es canvas. |
| Redis 7 (bases lógicas 0 y 1) | **ElastiCache for Redis** | 1 nodo para empezar; réplica para HA cuando el tráfico lo justifique. |
| MongoDB 7 (`db_chat`, `db_ia`, `db_notificaciones`) | **Amazon DocumentDB** (o MongoDB Atlas) | DocumentDB si se quiere todo dentro de la cuenta de AWS. |
| RabbitMQ 3 (`artagram.events`, vhosts `/` y `notifications`, shovel) | **Amazon MQ for RabbitMQ** | ⚠️ **Pendiente de verificar**: no hay confirmación de que el plugin `rabbitmq_shovel` esté disponible en el motor administrado de Amazon MQ. Si no lo soporta, el plan B es correr RabbitMQ en un contenedor propio dentro de ECS (perdiendo "administrado" solo para ese componente) — **verificar antes de migrar `artagram-notifications`**, no asumir que funciona. |
| MinIO (S3 local) | **Amazon S3** | Ya es compatible: AWS SDK v2 con `S3_ENDPOINT` parametrizado — en AWS real simplemente no se setea esa variable. |
| Contenedores Docker Compose | **ECS Fargate** | 10 servicios, 10 Task Definitions, 10 ECS Services, cada uno con su propia política de autoscaling. |
| Nombres de contenedor Docker (`http://artagram-auth:8084`) | **AWS Cloud Map** (Service Discovery) | `gateway` resuelve a los otros 9 por DNS privado (`auth.artagram.local`, etc.) en vez de nombres de red de Docker. |
| Puerto único de entrada (`artagram-gateway:8080`) | **Application Load Balancer** + **Route53** + **ACM** | Único Target Group — es el único servicio que recibe tráfico público directo. Soporta WebSocket nativo, así que `/ws` no necesita nada especial más allá de un healthcheck en `/actuator/health`. |
| Imágenes Docker locales | **Amazon ECR** | Un repositorio por servicio. |
| Secrets (`secrets-dev/jwt-*.pem`, passwords en `.env`) | **GitHub Secrets/Environments** (decisión explícita, ver sección 5) | No se usa AWS Secrets Manager. |

---

## 3. Inventario completo de recursos AWS

### Red y seguridad
| Recurso | Cantidad |
|---|---|
| VPC | 1 (la VPC default alcanza para empezar) |
| Security Groups | 6 — ALB (80/443 público), tareas Fargate, RDS, ElastiCache, DocumentDB, Amazon MQ (cada uno de estos 4 últimos solo acepta tráfico del SG de Fargate) |
| Cloud Map namespace | 1 |

### Capa de datos
| Recurso | Cantidad |
|---|---|
| RDS PostgreSQL | 1 instancia (`db_auth`, `db_usuarios`, `db_feed`, `db_payment`, `db_lienzo`) |
| DB Subnet Group (RDS) | 1 |
| ElastiCache Redis | 1 nodo |
| Cache Subnet Group | 1 |
| DocumentDB | 1 cluster (`db_chat`, `db_ia`, `db_notificaciones`) |
| DB Subnet Group (DocumentDB) | 1 |
| Amazon MQ | 1 broker (vhosts `/` y `notifications`) |
| S3 bucket | 1 (`artagram-uploads`) |

### Contenedores (ECS Fargate)
| Recurso | Cantidad |
|---|---|
| ECR (repositorio de imágenes) | 10 |
| ECS Cluster | 1 |
| Task Definitions | 10 |
| ECS Services | 10 |
| Application Auto Scaling (target tracking) | 10 — 8 por CPU/memoria, 2 (`media-worker`, `ai-worker`) por profundidad de cola en Amazon MQ |

### Balanceo de carga
| Recurso | Cantidad |
|---|---|
| Application Load Balancer | 1 |
| Target Group | 1 (solo `gateway`) |

### IAM
| Recurso | Cantidad |
|---|---|
| ECS Task Execution Role | 1 (compartido) |
| ECS Task Role | 1 (permiso sobre el bucket S3) |
| IAM User + Access Key para GitHub Actions | 1 (empezar simple; migrar a OIDC sin llaves de larga duración cuando el flujo esté probado) |

### Observabilidad
| Recurso | Cantidad |
|---|---|
| CloudWatch Log Groups | 10 (uno por servicio) |

**Orden de creación recomendado:** red/seguridad → capa de datos → ECR →
IAM → ECS Cluster/Task Definitions/Services → ALB → autoscaling →
observabilidad. Cada pieza se puede probar antes de avanzar a la siguiente.

---

## 4. CI/CD con GitHub Actions — YA IMPLEMENTADO

Cada uno de los 10 microservicios es su propio repositorio, así que el
pipeline usa un **reusable workflow** centralizado (en `artagram-infra`) para
no duplicar la misma lógica 10 veces. **Esta sección ya no es un plan: los
archivos existen en disco** (pendiente solo de `git push`, y de que existan
los recursos de AWS/secrets de la sección 9 para que el paso de deploy
funcione — build+test corren igual sin eso).

### 4.1 Workflow reusable (`artagram-infra/.github/workflows/deploy-service.yml`)
Recibe como input `service-name` y `container-port`. Pasos:
1. Checkout del repo que lo llamó (no de `artagram-infra`).
2. `mvn verify` (build + tests) — corre en PR y en push a `main`.
3. Solo en push a `main`: checkout adicional de `artagram-infra` (para leer
   la plantilla de task definition), login en ECR, build de la imagen
   Docker (usa el `Dockerfile` ya existente en cada repo, sin cambios),
   push con tag = SHA del commit + `latest`.
4. `envsubst` sobre `artagram-infra/ecs/task-definitions/<servicio>.json`
   con las variables/secretos de GitHub (sección 9) → task definition
   renderizada.
5. `aws-actions/amazon-ecs-deploy-task-definition` — registra la nueva
   revisión y actualiza el `ecs service`, esperando a que estabilice.

### 4.2 Las 10 task definitions (`artagram-infra/ecs/task-definitions/*.json`)
Un JSON por servicio, generado a partir del inventario de la sección 3
(CPU/memoria por servicio, puerto, variables de entorno). Los servicios se
resuelven entre sí por **AWS Cloud Map**, namespace `artagram.local`
(ej.: el gateway llama a `http://auth.artagram.local:8081`) — exactamente
el mismo rol que hoy cumplen los nombres de contenedor de Docker Compose.

### 4.3 Workflow en cada repo de servicio (`.github/workflows/ci-cd.yml`)
Ya creado en los 10 repos. Trivial — solo llama al reusable workflow:
```yaml
on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci-cd:
    uses: Artagram/artagram-infra/.github/workflows/deploy-service.yml@main
    with:
      service-name: artagram-auth
      container-port: 8081
    secrets: inherit
```
`secrets: inherit` es lo que hace que los Organization Secrets de GitHub
(sección 9) lleguen al workflow reusable sin tener que redeclararlos en
cada uno de los 10 repos. En un **pull request** solo corre `build-test`
(sin deploy). En un **push a `main`** corre además `deploy`.

### 4.4 SAST — pospuesto
Los 10 repos son **privados** hoy, así que SonarCloud (gratis solo para
repos públicos) no aplica sin pagar. **Decisión: sin SAST por ahora.** Si
los repos se vuelven públicos más adelante, agregar un job de SonarCloud al
workflow reusable es un cambio de una sola vez (no hay que tocar los 10
repos individualmente).

### 4.5 DAST — OWASP ZAP
Un workflow separado (no por servicio, uno solo, en `artagram-infra`),
disparado después de un deploy exitoso a producción (o manualmente / en un
cron), que corre `zaproxy/action-full-scan` contra la URL pública del
`gateway`. No se integra al pipeline de deploy de cada servicio porque un
scan completo de ZAP toma minutos y no tiene sentido repetirlo en cada push
de cada uno de los 10 repos.

### 4.6 Observabilidad (Grafana/Prometheus)
No es parte del pipeline de CI/CD — es infraestructura que corre en el
ECS Cluster (una tarea Fargate más: Prometheus scrapeando `/actuator/prometheus`
de los 10 servicios vía Cloud Map, Grafana leyendo de Prometheus). Se agrega
como un servicio más al mismo cluster, no requiere pipeline propio salvo el
build de su configuración (`prometheus.yml`, dashboards de Grafana) si se
versiona en `artagram-infra`.

---

## 5. Secrets: decisión explícita — GitHub, no AWS Secrets Manager

El usuario decidió manejar secretos desde GitHub (Secrets/Environments), no
AWS Secrets Manager. Implicación técnica real, no cosmética:

**Las Task Definitions de ECS van a tener los secretos (contraseñas de DB,
llave JWT, `MERCADOPAGO_ACCESS_TOKEN`, etc.) como variables de entorno en
texto plano**, porque el workflow los renderiza directo desde GitHub Secrets
al JSON de la task definition antes de registrarla. Esto es distinto de usar
`secrets` (`valueFrom`) en la task definition apuntando a Secrets Manager/SSM,
que mantiene los valores cifrados y fuera de la vista de cualquiera con
acceso de lectura a ECS en la cuenta.

**Trade-off aceptado:** cualquier persona con permiso `ecs:DescribeTaskDefinition`
en la cuenta de AWS puede ver los secretos en texto plano. Es una decisión
consciente para mantener todo centralizado en GitHub sin pagar/operar
Secrets Manager — revisar si el equipo crece o si se necesita cumplir algún
requisito de auditoría más estricto.

Secretos que viajan así: llave privada RSA de `artagram-auth`, llave pública
RSA (los demás servicios), contraseñas de RDS/DocumentDB/Amazon MQ,
`MP_ACCESS_TOKEN`/`MERCADOPAGO_WEBHOOK_SECRET`, `GROQ_API_KEY`. El acceso a
S3 **no** es un secreto en las task definitions: se otorga vía el IAM Task
Role (sección 3), así el SDK de AWS dentro del contenedor obtiene
credenciales temporales automáticamente — evita tener una access key de S3
más que rotar y es, de las piezas de este plan, la única donde no se tomó
el camino "más simple" porque el camino correcto no cuesta nada extra.

---

## 6. Observabilidad

- **Logs**: ya son JSON estructurado (`logstash-logback-encoder`) — encajan
  directo en **CloudWatch Logs** sin transformación.
- **Métricas**: todos los servicios ya exponen `/actuator/prometheus`.
  Prometheus + Grafana corren como una tarea más del mismo ECS Cluster (ver
  4.6), para conservar el setup actual sin depender de CloudWatch Container
  Insights.
- **Trazas**: el `X-Trace-Id` ya se propaga entre servicios (HTTP) y a los
  headers AMQP — compatible con X-Ray si se decide adoptarlo más adelante.

---

## 7. Autoscaling por servicio

| Servicio | Señal de escalado |
|---|---|
| gateway, auth, users, feed, chat, canvas, payment, notifications | Application Auto Scaling por CPU/memoria, o por `RequestCountPerTarget` del ALB (solo gateway está detrás del ALB; los demás escalan por CPU/memoria directamente) |
| media-worker, ai-worker | Profundidad de cola en Amazon MQ (métrica custom de CloudWatch) — no tienen tráfico HTTP entrante que medir |

---

## 8. Checklist de orden real de trabajo

1. ✅ Código: migración a microservicios completa, backv1 sin tráfico real.
2. ✅ **CI/CD**: workflow reusable + los 10 workflows por repo + las 10 task
   definition templates — ya escritos en disco (ver sección 4). Faltan
   `git push` de los 10 repos y crear los secrets/variables de la sección 9
   para que el job `deploy` tenga algo real a donde desplegar; `build-test`
   ya corre en cuanto se haga push, sin depender de nada de AWS.
3. Verificar soporte de Shovel en Amazon MQ (bloqueante solo para
   `artagram-notifications`, no para el resto) — **pendiente**.
4. Crear los recursos de AWS de la sección 3, en el orden sugerido ahí —
   **pendiente, siguiente paso** (guía paso a paso en la consola).
5. Una vez existan el cluster/servicios de ECS, el primer push a `main` de
   cada repo ya dispara el deploy real (no hay un interruptor aparte que
   "activar" — el workflow ya está completo, solo le falta infraestructura
   real donde apuntar).
6. DAST (ZAP) contra el ambiente ya desplegado — workflow ya escrito
   (`artagram-infra/.github/workflows/dast-zap.yml`), corre manual o los
   lunes; solo necesita el Repository Variable `GATEWAY_PUBLIC_URL`.
7. SAST (Sonar): pendiente, solo si los repos pasan a públicos.

---

## 9. Qué crear en GitHub, exactamente

### 9.1 Organization Secrets (Settings del org `Artagram` → Secrets and
variables → Actions → New organization secret, con acceso a los 10 repos
de servicio)

Un solo juego, compartido por los 10 repos — evita repetir la misma
contraseña de RDS 10 veces:

| Secret | Para qué |
|---|---|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ACCOUNT_ID` | el IAM User del workflow (sección 3) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` | RDS PostgreSQL |
| `REDIS_HOST`, `REDIS_PORT` | ElastiCache |
| `RABBITMQ_HOST`, `RABBITMQ_PORT`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD` | Amazon MQ, vhost `/` |
| `NOTIFICATIONS_RABBITMQ_USER`, `NOTIFICATIONS_RABBITMQ_PASSWORD` | Amazon MQ, vhost `notifications` (usuario separado, ver diseño del shovel) |
| `CHAT_MONGODB_URI`, `AI_MONGODB_URI`, `NOTIFICATIONS_MONGODB_URI` | DocumentDB — connection string completo, con el nombre de base ya incluido en cada uno (`db_chat`, `db_ia`, `db_notificaciones`) |
| `S3_BUCKET`, `S3_PUBLIC_ENDPOINT` | el bucket único `artagram-uploads` |
| `JWT_PUBLIC_KEY_PEM` | solo lectura, todos los servicios validan tokens |
| `JWT_PRIVATE_KEY_PEM` | solo `artagram-auth` la usa, pero vive en el mismo juego compartido — no hace daño que exista para los demás, que nunca la leen |
| `MP_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `PAGO_PROVEEDOR` | `artagram-users`/`artagram-payment` |
| `GROQ_API_KEY` | `artagram-ai-worker` |
| `EMAIL_MODE`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | `artagram-auth`/`artagram-notifications` (`EMAIL_MODE=log` si no se configura SMTP real todavía) |
| `GRAFANA_URL`, `PROMETHEUS_URL` | `artagram-users` (dashboard de KPIs) |

### 9.2 Repository/Organization Variables (no son secretas)

| Variable | Valor |
|---|---|
| `CORS_ORIGINS` | el dominio del frontend en producción |
| `GATEWAY_PUBLIC_URL` | el dominio del ALB/Route53 del gateway (sin `https://`, el workflow lo antepone) |

### 9.3 Qué NO hace falta crear por repo
Nada — con Organization Secrets + `secrets: inherit`, los 10 repos quedan
listos en cuanto el workflow `.github/workflows/ci-cd.yml` (ya presente en
cada uno) se suba con `git push`.
