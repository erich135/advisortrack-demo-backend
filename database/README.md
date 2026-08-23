# AdvisorTrack — PostgreSQL setup (pgAdmin 4)

This folder contains SQL scripts to create all tables needed by the **mobile app screens** and the **Node.js API**.

## Tables overview

| Table | Maps to app screen |
|-------|-------------------|
| `users` | Login, Register, **Profile Settings** (name, email, phone, avatar), **Terms acceptance** (`terms_accepted_at`, `terms_version`) |
| `advisor_financial_profile` | **Profile Settings** + **Setup Concierge** — monthly goal, deductions, split, `setup_completed_at` |
| `advisor_general_settings` | **General Settings** (commission override, tax override, conversion ratio sliders) |
| `password_reset_tokens` | Forgot Password (future) |
| `contacts` | **Create Contact**, Contacts list (ID number, address, gender, income bracket, interests/tags, rating) |
| `activities` | **Create Activity** (pipeline stage, tags, due date/time, estimated value, notes) |
| `production_entries` | **Create Production** (amount, issued flag, tags, pipeline stage) |
| `production_monthly_goals` | Production dashboard gauges |
| `GET /dashboard` (aggregated) | **Home dashboard** — reads from tables below |

## Home dashboard — where each metric lives

| Dashboard UI | Source table(s) | Logic |
|--------------|-----------------|--------|
| **Estimated commission** | `production_entries` | Sum of `amount` for current calendar month |
| **Issued commission** | `production_entries` | Sum of `amount` where `is_issued = true` (current month) |
| **Progress to target** | `advisor_financial_profile.monthly_goal_nett` → `production_monthly_goals.goal_amount` → default | `issued / goal × 100` |
| **Calls (weekly)** | `activities` | Count where `pipeline_stage = 'Initial Contact'` this ISO week |
| **Meetings (weekly)** | `activities` | Count where `pipeline_stage = 'Interview'` this week |
| **Quotes (weekly)** | `activities` | Count where `pipeline_stage` in Analysis / Recommendation |
| **Submission (weekly)** | `production_entries` | Count of entries dated this week |
| **Weekly points** | Derived | Average % of weekly targets (targets configurable later) |

Profile identity stays in `users`; financial targets in `advisor_financial_profile`; pipeline activity in `activities`; issued cases in `production_entries`.

## pgAdmin 4 — step by step

### 1. Create the database

1. Open **pgAdmin 4**
2. Connect to your PostgreSQL server (local or remote)
3. Right-click **Databases** → **Create** → **Database…**
4. Name: `advisor_track`
5. Owner: your PostgreSQL user (e.g. `postgres`)
6. Save

### 2. Run the schema script

1. Select database **advisor_track**
2. **Tools** → **Query Tool** (or right-click → Query Tool)
3. Open `001_init.sql` (File → Open) or paste its contents
4. Click **Execute** (▶) or press **F5**
5. You should see: `AdvisorTrack schema created successfully.`

### 3. Set the demo user password hash

The seed user email is `john.mitchell@advisortrack.com`. Generate a real bcrypt hash:

```bash
cd advisor_track_backend
npm run db:hash-password
```

Copy the hash and run in Query Tool:

```sql
UPDATE users
SET password_hash = 'PASTE_HASH_HERE'
WHERE email = 'john.mitchell@advisortrack.com';
```

### 4. (Optional) Run seed data

Open and execute `002_seed.sql` for sample contacts, activities, and production.

## Connection string for the backend (later)

Add to `advisor_track_backend/.env`:

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/advisor_track
```

Example pgAdmin connection defaults:

| Setting | Value |
|---------|--------|
| Host | `localhost` |
| Port | `5432` |
| Database | `advisor_track` |
| Username | `postgres` |

## Entity relationship (simplified)

```
users
 ├── advisor_general_settings (1:1)
 ├── advisor_financial_profile (1:1)
 ├── contacts (1:many)
 │     ├── activities (optional FK)
 │     └── production_entries (optional FK)
 ├── activities (1:many)
 ├── production_entries (1:many)
 └── production_monthly_goals (1:many)
```

## ENUM reference (matches app pickers)

- **pipeline_stage**: Initial Contact, Interview, Analysis, Recommendation, Implementation, Review
- **product_tag**: Estate Planning, Life Cover, Disability, … (9 tags)
- **contact_status**: prospect, active, inactive
- **contact_gender**: Male, Female
- **income_bracket**: `< R15000`, `R15000 - R50000`, `> R50000`

## Notes

- All primary keys are **UUID** (`gen_random_uuid()`).
- Emails use **CITEXT** (case-insensitive unique).
- `contacts.interests`, `activities.tags`, and `production_entries.tags` use PostgreSQL **arrays** of `product_tag`.
- `activities.due_at` is auto-computed from `due_date` + `due_time`.
- A trigger auto-creates `advisor_general_settings` when a new user is inserted.

## Next step (backend code)

When ready, we will add `pg` or Prisma/Drizzle to `advisor_track_backend` and replace the in-memory store with these tables.
