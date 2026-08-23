# AdvisorTrack API — Security pre-launch TODO

Checklist for hardening production **before go-live**.  
Current host: `api.advisortrack.co.za` (EC2 + Nginx + Certbot + PM2 + PostgreSQL).

Use this as a living document — tick items off as they are completed and note the date in the **Done log** at the bottom.

---

## Priority legend

| Priority | Meaning |
|----------|---------|
| **P0** | Must fix before any real user data / public launch |
| **P1** | Should fix before go-live; acceptable short-term risk only with a dated follow-up |
| **P2** | Hardening and operational maturity — schedule soon after launch |

---

## 1. Secrets and environment (P0)

- [ ] **Set `NODE_ENV=production`** on the server `.env` and restart with `pm2 restart advisortrack-api --update-env`
- [ ] **Rotate `JWT_SECRET`** — generate a new 32+ character random value; never reuse dev/local secrets in production
- [ ] **Rotate database password** for `advisortrack` — update PostgreSQL and `DATABASE_URL` together
- [ ] **Confirm `PII_ENCRYPTION_KEY` is set** on production and backed up in a secure secrets store (not email/Slack)
- [ ] **Lock down `.env` file permissions** on EC2: `chmod 600 ~/advisor_track_backend/.env`
- [ ] **Verify `.env` is never committed** — `.gitignore` already excludes it; audit git history if unsure
- [ ] **Remove or redact secrets** from shell history, screenshots, and shared terminal logs
- [ ] **Document secret rotation procedure** (who can rotate, where backups live, how to restart services)

---

## 2. AWS / EC2 / network (P0)

- [ ] **Review EC2 Security Group inbound rules** — minimum required:
  - SSH (22) — **your IP only**, not `0.0.0.0/0`
  - HTTP (80) — `0.0.0.0/0` (for Certbot redirect)
  - HTTPS (443) — `0.0.0.0/0`
- [ ] **Do not expose PostgreSQL (5432) publicly** unless absolutely required
  - Prefer **HeidiSQL via SSH tunnel** (`.ppk` key) over opening port 5432
  - If 5432 was opened for troubleshooting, **remove that rule** after DB admin is done
- [ ] **Enable UFW on Ubuntu** (if not already) and allow only 22 (restricted), 80, 443
- [ ] **Install and configure `fail2ban`** for SSH brute-force protection
- [ ] **Disable password SSH login** — key-only auth (`PasswordAuthentication no` in `sshd_config`)
- [ ] **Keep EC2 patched** — enable unattended security upgrades or a monthly patch window
- [ ] **Restrict SSH key access** — limit who holds the `.pem` / `.ppk`; consider AWS Systems Manager Session Manager as an alternative to open SSH
- [ ] **Attach an Elastic IP** (optional but recommended) so the public IP does not change on instance stop/start — update Xneelo DNS if IP changes

---

## 3. TLS / Nginx (P0)

