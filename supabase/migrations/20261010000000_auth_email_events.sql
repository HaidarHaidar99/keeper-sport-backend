-- Migration: 20261010000000_auth_email_events.sql
-- Description: Create persistent audit and rate limiting events table for authentication emails (Resend integration)
-- Features: Strict 60-second cooldown, max 3 resends per rolling 60-minute window, single-use token lifecycle

CREATE TABLE IF NOT EXISTS auth_email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  event_type text NOT NULL, -- 'verification_resend', 'password_reset'
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Optimize email + event_type + timestamp queries for rolling window checks
CREATE INDEX IF NOT EXISTS auth_email_events_email_type_created_idx
ON auth_email_events (email, event_type, created_at DESC);

-- Optimize IP address queries for anti-abuse protection
CREATE INDEX IF NOT EXISTS auth_email_events_ip_created_idx
ON auth_email_events (ip_address, created_at DESC);
