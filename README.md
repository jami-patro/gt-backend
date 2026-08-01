# Batch Reunion — Backend API

Express + MongoDB (Mongoose) API for the 25-year batch reunion. Deployable as
Vercel serverless functions, connecting to your existing loyaltty MongoDB.

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/register` | – | Member signup |
| POST | `/api/auth/login` | – | Login (user or admin) |
| GET  | `/api/auth/me` | user | Current session |
| GET  | `/api/rsvp` | user | Get my response |
| PUT  | `/api/rsvp` | user | Create/update my response (editable) |
| GET  | `/api/public/event` | – | Event name + date |
| GET  | `/api/public/stats` | – | Live counts + headcount |
| GET  | `/api/public/attendees` | – | Who voted yes/maybe |
| GET  | `/api/admin/responses` | admin | All members + responses |
| GET  | `/api/admin/export.csv` | admin | CSV download |
| DELETE | `/api/admin/users/:id` | admin | Remove a member |

## Environment variables

See `.env.example`. Key ones:
- `MONGO_URL` — your loyaltty Mongo connection string. Point it at a dedicated
  `gettogether` database, e.g.
  `mongodb://user:pass@165.22.138.253:27017/gettogether?authSource=admin`
- `JWT_SECRET` — long random string
- `FRONTEND_URL` — allowed CORS origin(s), comma-separated (your Vercel frontend URL)
- `EVENT_NAME`, `EVENT_DATE` — shown on the landing page
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` — used by the seed script

## Local development

```bash
npm install
# set MONGO_URL in .env first
npm run seed:admin   # creates the admin account
npm run dev          # http://localhost:5050
```

## Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel: New Project → import the repo. No build command needed.
3. Add environment variables (at minimum `MONGO_URL`, `JWT_SECRET`, `FRONTEND_URL`,
   `EVENT_DATE`).
4. Deploy. `vercel.json` routes all requests to the serverless function in `api/`.
5. Seed the admin once: run `npm run seed:admin` locally with the production
   `MONGO_URL`, or temporarily hit it from your machine.

### Keeping it warm (optional)
Free serverless cold-starts add a small delay. Point a free uptime pinger
(e.g. UptimeRobot) at `/api/health` every few minutes around invite time.