- [ ] **Confirm HTTPS is enforced** — Certbot should redirect HTTP → HTTPS; test: `curl -I http://api.advisortrack.co.za/health`
- [ ] **Verify certificate auto-renewal**: `sudo certbot renew --dry-run`
- [ ] **Add security headers in Nginx** (if not already from Certbot/Helmet):
  - `Strict-Transport-Security` (HSTS)
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY` or `SAMEORIGIN`
- [ ] **Hide Nginx version** — `server_tokens off;` in `/etc/nginx/nginx.conf`
- [ ] **Rate limit at Nginx** for auth endpoints (`/api/v1/auth/login`, `/api/v1/auth/register`) — e.g. `limit_req_zone`
- [ ] **Set reasonable `client_max_body_size`** if large uploads are not needed (JSON API default 1mb in app is fine)
- [ ] **Do not proxy port 3000 publicly** — only Nginx on 443 should be reachable

Reference config: `deploy/nginx-api.advisortrack.co.za.conf`

---

## 4. Application — authentication and access (P0)

- [ ] **Disable or protect open registration** — `POST /api/v1/auth/register` is currently public; decide:
  - Disable in production, **or**
  - Require invite/admin approval, **or**
  - Add CAPTCHA + email verification before account activation
- [ ] **Remove demo / seed credentials from production**
  - Do not run `database/002_seed.sql` on production
  - If already seeded, delete or disable demo users (`john.mitchell@advisortrack.com` / `password`)
- [ ] **Review JWT expiry** — `JWT_EXPIRES_IN=7d` may be long for financial advisor data; consider `24h` + refresh tokens
- [ ] **Implement refresh tokens or shorter-lived access tokens** (P1)
- [ ] **Add rate limiting** on auth routes (express-rate-limit or Nginx) — mitigate credential stuffing
- [ ] **Implement account lockout** after repeated failed login attempts (P1)
- [ ] **Complete forgot-password flow** — currently a stub; must not leak whether an email exists (timing-safe responses)
- [ ] **Audit all routes** — confirm every data route uses `requireAuth` and scopes data to `req.userId`

---

## 5. Application — public surface reduction (P0 / P1)

- [ ] **Disable or restrict Swagger in production**
  - `/api/docs` and `/api/docs.json` are currently public — exposes full API surface
  - Options: disable when `NODE_ENV=production`, IP allowlist, or HTTP basic auth via Nginx
- [ ] **Reduce `/health` information disclosure**
  - Currently returns DB connection details and environment name
  - Consider a minimal public health check; keep detailed checks internal or auth-protected
- [ ] **Review `GET /api/v1` index** — lists all endpoints publicly; acceptable for dev, consider trimming in production (P2)
- [ ] **Ensure production error responses never leak stack traces** — `errorHandler.ts` already returns generic 500 messages; verify no `console.error` output is exposed to clients

---

## 6. Database (P0)

- [ ] **PostgreSQL listens on localhost only** — `listen_addresses = 'localhost'` in `postgresql.conf` (default on Ubuntu)
- [ ] **`pg_hba.conf` allows only local connections** for app user — no `0.0.0.0/0` entries
- [ ] **Use least-privilege DB user** — `advisortrack` should not have superuser or `CREATEDB` unless required
- [ ] **Enable automated PostgreSQL backups**
  - Daily `pg_dump` to S3 or off-server storage
  - Test restore at least once before go-live
- [ ] **Encrypt backups at rest** (S3 SSE or gpg)
- [ ] **Document RPO/RTO** (how much data loss / downtime is acceptable)

---

## 7. POPIA and PII (P0 — South Africa)

AdvisorTrack stores financial advisor client data. Treat as **personal information** under POPIA.

- [ ] **Confirm PII fields are encrypted at rest** — `PII_ENCRYPTION_KEY` + columns in `003_contacts_popia.sql`
- [ ] **Verify `popia_audit_log` is written** on contact create/update/import/delete/access
- [ ] **Privacy notice version** — `POPIA_NOTICE_VERSION` matches in-app consent text
- [ ] **Data retention policy** — define how long contacts/activities are kept and implement deletion (right to erasure)
- [ ] **Data processing agreement** — document who is responsible party vs operator (your business vs AWS/hosting)
- [ ] **Cross-border transfer** — EC2 in `us-east-1` may store SA personal info outside SA; document lawful basis and inform users if required
- [ ] **Incident response plan** — who to notify, within what timeframe, if PII is breached
- [ ] **Access logging** — who accessed production DB (SSH, HeidiSQL) and when

---

## 8. CORS and mobile client (P1)

- [ ] **Set production `CORS_ORIGINS`** explicitly — no wildcards in production
  - Example: `https://www.advisortrack.co.za,https://advisortrack.co.za`
  - Mobile native apps often do not send browser CORS headers; still restrict for any web clients
- [ ] **Pin production API URL in mobile builds** — `EXPO_PUBLIC_API_URL=https://api.advisortrack.co.za/api/v1`
- [ ] **Certificate pinning** (optional P2) — consider for high-security mobile builds
- [ ] **Secure token storage on device** — Expo SecureStore for JWT, not AsyncStorage plain text

---

## 9. Dependencies and code (P1)

