FROM rabbitmq:3.13-management-alpine

COPY definitions.json /etc/rabbitmq/definitions.json
COPY enabled_plugins /etc/rabbitmq/enabled_plugins
COPY rabbitmq.conf /etc/rabbitmq/rabbitmq.conf

# La carga de definitions.json se hace via "load_definitions" en
# rabbitmq.conf (no via -rabbitmq_management load_definitions en
# RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS): ese mecanismo legado aplica las
# definiciones antes de que el supervisor dinamico de rabbitmq_shovel
# quede registrado, y revienta el boot con
# {noproc,{gen_server,call,[rabbit_shovel_dyn_worker_sup_sup,...]}} en
# cuanto definitions.json trae un shovel (como el nuestro). rabbitmq.conf
# respeta el orden de arranque de plugins.
#
# RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS (solo memoria) se setea como
# variable de entorno en la ECS Task Definition, igual que en
# compose.yml -- no se hornea aqui para poder ajustarla sin rebuild.
