-- Migrations owner (runs migrations, owns the tables)
CREATE ROLE hesba_migrator LOGIN PASSWORD 'change-me-local' CREATEDB;

-- Application role: must NOT be superuser and must NOT bypass RLS.
-- If it could, Row Level Security would not protect shops.
CREATE ROLE hesba_app LOGIN PASSWORD 'change-me-local' NOSUPERUSER NOBYPASSRLS;

CREATE DATABASE hesba OWNER hesba_migrator;