- [ ] **Run `npm audit`** and resolve high/critical vulnerabilities before launch
- [ ] **Pin Node.js version** on server (currently Node 20 via setup script)
- [ ] **Enable Dependabot or similar** on GitHub repo for ongoing dependency alerts
- [ ] **Remove dev-only code paths** from production builds
- [ ] **Validate all request bodies** — Zod schemas are in place; audit new endpoints as they are added
- [ ] **Input size limits** — `express.json({ limit: '1mb' })` is set; review contact import chunk sizes

---

## 10. Logging, monitoring, and operations (P1)

- [ ] **Centralise or rotate logs** — PM2 logs at `/var/log/advisortrack/`; configure logrotate
- [ ] **Do not log passwords, JWTs, or decrypted PII**
- [ ] **Set up uptime monitoring** — e.g. UptimeRobot ping on `https://api.advisortrack.co.za/health`
- [ ] **Set up alerts** — PM2 process down, disk full, Certbot renewal failure, 5xx spike
- [ ] **Define on-call / escalation** for production incidents
- [ ] **Document deploy runbook** — `git pull`, `npm ci`, `npm run build`, `pm2 restart`, migration order

Reference: `deploy/ecosystem.config.cjs`, `deploy/setup-server.sh`

---

## 11. GitHub and deploy pipeline (P1)

- [ ] **Use deploy key or fine-grained PAT** on server — read-only access to repo
- [ ] **Protect `master` branch** — require PR reviews, no force-push
- [ ] **Never store secrets in GitHub** — use GitHub Secrets if CI/CD is added later
- [ ] **Consider CI pipeline** — lint, typecheck, `npm audit`, build on every PR
- [ ] **Separate staging environment** (P2) — test migrations and releases before production

---

## 12. Go-live verification checklist

Run these checks immediately before opening to real advisors:

```bash
# On server
grep NODE_ENV ~/advisor_track_backend/.env          # must be production
pm2 status                                          # advisortrack-api online
curl -s https://api.advisortrack.co.za/health      # API up
sudo certbot certificates                           # SSL valid
sudo ss -tlnp | grep 5432                           # should be 127.0.0.1 only
```

```bash
# Security spot checks (from your PC)
curl -I http://api.advisortrack.co.za/health        # should redirect to HTTPS
curl -I https://api.advisortrack.co.za/api/docs     # decide: should this be 404 or restricted?
```

Manual checks:

- [ ] Login works with a **real** production account (not demo seed)
- [ ] Wrong password returns generic error (no user enumeration)
- [ ] Cannot access `/contacts` without `Authorization: Bearer` token
- [ ] HeidiSQL access works via **SSH tunnel only** (port 5432 not open to world)
- [ ] Mobile app points to production HTTPS URL

---

## Current state (baseline — June 2026)

What is already in place:

| Area | Status |
|------|--------|
| HTTPS (Let's Encrypt) | Done — Certbot on `api.advisortrack.co.za` |
| Nginx reverse proxy | Done — proxies to localhost:3000 |
| PM2 process manager | Done |
| PostgreSQL + migrations | Done — 9 tables |
| Helmet security headers | Partial — CSP disabled in dev only |
| CORS restriction in production | Code supports it — verify `.env` |
| JWT auth on protected routes | Done |
| PII encryption utilities + POPIA migration | Done — verify key set on server |
| Rate limiting | **Not implemented** |
| Swagger disabled in prod | **Not implemented** |
| Open registration disabled | **Not implemented** |
| Automated DB backups | **Not implemented** |
| SSH / DB hardening | **Review required** |

---

## Done log

Record completed items here:

| Date | Item | Notes |
|------|------|-------|
| | | |

---

## Related files

- `deploy/setup-server.sh` — initial server bootstrap
- `deploy/nginx-api.advisortrack.co.za.conf` — Nginx site config
- `deploy/ecosystem.config.cjs` — PM2 config
- `.env.example` — required environment variables
- `database/003_contacts_popia.sql` — POPIA columns and audit log
- `src/app.ts` — Helmet, CORS, Swagger mount
- `src/middleware/auth.ts` — JWT verification

---

*Last updated: June 2026 — review before production launch.*
