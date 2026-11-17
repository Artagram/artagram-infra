# Grafana con la fuente de datos y el tablero tecnico aprovisionados. Se sirve
# bajo /grafana/ detras del ALB (regla de ruta /grafana*).
FROM grafana/grafana:11.3.0
ENV GF_SERVER_ROOT_URL=%(protocol)s://%(domain)s/grafana/ \
    GF_SERVER_SERVE_FROM_SUB_PATH=true \
    GF_AUTH_ANONYMOUS_ENABLED=false \
    GF_USERS_ALLOW_SIGN_UP=false \
    GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH=/var/lib/grafana/tableros/artagram-tecnico.json \
    PROMETHEUS_URL=http://prometheus.artagram.local:9090
COPY provisioning /etc/grafana/provisioning
COPY tableros /var/lib/grafana/tableros
