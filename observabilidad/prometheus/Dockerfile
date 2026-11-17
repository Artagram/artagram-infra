# Prometheus con la configuracion de AWS horneada en la imagen (en Fargate no
# hay volumenes de configuracion). Retiene 2 dias: es para operar, no historico.
FROM prom/prometheus:v2.55.1
COPY prometheus.yml /etc/prometheus/prometheus.yml
COPY alertas.yml /etc/prometheus/alertas.yml
CMD ["--config.file=/etc/prometheus/prometheus.yml", \
     "--storage.tsdb.path=/prometheus", \
     "--storage.tsdb.retention.time=2d", \
     "--web.enable-lifecycle"]
