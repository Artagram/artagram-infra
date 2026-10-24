-- Script de inicialización de PostgreSQL 16 para ArtaGram
-- Crea las bases de datos aisladas por microservicio y asegura ambos roles (artagram y artagram_app)

DO
$do$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'artagram_app') THEN
      CREATE ROLE artagram_app WITH LOGIN SUPERUSER PASSWORD 'artagram_secret';
   END IF;
END
$do$;

SELECT 'CREATE DATABASE db_auth OWNER artagram'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'db_auth')\gexec

SELECT 'CREATE DATABASE db_usuarios OWNER artagram'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'db_usuarios')\gexec

SELECT 'CREATE DATABASE db_feed OWNER artagram'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'db_feed')\gexec

SELECT 'CREATE DATABASE db_lienzo OWNER artagram'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'db_lienzo')\gexec

SELECT 'CREATE DATABASE db_payment OWNER artagram'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'db_payment')\gexec

GRANT ALL PRIVILEGES ON DATABASE db_auth TO artagram;
GRANT ALL PRIVILEGES ON DATABASE db_auth TO artagram_app;
GRANT ALL PRIVILEGES ON DATABASE db_usuarios TO artagram;
GRANT ALL PRIVILEGES ON DATABASE db_usuarios TO artagram_app;
GRANT ALL PRIVILEGES ON DATABASE db_feed TO artagram;
GRANT ALL PRIVILEGES ON DATABASE db_feed TO artagram_app;
GRANT ALL PRIVILEGES ON DATABASE db_lienzo TO artagram;
GRANT ALL PRIVILEGES ON DATABASE db_lienzo TO artagram_app;
GRANT ALL PRIVILEGES ON DATABASE db_payment TO artagram;
GRANT ALL PRIVILEGES ON DATABASE db_payment TO artagram_app;
