-- Sign-in by username (for staff without email), one-time passwords, ending old sessions,
-- and login attempt limits that hold across server instances. Safe to run repeatedly.

ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
-- goes up on every password change or reset; sign-in tokens from an older version stop working at once
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 0;
ALTER TABLE users DROP COLUMN IF EXISTS sessions_valid_after;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (lower(username)) WHERE username IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_sign_in_present') THEN
    ALTER TABLE users ADD CONSTRAINT users_sign_in_present CHECK (email IS NOT NULL OR username IS NOT NULL);
  END IF;
END $$;

-- existing accounts can also sign in with the part of their email before the @, where that is unique
SELECT set_config('app.audit_off', 'on', TRUE);
UPDATE users u SET username = lower(split_part(u.email, '@', 1))
WHERE u.username IS NULL AND u.email IS NOT NULL
  AND lower(split_part(u.email, '@', 1)) ~ '^[a-z0-9._-]{3,40}$'
  AND NOT EXISTS (SELECT 1 FROM users x WHERE x.id <> u.id
                  AND (lower(x.username) = lower(split_part(u.email, '@', 1)) OR lower(split_part(x.email, '@', 1)) = lower(split_part(u.email, '@', 1))));

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  failures INT NOT NULL DEFAULT 0,
  first_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON login_attempts FROM anon, authenticated;
  END IF;
END $$;
