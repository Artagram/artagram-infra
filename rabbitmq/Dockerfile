FROM rabbitmq:3.13-management-alpine

COPY definitions.json /etc/rabbitmq/definitions.json
COPY enabled_plugins /etc/rabbitmq/enabled_plugins

# RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS (memoria + carga de definitions.json)
# se setea como variable de entorno en la ECS Task Definition, igual que
# en compose.yml -- no se hornea aqui para poder ajustarla sin rebuild.
