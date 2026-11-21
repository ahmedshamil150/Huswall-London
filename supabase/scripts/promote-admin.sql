-- ===========================================================================
-- Promote an existing auth user to administrator.
--
-- 1. Create the user in Supabase Dashboard > Authentication > Users
--    (or let them register through the storefront).
-- 2. Run this with their email.
--
-- Only run this in the SQL editor with the service role. Never expose it.
-- ===========================================================================

update profiles
set role = 'admin',
    is_active = true,
    updated_at = now()
where lower(email) = lower('REPLACE_WITH_ADMIN_EMAIL');

-- Verify
select id, email, role, is_active
from profiles
where role = 'admin';
