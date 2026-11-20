#!/usr/bin/env bash
# Corre una prueba de carga de pruebas-carga/ desde una tarea de Fargate en la
# misma región que Artagram: sin la latencia de internet ni el límite de
# bajada del equipo propio (el escenario 1 completo recibe unos 84 000
# mensajes/s, cerca de 475 Mbit/s).
#
#   scripts/k6-en-ecs.sh <script.js> <llave.pem> [VAR=valor ...]
#   scripts/k6-en-ecs.sh escenario1-trazos.js ~/jwt-prod.pem SALAS=10
#
# - Los .js de pruebas-carga/ viajan comprimidos en la task definition
#   (artagram-k6); la llave privada va solo en los overrides de esta corrida,
#   no queda en la task definition.
# - La tarea sale con el código de k6: 0 si se cumplieron los umbrales, 99 si
#   no. El resumen completo queda en CloudWatch Logs, grupo $LOG_GROUP.
set -euo pipefail

SCRIPT=${1:?Uso: $0 <script.js> <llave.pem> [VAR=valor ...]}
LLAVE=${2:?Falta la llave privada (PEM)}
shift 2

AWS_REGION=${AWS_REGION:-us-east-1}
export AWS_REGION
CLUSTER=${CLUSTER:-artagram-cluster}
FAMILIA=artagram-k6
IMAGEN=${IMAGEN:-grafana/k6:2.4.0}
CPU=${CPU:-4096}
MEMORIA=${MEMORIA:-8192}
# El rol de ejecución no puede crear grupos de logs: se usa uno existente,
# con streams que empiezan por "k6/".
LOG_GROUP=${LOG_GROUP:-/ecs/artagram-gateway}
BASE_URL=${BASE_URL:-http://artagram-alb-1008759631.us-east-1.elb.amazonaws.com}
SERVICIO_RED=${SERVICIO_RED:-artagram-gateway}

DIR=$(cd "$(dirname "$0")/../pruebas-carga" && pwd)
[ -f "$DIR/$SCRIPT" ] || { echo "No existe $DIR/$SCRIPT" >&2; exit 1; }

CUENTA=$(aws sts get-caller-identity --query Account --output text)
PAQUETE=$(cd "$DIR" && tar -czf - ./*.js lib | base64 -w0)

# Variables de k6 (-e) que se pasan después de la llave.
VARS=$(printf '%s\n' "BASE_URL=$BASE_URL" "$@" | python3 -c '
import json, sys
print(json.dumps([{"name": "K6_VAR_" + l.split("=", 1)[0], "value": l.split("=", 1)[1]}
                  for l in sys.stdin.read().splitlines() if "=" in l]))')

ENTRADA='mkdir -p /tmp/p && cd /tmp/p && echo "$PAQUETE" | base64 -d | tar -xzf - \
  && ARGS="" && for v in $(env | grep "^K6_VAR_" | cut -d= -f1); do ARGS="$ARGS -e ${v#K6_VAR_}=$(printenv $v)"; done \
  && exec k6 run --no-color $ARGS -e LLAVE_PEM="$LLAVE_PEM" "$ESCENARIO"'

python3 - "$FAMILIA" "$IMAGEN" "$CPU" "$MEMORIA" "$CUENTA" "$LOG_GROUP" "$AWS_REGION" "$PAQUETE" "$ENTRADA" > /tmp/k6-taskdef.$$ <<'PY'
import json, sys
familia, imagen, cpu, memoria, cuenta, grupo, region, paquete, entrada = sys.argv[1:]
print(json.dumps({
    "family": familia,
    "networkMode": "awsvpc",
    "requiresCompatibilities": ["FARGATE"],
    "cpu": cpu,
    "memory": memoria,
    "executionRoleArn": f"arn:aws:iam::{cuenta}:role/artagramEcsTaskExecutionRole",
    "containerDefinitions": [{
        "name": "k6",
        "image": imagen,
        "essential": True,
        "entryPoint": ["sh", "-c"],
        "command": [entrada],
        "environment": [{"name": "PAQUETE", "value": paquete}],
        "ulimits": [{"name": "nofile", "softLimit": 65536, "hardLimit": 65536}],
        "logConfiguration": {"logDriver": "awslogs", "options": {
            "awslogs-group": grupo, "awslogs-region": region,
            "awslogs-stream-prefix": "k6"}},
    }],
}))
PY
TD=$(aws ecs register-task-definition --cli-input-json "file:///tmp/k6-taskdef.$$" \
  --query 'taskDefinition.taskDefinitionArn' --output text)
rm -f /tmp/k6-taskdef.$$
echo "Task definition: ${TD##*/}"

RED=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICIO_RED" \
  --query 'services[0].networkConfiguration' --output json)
OVERRIDES=$(python3 - "$LLAVE" "$SCRIPT" "$VARS" <<'PY'
import json, sys
llave, script, variables = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
print(json.dumps({"containerOverrides": [{"name": "k6", "environment":
    [{"name": "LLAVE_PEM", "value": open(llave).read()}, {"name": "ESCENARIO", "value": script}] + variables}]}))
PY
)

TAREA=$(aws ecs run-task --cluster "$CLUSTER" --task-definition "$TD" --launch-type FARGATE \
  --network-configuration "$RED" --overrides "$OVERRIDES" --started-by k6-en-ecs \
  --query 'tasks[0].taskArn' --output text)
echo "Tarea: ${TAREA##*/} ($(date +%T)). Logs: $LOG_GROUP, stream k6/k6/${TAREA##*/}"

aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TAREA" 2>/dev/null \
  || aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TAREA"
read -r CODIGO RAZON <<<"$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TAREA" \
  --query 'tasks[0].[containers[0].exitCode,stoppedReason]' --output text)"
echo "Terminó $(date +%T): código de salida $CODIGO ($RAZON)"
case "$CODIGO" in
  0) echo "Umbrales cumplidos." ;;
  99) echo "Umbrales NO cumplidos: ver el resumen en los logs." ;;
  *) echo "La prueba no terminó bien: ver los logs." ;;
esac
exit "${CODIGO/None/1}"
