#!/usr/bin/env bash
set -e

echo "=========================================================="
echo "           Iniciando ArtaGram en Linux / WSL              "
echo "=========================================================="

# 1. Crear .env si no existe
if [ ! -f .env ]; then
  echo "[+] Creando .env desde .env.example..."
  cp .env.example .env
else
  echo "[✓] Archivo .env ya existe."
fi

# 2. Generar llaves RSA para autenticación RS256
if [ ! -f secrets-dev/jwt-private.pem ] || [ ! -f secrets-dev/jwt-public.pem ]; then
  echo "[+] Generando par de llaves RSA dev (2048-bit) con GenerarLlavesRsa.java..."
  mkdir -p secrets-dev
  java scripts/GenerarLlavesRsa.java
else
  echo "[✓] Llaves RSA dev ya existen en secrets-dev/."
fi

# 3. Levantar las 5 bases de datos y colas
echo "[+] Levantando infraestructura base (PostgreSQL, Redis, MongoDB, RabbitMQ, Local-S3)..."
docker compose up -d

# 4. Levantar los 8 microservicios
echo "[+] Compilando y levantando los 8 microservicios..."
docker compose -f compose.yml -f compose.services.yml up -d --build

echo "=========================================================="
echo "          ¡ArtaGram Microservicios Levantados!            "
echo "=========================================================="
echo "• API Gateway:      http://localhost:8080"
echo "• Health check:     http://localhost:8080/actuator/health"
echo "• Auth JWKS:        http://localhost:8081/.well-known/jwks.json"
echo "• RabbitMQ UI:      http://localhost:15672  (artagram / artagram)"
echo "• S3 Local UI:      http://localhost:9001   (artagram / artagram123)"
echo "=========================================================="
