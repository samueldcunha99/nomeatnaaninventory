-- Custom SQL migration file, put your code below! --
-- A custom GUC can be set by any database user. Maintenance additionally requires
-- the privileged migration role; the web role may never bypass append-only guards.
CREATE OR REPLACE FUNCTION stock_movements_append_only() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.ledger_maintenance', true) = 'on' AND current_user <> 'cafe_app' THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'stock_movements is append-only: % attempted on seq %. Record a correcting movement instead.', TG_OP, OLD.seq
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION production_runs_append_only() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.ledger_maintenance', true) = 'on' AND current_user <> 'cafe_app' THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'production_runs is append-only: % attempted on run %.', TG_OP, OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION production_reversals_append_only() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.ledger_maintenance', true) = 'on' AND current_user <> 'cafe_app' THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'production_reversals is append-only: % attempted on correction %.', TG_OP, OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
