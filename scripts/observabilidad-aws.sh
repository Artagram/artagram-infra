#!/usr/bin/env bash
# Prepara en AWS, UNA sola vez, lo que necesitan Prometheus, Grafana y los
# escenarios de calidad. Es idempotente: si algo ya existe, lo deja como está.
#
#   AWS_PROFILE=<perfil-admin> ./scripts/observabilidad-aws.sh
#
# Necesita permisos de ECR, CloudWatch Logs, Cloud Map, ELBv2, EC2 (security
# groups), ECS e iam:PassRole sobre los roles de tareas. El usuario IAM de
# GitHub Actions no los tiene todos: córrelo con un perfil administrador.
#
# Qué hace:
#   1. Repos ECR artagram-prometheus y artagram-grafana.
#   2. Grupos de logs de los dos y retención de 14 días en todos /ecs/artagram-*
#      (hoy no vencen nunca y CloudWatch cobra el almacenamiento).
#   3. Registra en Cloud Map gateway, ai-worker y media-worker (Prometheus
#      descubre las réplicas por DNS) y crea prometheus.artagram.local.
#   4. Target group de Grafana y regla /grafana* en el listener HTTP del ALB.
#   5. Permite al ALB llegar al puerto 3000 de las tareas.
#   6. Health check del gateway en el ALB cada 10 s (antes 30 s) y
#      deregistration delay de 30 s (escenario 2).
#   7. Servicios ECS artagram-prometheus y artagram-grafana con 0 tareas.
#      El workflow build-observabilidad.yml publica las imágenes reales.
set -euo pipefail

REGION=us-east-1
CLUSTER=artagram-cluster
NAMESPACE_ID=ns-jpqvitjhcb42ivkp       # artagram.local
SG_TAREAS_NOMBRE=artagram-fargate-sg
SG_ALB_NOMBRE=artagram-alb-sg
ALB_NOMBRE=artagram-alb
TG_GATEWAY=artagram-gateway-tg
export AWS_DEFAULT_REGION=$REGION

paso() { printf '\n==> %s\n' "$*"; }

CUENTA=$(aws sts get-caller-identity --query Account --output text)
SG_TAREAS=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=$SG_TAREAS_NOMBRE" --query 'SecurityGroups[0].GroupId' --output text)
SG_ALB=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=$SG_ALB_NOMBRE" --query 'SecurityGroups[0].GroupId' --output text)
VPC=$(aws ec2 describe-security-groups --group-ids "$SG_TAREAS" --query 'SecurityGroups[0].VpcId' --output text)
# Las mismas subredes que ya usa el gateway.
SUBREDES=$(aws ecs describe-services --cluster $CLUSTER --services artagram-gateway \
  --query 'services[0].networkConfiguration.awsvpcConfiguration.subnets' --output text | tr '\t' ',')
PUBLICA=$(aws ecs describe-services --cluster $CLUSTER --services artagram-gateway \
  --query 'services[0].networkConfiguration.awsvpcConfiguration.assignPublicIp' --output text)
RED="awsvpcConfiguration={subnets=[$SUBREDES],securityGroups=[$SG_TAREAS],assignPublicIp=$PUBLICA}"

paso "1. Repositorios ECR"
for repo in artagram-prometheus artagram-grafana; do
  aws ecr describe-repositories --repository-names "$repo" >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name "$repo" --image-scanning-configuration scanOnPush=true >/dev/null
  echo "   $repo"
done

paso "2. Grupos de logs y retención de 14 días"
for grupo in /ecs/artagram-prometheus /ecs/artagram-grafana; do
  aws logs create-log-group --log-group-name "$grupo" 2>/dev/null || true
done
for grupo in $(aws logs describe-log-groups --log-group-name-prefix /ecs/artagram --query 'logGroups[].logGroupName' --output text); do
  aws logs put-retention-policy --log-group-name "$grupo" --retention-in-days 14
  echo "   $grupo"
done

registro_cloud_map() {  # $1 = nombre DNS; imprime el ARN del servicio de Cloud Map
  local id
  id=$(aws servicediscovery list-services --filters "Name=NAMESPACE_ID,Values=$NAMESPACE_ID,Condition=EQ" \
        --query "Services[?Name=='$1'].Id | [0]" --output text)
  if [ "$id" = "None" ] || [ -z "$id" ]; then
    id=$(aws servicediscovery create-service --name "$1" --namespace-id "$NAMESPACE_ID" \
          --dns-config "RoutingPolicy=MULTIVALUE,DnsRecords=[{Type=A,TTL=10}]" \
          --health-check-custom-config FailureThreshold=1 --query 'Service.Id' --output text)
  fi
  aws servicediscovery get-service --id "$id" --query 'Service.Arn' --output text
}

