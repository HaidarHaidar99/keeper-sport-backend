-- Migration: 20261007000000_contact_messages_is_read.sql
-- Description: Add read status tracking to contact_messages table

ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false;
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS read_at timestamptz;
