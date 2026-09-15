-- The ledger is the only record of what was bought and what it cost. Everything else -
-- stock on hand, the weighted average, every recipe cost derived from it - is a fold over
-- these rows. Schema comments have claimed since 0000 that it is append-only; until now
-- only the application enforced that, so one stray UPDATE in a psql session could rewrite
-- purchase history, and ingredient_stock.snapshot_seq would never notice, because the
-- watermark only ever moves forward past NEW rows.
--
-- A correction is a new movement. That is the whole design. So: no UPDATE, no DELETE, at
-- the database, for everyone including the application's own role.
--
-- The exceptions are all maintenance, never business logic: dropping a whole tenant takes
-- its movements with it, and test fixtures back-date a receipt to sit before a filter
-- window. Those need an explicit, transaction-local opt-in nobody types by accident:
--
--     set local app.ledger_maintenance = 'on';
--
-- Transaction-local, so it lapses on commit and cannot be left switched on. The
-- application never sets it - only scripts/ and test fixtures do. Grep says so, and it
-- stays that way.
CREATE OR REPLACE FUNCTION stock_movements_append_only() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.ledger_maintenance', true) = 'on' THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION
    'stock_movements is append-only: % attempted on seq %. Record a correcting movement instead.',
    TG_OP, OLD.seq
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER stock_movements_no_update
  BEFORE UPDATE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION stock_movements_append_only();--> statement-breakpoint
CREATE TRIGGER stock_movements_no_delete
  BEFORE DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION stock_movements_append_only();