paso "3. Cloud Map: gateway, ai-worker, media-worker y prometheus"
for svc in gateway ai-worker media-worker; do
  arn=$(registro_cloud_map "$svc")
  actual=$(aws ecs describe-services --cluster $CLUSTER --services "artagram-$svc" --query 'length(services[0].serviceRegistries)' --output text)
  if [ "$actual" = "0" ]; then
    # Cambia la configuración y lanza un despliegue nuevo del servicio.
    aws ecs update-service --cluster $CLUSTER --service "artagram-$svc" \
      --service-registries "registryArn=$arn" >/dev/null
  fi
  echo "   $svc.artagram.local"
done
ARN_PROMETHEUS=$(registro_cloud_map prometheus)
echo "   prometheus.artagram.local"

paso "4. Target group de Grafana y regla /grafana* en el ALB"
TG_GRAFANA=$(aws elbv2 describe-target-groups --names artagram-grafana-tg --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null \
  || aws elbv2 create-target-group --name artagram-grafana-tg --protocol HTTP --port 3000 --vpc-id "$VPC" \
       --target-type ip --health-check-path /grafana/api/health --health-check-interval-seconds 15 \
       --query 'TargetGroups[0].TargetGroupArn' --output text)
ALB_ARN=$(aws elbv2 describe-load-balancers --names $ALB_NOMBRE --query 'LoadBalancers[0].LoadBalancerArn' --output text)
LISTENER=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --query "Listeners[?Port==\`80\`].ListenerArn | [0]" --output text)
if ! aws elbv2 describe-rules --listener-arn "$LISTENER" --query 'Rules[].Conditions[].Values[]' --output text | grep -q '/grafana'; then
  aws elbv2 create-rule --listener-arn "$LISTENER" --priority 10 \
    --conditions 'Field=path-pattern,Values=/grafana,/grafana/*' \
    --actions "Type=forward,TargetGroupArn=$TG_GRAFANA" >/dev/null
fi
echo "   http://$(aws elbv2 describe-load-balancers --names $ALB_NOMBRE --query 'LoadBalancers[0].DNSName' --output text)/grafana/"

paso "5. El ALB puede llegar al puerto 3000 de las tareas"
aws ec2 authorize-security-group-ingress --group-id "$SG_TAREAS" --protocol tcp --port 3000 \
  --source-group "$SG_ALB" >/dev/null 2>&1 || echo "   (la regla ya existía)"

paso "6. Health check del gateway en el ALB cada 10 s"
TG_GW_ARN=$(aws elbv2 describe-target-groups --names $TG_GATEWAY --query 'TargetGroups[0].TargetGroupArn' --output text)
aws elbv2 modify-target-group --target-group-arn "$TG_GW_ARN" --health-check-interval-seconds 10 \
  --healthy-threshold-count 2 --unhealthy-threshold-count 2 >/dev/null
aws elbv2 modify-target-group-attributes --target-group-arn "$TG_GW_ARN" \
  --attributes Key=deregistration_delay.timeout_seconds,Value=30 >/dev/null

paso "7. Servicios ECS de Prometheus y Grafana (0 tareas)"
tarea_inicial() {  # $1 = componente, $2 = imagen pública de arranque
  IMAGE_URI=$2 AWS_ACCOUNT_ID=$CUENTA AWS_REGION=$REGION GRAFANA_ADMIN_PASSWORD=cambiar \
    envsubst < "ecs/task-definitions/artagram-$1.json" > "/tmp/artagram-$1-td.json"
  aws ecs register-task-definition --cli-input-json "file:///tmp/artagram-$1-td.json" \
    --query 'taskDefinition.taskDefinitionArn' --output text
}
existe_servicio() {
  [ "$(aws ecs describe-services --cluster $CLUSTER --services "$1" --query 'services[0].status' --output text 2>/dev/null)" = "ACTIVE" ]
}
if ! existe_servicio artagram-prometheus; then
  TD=$(tarea_inicial prometheus prom/prometheus:v2.55.1)
  aws ecs create-service --cluster $CLUSTER --service-name artagram-prometheus --task-definition "$TD" \
    --desired-count 0 --launch-type FARGATE --network-configuration "$RED" \
    --service-registries "registryArn=$ARN_PROMETHEUS" >/dev/null
fi
echo "   artagram-prometheus"
if ! existe_servicio artagram-grafana; then
  TD=$(tarea_inicial grafana grafana/grafana:11.3.0)
  aws ecs create-service --cluster $CLUSTER --service-name artagram-grafana --task-definition "$TD" \
    --desired-count 0 --launch-type FARGATE --network-configuration "$RED" \
    --health-check-grace-period-seconds 60 \
    --load-balancers "targetGroupArn=$TG_GRAFANA,containerName=artagram-grafana,containerPort=3000" >/dev/null
fi
echo "   artagram-grafana"

cat <<EOF

Listo. Falta:
  - Crear el secret GRAFANA_ADMIN_PASSWORD en artagram-infra (GitHub).
  - Ejecutar el workflow "Build and deploy Prometheus and Grafana" (Actions > Run workflow).
  - Encender con desiredCount 1 artagram-prometheus y artagram-grafana junto con el resto.
EOF
