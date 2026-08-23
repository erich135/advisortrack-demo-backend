#!/usr/bin/env bash
# AdvisorTrack API — first-time Ubuntu server bootstrap
# Run on EC2 as ubuntu: bash deploy/setup-server.sh
set -euo pipefail

echo "==> Updating packages..."
sudo apt update && sudo apt upgrade -y

echo "==> Installing Node.js 20..."
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi
node -v
npm -v

echo "==> Installing PostgreSQL, Nginx, Git, PM2 deps..."
sudo apt install -y postgresql postgresql-contrib nginx git build-essential
sudo npm install -g pm2

echo "==> Creating log directory..."
sudo mkdir -p /var/log/advisortrack
sudo chown ubuntu:ubuntu /var/log/advisortrack

echo "==> PostgreSQL: create role + database (edit password if needed)..."
DB_PASS="${ADVISORTRACK_DB_PASS:-changeme_strong_password}"
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='advisortrack'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE USER advisortrack WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='advisor_track'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE advisor_track OWNER advisortrack;"

echo ""
echo "Done. Next steps:"
echo "  1. Clone repo to ~/advisor_track_backend"
echo "  2. Copy .env.example to .env and set JWT_SECRET, DATABASE_URL, PII_ENCRYPTION_KEY"
echo "  3. npm ci && npm run build"
echo "  4. npm run db:migrate:all   # runs database/*.sql in order (skips 002_seed.sql)"
echo "  5. pm2 start deploy/ecosystem.config.cjs && pm2 save"
echo "  6. Enable nginx site + certbot for api.advisortrack.co.za"
echo ""
echo "Suggested DATABASE_URL:"
echo "  postgresql://advisortrack:${DB_PASS}@localhost:5432/advisor_track"
