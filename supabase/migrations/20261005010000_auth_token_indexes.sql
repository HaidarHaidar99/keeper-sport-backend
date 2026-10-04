-- Migration: 20261005010000_auth_token_indexes.sql
-- Description: Add performant indexes for email verification and password reset token hashes on users table.

CREATE INDEX IF NOT EXISTS users_verification_token_hash_idx 
ON users(verification_token_hash) 
WHERE verification_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_password_reset_token_hash_idx 
ON users(password_reset_token_hash) 
WHERE password_reset_token_hash IS NOT NULL;
