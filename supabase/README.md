# Supabase Setup

1. Open your Supabase project.
2. Go to **SQL Editor**.
3. Create a new query.
4. Paste the contents of `schema.sql`.
5. Run it once.

After it succeeds, copy these from **Project Settings > API**:

- Project URL
- `anon public` key

Keep the `service_role` key private. Do not put it in the Expo app.
Keep the Supabase CLI access token in `supabase/.env`, not in the app `.env`.

The app can stay local-first for now. Supabase will be used later for accounts,
shared foods, barcode lookup, and reviewed food submissions.
