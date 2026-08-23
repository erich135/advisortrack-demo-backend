#!/usr/bin/env bash
# Creates advisortrack_demo + role on this PostgreSQL host.
# Writes /home/ubuntu/advisortrack_demo_backend/.env.demo if missing.
# Does not print secrets. Does not copy advisor_track data.
set -euo pipefail

BACKEND_DIR="${1:-/home/ubuntu/advisortrack_demo_backend}"
ENV_FILE="${BACKEND_DIR}/.env.demo"
DEMO_DB="advisortrack_demo"
DEMO_USER="advisortrack_demo"

if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DEMO_USER}'" | grep -q 1; then
  echo "Role ${DEMO_USER} already exists."
  CREATED_ROLE=0
  DEMO_PASS=""
else
  DEMO_PASS="$(openssl rand -base64 24 | tr -d '\n' | tr '+/' '-_')"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE ${DEMO_USER} LOGIN PASSWORD '${DEMO_PASS}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;"
  echo "Created role ${DEMO_USER}."
  CREATED_ROLE=1
fi

if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DEMO_DB}'" | grep -q 1; then
  echo "Database ${DEMO_DB} already exists."
else
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DEMO_DB} OWNER ${DEMO_USER};"
  echo "Created database ${DEMO_DB}."
fi

sudo -u postgres psql -d postgres -c "REVOKE CONNECT ON DATABASE advisor_track FROM ${DEMO_USER};" >/dev/null 2>&1 || true
sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -c "GRANT CONNECT ON DATABASE advisor_track TO advisortrack;"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -c "REVOKE CONNECT ON DATABASE advisor_track FROM PUBLIC;"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -c "REVOKE ALL ON DATABASE ${DEMO_DB} FROM PUBLIC;"
sudo -u postgres psql -d postgres -c "REVOKE CONNECT ON DATABASE ${DEMO_DB} FROM advisortrack;" >/dev/null 2>&1 || true
sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -c "GRANT CONNECT, TEMPORARY ON DATABASE ${DEMO_DB} TO ${DEMO_USER};"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DEMO_DB}" -c "GRANT ALL ON SCHEMA public TO ${DEMO_USER};"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DEMO_DB}" -c "ALTER SCHEMA public OWNER TO ${DEMO_USER};"

mkdir -p "${BACKEND_DIR}"

if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ "${CREATED_ROLE}" -ne 1 ]]; then
    echo "ERROR: ${ENV_FILE} is missing but role already exists. Recreate the env file with the known demo password."
    exit 1
  fi
  JWT_SECRET="$(openssl rand -base64 32 | tr -d '\n')"
  PII_KEY="$(openssl rand -base64 32 | tr -d '\n')"
  umask 077
  DEMO_USER="${DEMO_USER}" DEMO_PASS="${DEMO_PASS}" DEMO_DB="${DEMO_DB}" \
  JWT_SECRET="${JWT_SECRET}" PII_KEY="${PII_KEY}" python3 - <<'PY' > "${ENV_FILE}"
import os, urllib.parse
user = os.environ["DEMO_USER"]
password = os.environ["DEMO_PASS"]
db = os.environ["DEMO_DB"]
url = "postgresql://{}:{}@127.0.0.1:5432/{}".format(
    user, urllib.parse.quote(password, safe=""), db
)
print("ADVISORTRACK_MODE=demo")
print("NODE_ENV=production")
print("PORT=3001")
print("JWT_SECRET=" + os.environ["JWT_SECRET"])
print("JWT_EXPIRES_IN=12h")
print("CORS_ORIGINS=https://demo.advisortrack.co.za")
print("DATABASE_URL=" + url)
print("PII_ENCRYPTION_KEY=" + os.environ["PII_KEY"])
print("POPIA_NOTICE_VERSION=2026-06")
print("MAILTRAP_API_TOKEN=")
print("DEMO_SESSION_TTL_MINUTES=120")
print("DEMO_EXPIRY_SWEEP_MINUTES=15")
print("MAIL_FROM_EMAIL=hello@advisortrack.co.za")
print("MAIL_FROM_NAME=AdvisorTrack")
print("APP_DEEP_LINK_SCHEME=advisortrack")
PY
  chmod 600 "${ENV_FILE}"
  unset DEMO_PASS JWT_SECRET PII_KEY
  echo "Wrote ${ENV_FILE} (secrets not printed)."
else
  echo "${ENV_FILE} already exists and was not overwritten."
fi

echo "Production database advisor_track was not used as a data source."
