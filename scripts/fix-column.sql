ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_notifications boolean NOT NULL DEFAULT true;
