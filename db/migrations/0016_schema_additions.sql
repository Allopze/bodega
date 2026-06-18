-- DB-08: Migrate rate_limits.updated_at to timestamptz (was text ISO string).
ALTER TABLE rate_limits
  ALTER COLUMN updated_at TYPE timestamptz
  USING updated_at::timestamptz;

ALTER TABLE rate_limits
  ALTER COLUMN updated_at SET DEFAULT now();

-- S-15: Add email_notifications opt-out flag to users.
--       Defaults to true (keep existing behaviour), user can disable via profile.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_notifications boolean NOT NULL DEFAULT true;

-- U-03: Password reset tokens table (forgot-password flow).
--       token_hash = sha256(raw_token), expires in 1 hour, single-use.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          text        PRIMARY KEY,
  user_id     text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text        NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx
  ON password_reset_tokens (user_id);
