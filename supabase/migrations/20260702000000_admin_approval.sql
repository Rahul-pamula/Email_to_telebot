-- Migration: Add Admin Approval to Users Table
-- Adds is_admin and is_approved columns to control access to the bot.

ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.users.is_admin IS 'If true, this user is the owner and can approve others.';
COMMENT ON COLUMN public.users.is_approved IS 'If true, this user is allowed to use the bot. Admins are automatically approved.';
