# Clerk + Supabase identity bridge

Nitra Space currently stores every social identity as a Supabase Auth UUID. The
database has foreign keys to `auth.users(id)` and RLS/functions based on
`auth.uid()`. Clerk IDs such as `user_...` cannot be written into those UUID
columns safely.

The application therefore uses Clerk for the visible identity experience and a
server-only bridge for the existing Supabase data session:

1. Clerk completes sign-up/sign-in, verification, password recovery or Google sign-in.
2. `/api/auth-bridge` verifies the Clerk session with `CLERK_SECRET_KEY`.
3. It links an existing Supabase user by verified e-mail, or creates a new UUID
   account only after the user completes the Nitra profile fields.
4. It issues a one-time Supabase magic-link token hash. The browser exchanges it
   for the normal Supabase session used by existing RLS, Realtime and chat.

No Clerk secret or Supabase service-role key is sent to the browser. Existing
Supabase users, profiles, messages and RLS policies are preserved. No database
migration is required for this bridge.

## Required deployment settings

- Vercel Production: `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and
  `SUPABASE_SERVICE_ROLE_KEY`.
- Clerk Dashboard: enable Email + Password and Google, and add
  `https://nitraspace.xyz` and `https://www.nitraspace.xyz` to allowed origins
  / redirect URLs. Use `/account` as the post-authentication redirect.
- Do not add `CLERK_SECRET_KEY` to a `VITE_` variable.

The Supabase native Third-Party Auth integration is intentionally not enabled
for this schema: its Clerk `sub` would make `auth.uid()` a non-UUID value and
would break existing foreign keys and policies.
