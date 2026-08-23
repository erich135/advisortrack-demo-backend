# AdvisorTrack Backend

Node.js + TypeScript REST API for the [AdvisorTrack](../advisor_track) mobile app.

## Stack

- **Express 5** — HTTP server
- **TypeScript** — strict typing aligned with frontend models
- **Zod** — request validation
- **JWT + bcrypt** — authentication (ready for production DB)
- **In-memory store** — seed data for development (swap for PostgreSQL/MongoDB later)

## Quick start

```bash
cd advisor_track_backend
cp .env.example .env
npm install
npm run dev
```

Server runs at **http://localhost:3000**

## API documentation (Swagger)

Interactive docs are available while the server is running:

| URL | Description |
|-----|-------------|
| http://localhost:3000/api/docs | Swagger UI — test endpoints in the browser |
| http://localhost:3000/api/docs.json | Raw OpenAPI 3 JSON spec |

Via ngrok, use the same paths on your tunnel URL, e.g. `https://YOUR-ID.ngrok-free.app/api/docs`.

**Tip:** In Swagger UI, call **POST /auth/login**, copy the `token` from the response, click **Authorize**, and paste `Bearer <token>` (or just the token — Swagger adds Bearer for you).

## API index

`GET /api/v1` returns a list of available routes (not a login or data endpoint). Hitting `/api/v1` alone with no path used to 404; it now returns the route index.

## Authentication (JWT)

1. **Login** — `POST /api/v1/auth/login` with `{ "email", "password" }`
2. **Response** — `{ success: true, data: { token, user } }`
3. **Token lifetime** — controlled by `JWT_EXPIRES_IN` in `.env` (default **`7d`** = 7 days)
4. **Protected routes** — send header: `Authorization: Bearer <token>`
5. **Middleware** — `requireAuth` verifies the JWT on contacts, activities, production, `/auth/me`, and `/auth/logout`
6. **Logout** — client deletes the token; server logout is stateless (no token blacklist yet)

Change expiry in `.env`:

```
JWT_EXPIRES_IN=7d
```

Other examples: `24h`, `30m`, `14d`.

## Demo credentials

| Email | Password |
|-------|----------|
| `john.mitchell@advisortrack.com` | `password` |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with hot reload (tsx) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled production build |
| `npm run typecheck` | TypeScript check only |

## API overview

Base URL: `http://localhost:3000/api/v1`

All protected routes require:

```
Authorization: Bearer <token>
```

### Health

```
GET /health
```

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | No | Login, returns `{ token, user }` |
| POST | `/auth/register` | No | Create account |
| POST | `/auth/forgot-password` | No | Password reset stub |
| GET | `/auth/me` | Yes | Current user profile |
| POST | `/auth/logout` | Yes | Logout (client clears token) |

### Contacts

| Method | Path | Description |
|--------|------|-------------|
| GET | `/contacts?search=` | List contacts |
| GET | `/contacts/:id` | Get one contact |
| POST | `/contacts` | Create contact |

### Activities

| Method | Path | Description |
|--------|------|-------------|
| GET | `/activities?date=YYYY-MM-DD` | List activities |
| POST | `/activities` | Create activity |

### Production

| Method | Path | Description |
|--------|------|-------------|
| GET | `/production` | List entries |
| GET | `/production/summary` | Dashboard summary |
| POST | `/production` | Create entry |

## Response format

Success:

```json
{
  "success": true,
  "data": { }
}
```

Error:

```json
{
  "success": false,
  "error": {
    "message": "Invalid email or password",
    "code": "INVALID_CREDENTIALS"
  }
}
```

## Connect the mobile app

Point the Expo app API client at your machine IP when testing on a device:

```
EXPO_PUBLIC_API_URL=http://192.168.x.x:3000/api/v1
```

Use `localhost` only in emulators/simulators.

## Project structure

```
src/
├── config/       # Environment validation
├── data/         # Seed data + in-memory store
├── middleware/   # Auth + error handling
├── routes/       # Express routers
├── services/     # Business logic
├── types/        # Shared TypeScript types
├── utils/        # Auth helpers + response helpers
├── validators/   # Zod schemas
├── app.ts        # Express app factory
└── index.ts      # Server entry point
```

## Next steps

- [ ] Add PostgreSQL or MongoDB persistence
- [ ] Wire Expo `authService`, `contactService`, etc. to this API
- [ ] Add profile/settings endpoints
- [ ] Email service for forgot-password
- [ ] Rate limiting and refresh tokens
