#!/bin/sh
set -e

# El shovel bridge-events-to-notifications NO se carga como parte de
# definitions.json (ver Dockerfile) porque hacerlo revienta el boot con
# {noproc,{gen_server,call,[rabbit_shovel_dyn_worker_sup_sup,...]}} --
# el boot step rabbit_shovel_parameters corre antes de que el supervisor
# dinamico de rabbitmq_shovel quede registrado, sin importar si la carga
# es via -rabbitmq_management load_definitions o via rabbitmq.conf.
#
# En su lugar, este wrapper espera a que el broker termine de arrancar
# (rabbitmqctl await_startup) y recien ahi aplica el shovel via
# rabbitmqctl set_parameter -- misma operacion que hace la carga de
# definitions.json, solo que como paso en caliente en vez de boot step.
#
# El "sleep 20" inicial es necesario: si este subproceso (corriendo como
# root, antes de que docker-entrypoint.sh dropee privilegios al usuario
# rabbitmq) llama a rabbitmqctl ANTES de que el proceso principal alcance
# a crear /var/lib/rabbitmq/.erlang.cookie, rabbitmqctl (cliente Erlang)
# lo crea el mismo como root con permisos restrictivos -- y el broker
# real, corriendo luego como usuario rabbitmq, ya no puede leerlo
# (BOOT FAILED: "Error when reading .erlang.cookie: eacces"). Dandole
# tiempo al entrypoint oficial para inicializar el cookie file primero,
# este subproceso solo lo LEE (como root, que siempre puede leer
# cualquier archivo) en vez de crearlo.
(
  sleep 20
  rabbitmqctl await_startup
  rabbitmqctl set_parameter shovel bridge-events-to-notifications \
    "{\"src-protocol\":\"amqp091\",\"src-uri\":\"amqp://${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}@localhost/%2f\",\"src-exchange\":\"artagram.events\",\"src-exchange-key\":\"#\",\"dest-protocol\":\"amqp091\",\"dest-uri\":\"amqp://${RABBITMQ_DEFAULT_USER}:${RABBITMQ_DEFAULT_PASS}@localhost/notifications\",\"dest-exchange\":\"artagram.events\",\"add-forward-headers\":true,\"ack-mode\":\"on-confirm\"}"
) &

exec docker-entrypoint.sh rabbitmq-server
