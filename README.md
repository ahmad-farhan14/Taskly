# Taskly

A responsive daily planner with a 24-hour schedule, quick to-dos, progress
tracking, and in-browser task reminders.

## Run locally

Create `.env.local` in this project directory with a server-only PostgreSQL
connection string:

```env
DATABASE_URL=postgresql://...
```

Keep the real connection string private; `.env.local` is ignored by Git. For
Supabase, download the database root certificate from **Project Settings →
Database → SSL Configuration** and add it as `DATABASE_SSL_CA` when the runtime
does not already trust that certificate. Keep certificate verification enabled;
do not disable TLS verification to work around certificate errors. Then run:

```bash
npm install
npm run dev
```

The API initializes the `tasks` table and its index when first used. For
production, configure `DATABASE_URL` in the deployment environment, run
`npm run build`, then `npm start`.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```

See [`../coldstart.md`](../coldstart.md) for the API contract, database schema,
feature behavior, and MVP boundaries.
