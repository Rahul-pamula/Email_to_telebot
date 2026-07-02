-- ============================================================================
-- Database Cleanup Routine
-- Runs every day at midnight to delete emails older than 10 days.
-- This prevents the free-tier Supabase database from filling up.
-- ============================================================================

-- Safely unschedule if it exists without requiring direct table permissions
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-old-emails');
EXCEPTION
  WHEN OTHERS THEN
    -- Job doesn't exist yet, ignore error
END
$$;

-- Schedule the daily cleanup job
SELECT cron.schedule(
  'cleanup-old-emails',
  '0 0 * * *', -- Run exactly at midnight every day
  $$
    -- Delete processed emails older than 10 days
    DELETE FROM public.processed_emails 
    WHERE processed_at < NOW() - INTERVAL '10 days';

    -- Delete old snoozed items that have already been delivered or expired
    DELETE FROM public.snooze_queue 
    WHERE created_at < NOW() - INTERVAL '10 days';
  $$
);
