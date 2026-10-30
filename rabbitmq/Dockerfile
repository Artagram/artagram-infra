FROM rabbitmq:3.13-management-alpine

COPY definitions.json /etc/rabbitmq/definitions.json
COPY enabled_plugins /etc/rabbitmq/enabled_plugins
COPY rabbitmq.conf /etc/rabbitmq/rabbitmq.conf
COPY entrypoint-wrapper.sh /usr/local/bin/entrypoint-wrapper.sh
RUN chmod +x /usr/local/bin/entrypoint-wrapper.sh

# definitions.json (vhosts, exchanges, colas, usuarios, permisos) se
# carga al boot via "load_definitions" en rabbitmq.conf -- SIN el shovel.
# El shovel bridge-events-to-notifications se configura aparte, despues
# del arranque completo, en entrypoint-wrapper.sh: cargarlo como parte
# de definitions.json (via rabbitmq.conf o via el legado
# -rabbitmq_management load_definitions, probado ambos) revienta el boot
# con {noproc,{gen_server,call,[rabbit_shovel_dyn_worker_sup_sup,...]}}
# porque el boot step rabbit_shovel_parameters corre antes de que el
# supervisor dinamico de rabbitmq_shovel quede registrado.
#
# RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS (solo memoria) se setea como
# variable de entorno en la ECS Task Definition, igual que en
# compose.yml -- no se hornea aqui para poder ajustarla sin rebuild.

ENTRYPOINT ["/usr/local/bin/entrypoint-wrapper.sh"]
