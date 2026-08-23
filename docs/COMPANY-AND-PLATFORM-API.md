# Companies, roles, and platform APIs

For the UI team. These routes are **not** in Swagger (`/api/docs`).

Base URL: `https://api.advisortrack.co.za/api/v1`  
Auth: `Authorization: Bearer <JWT>` from `POST /auth/login`  
Envelope: `{ "success": true, "data": ... }` or `{ "success": false, "error": { "message", "code" } }`

---

## How it works (keep it simple)

1. Every advisor belongs to **one company**.
2. Self-serve sign-up goes into **AdvisorTrack** (our platform company) with the **Advisor** role.
3. Later, a brokerage can have its own company (e.g. 50 seats). How users *join* that company (invite code, admin add) is not built yet.
4. **Role names are free text** per company (`Supervisor`, `Manager`, anything). Permissions are a **fixed list** of keys you attach to a role.
5. Everyone can still use the existing app for **their own** contacts / pipeline. Extra keys only matter when we add team views.
6. `users.company` on the profile is still the advisor’s **practice name** (a string). Membership is `company_id` and shows up as `organisation` on login and `GET /auth/me`.

```
Company
  └── Roles (custom names + permission keys)
        └── Members (users) with optional reportsToUserId
```

---

## Permission keys

Same catalogue for every company. `GET /company/permissions` or `GET /platform/permissions`.

| key | Meaning |
|-----|---------|
| `view_team` | List members who report to you (`reportsToUserId`) |
| `view_company` | List every member in the company |
| `manage_roles` | Create / rename / permission roles |
| `manage_members` | Assign a role or manager to a member |
| `manage_company` | Reserved for editing company name / seats (platform can already do this) |

No extra keys = **Advisor**: own work only.

Seeded on every new company:

| Role | System? | Default on join? | Permissions |
|------|---------|------------------|-------------|
| Advisor | yes (can rename, cannot delete) | yes | none |
| Company admin | yes | no | all five keys |

---

## Test account (Android)

After `npm run db:reset-tester` on the server:

| | |
|--|--|
| Email | `developer@advisortrack.co.za` |
| Password | `AdvisorTrack@001!` |
| Email verified | yes |
| Plan | Advisor Standard (`pro`) |
| Company | AdvisorTrack |
| Role | Company admin |
| Platform admin | yes (can call `/platform/*`) |

---

## Company APIs (signed-in user’s company)

Prefix: `/api/v1/company`

| Method | Path | Who | What |
|--------|------|-----|------|
| GET | `/company/me` | any member | Company, role, permissions, `reportsToUserId`, `isPlatformAdmin` |
| GET | `/company/permissions` | any member | Permission catalogue |
| GET | `/company/roles` | any member | Roles + permission keys |
| POST | `/company/roles` | `manage_roles` | Create role `{ name, permissions?, isDefault? }` |
| PATCH | `/company/roles/:roleId` | `manage_roles` | `{ name?, permissions?, isDefault? }` |
| DELETE | `/company/roles/:roleId` | `manage_roles` | Custom roles only. Members move to the default role |
| GET | `/company/members` | `view_company` or `manage_members` (all) / `view_team` (direct reports only) | Members + role + subscription snapshot |
| PATCH | `/company/members/:memberId` | `manage_members` | `{ roleId?, reportsToUserId? }` (`reportsToUserId: null` clears manager) |

### `GET /company/me` example

```json
{
  "success": true,
  "data": {
    "company": {
      "id": "…",
      "name": "AdvisorTrack",
      "slug": "advisortrack",
      "seatLimit": null,
      "isPlatform": true
    },
    "role": { "id": "…", "name": "Company admin" },
    "permissions": ["view_company", "view_team", "manage_roles", "manage_members", "manage_company"],
    "reportsToUserId": null,
    "isPlatformAdmin": true
  }
}
```

### `GET /company/members` item

```json
{
  "id": "…",
  "firstName": "Developer",
  "lastName": "Android",
  "email": "developer@advisortrack.co.za",
  "role": { "id": "…", "name": "Company admin" },
  "reportsToUserId": null,
  "isPlatformAdmin": true,
  "subscription": { "slug": "pro", "name": "Advisor Standard", "status": "active" },
  "createdAt": "2026-08-13T00:00:00.000Z"
}
```

`POST /auth/login` and `GET /auth/me` also include the same `organisation` object so the app does not need a second call.

---

## Platform APIs (AdvisorTrack staff only)

Requires `is_platform_admin`. Prefix: `/api/v1/platform`

| Method | Path | What |
|--------|------|------|
| GET | `/platform/permissions` | Same catalogue |
| GET | `/platform/companies` | All companies + `memberCount` |
| POST | `/platform/companies` | `{ name, slug?, seatLimit? }` — also seeds Advisor + Company admin roles |
| GET | `/platform/companies/:companyId` | Company + roles + members |
| PATCH | `/platform/companies/:companyId` | `{ name?, seatLimit?, isActive? }` |

`seatLimit: null` = unlimited. Seat counting / blocking extra logins is **not** enforced yet.

---

## Not built yet (on purpose)

- Invite links / join codes for a brokerage
- Enforcing seat limits
- Switching a user from AdvisorTrack to another company
- UI for any of the above
- Scoping contacts/pipeline by team (APIs exist so we can add that later)

---

## Error codes

| HTTP | code | Meaning |
|------|------|---------|
| 401 | `UNAUTHORIZED` | Missing / bad JWT |
| 403 | `EMAIL_NOT_VERIFIED` | Verify email first |
| 403 | `FORBIDDEN` | Missing permission or not platform admin |
| 404 | `NOT_FOUND` / `NO_COMPANY` | Missing company or role |
| 409 | `ROLE_EXISTS` / `COMPANY_EXISTS` | Duplicate name or slug |
| 400 | `SYSTEM_ROLE` / `INVALID_PERMISSION` / `INVALID_ROLE` / `INVALID_MANAGER` | Bad input |

---

## Database (ops)

Run on **local and EC2** before relying on these APIs:

```bash
cd advisor_track_backend
npm run db:migrate:all          # applies 023_companies_roles.sql
npm run db:reset-tester         # WIPES all user data, seeds the Android tester
```

`db:reset-tester` truncates `users` (and cascaded contacts, activities, cases, etc.). It does **not** drop packages, companies, or roles.
