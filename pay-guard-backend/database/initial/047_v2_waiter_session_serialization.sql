-- Serialize Waiter session enforcement at the database boundary so concurrent
-- device logins cannot both observe an empty active-session set.

CREATE OR REPLACE FUNCTION payguard_enforce_waiter_single_session()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected_role varchar(32);
BEGIN
  IF NEW.session_status <> 'ACTIVE' OR NEW.membership_role_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT role_code INTO selected_role
  FROM membership_role_assignments
  WHERE id = NEW.membership_role_id;
  IF selected_role = 'WAITER' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));
    IF EXISTS (
      SELECT 1 FROM user_sessions session
      WHERE session.user_id = NEW.user_id
        AND session.session_status = 'ACTIVE'
        AND session.id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'Waiter already has an active session'
        USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END $$;
