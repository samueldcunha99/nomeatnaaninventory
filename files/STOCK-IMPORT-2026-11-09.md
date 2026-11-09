# Stock file import - 9 November 2026

Owners/managers can open `/stock/import` from Ingredients, opening valuation or receipts.
The receipt shortcut selects delivery mode. The CSV template works in Excel via Save As
CSV UTF-8; no spreadsheet parsing dependency or external upload service was added.

Columns: `name,brand,unit_type,purchase_unit,purchase_unit_in_base,quantity,total_cost,low_stock_threshold`.
Each import supports up to 100 rows / 256 KB. Delimiters are comma or semicolon; quoted
cells, escaped quotes, CRLF and UTF-8 BOM are supported. Headings must match the template.
Quantities/thresholds use purchase units, values use total rupees for that row.

Both quantity/value may be blank for a catalogue-only row. A partial pair fails; zero
value is explicitly free stock. Missing cost stays unknown. Existing names are matched
case-insensitively inside the tenant; imports never edit their settings. Inactive rows,
unit/pack mismatches, duplicate names and unsafe quantities/values are refused.

Preview validates without writing. Confirmation reparses and checks the expected tenant
ingredient identities. Existing `createIngredient`, `recordOpeningStock` and `recordReceipt`
writers share one transaction; any failure rolls back catalogue, ledger, cache and audit.
Receipt writers retain their sorted ingredient locks, unit checks and shared cost fold.
Only their optional transaction seam was added. There is no schema change.

An immutable `stock.import` audit manifest identifies normalized file rows, import mode
and operator reference. A transaction-scoped import lock makes retries, concurrent
confirmations and fresh uploads of the same data replay the result rather than add stock.
A separate identical delivery needs another reference. Ledger notes retain that reference.

## Verification

- **395 tests passed, zero failed/skipped**, using isolated native PostgreSQL.
- Production build and TypeScript passed.
- **12 compiled multipart-form workflow groups passed**: all three languages, invalid
  formats/UTF-8/headers/values, preview with zero writes, tampered IDs, confirmed opening
  valuation, repeated/fresh-upload retries, whole-file rollback, existing delivery,
  pack mismatch, counter/kitchen refusal, anonymous redirects and cache/ledger equality.
- Native browser: invalid file refusal, three-row preview, three new ingredients/two
  stock lines, confirmation and duplicate protection; downloaded template headings checked.
  Hindi/Marathi retain the preview and exact values. Test sugar is 1.25 kg / INR 125;
  milk is 2 L / INR 100; coffee has no invented price or stock.
- Form checks found and fixed confirmation feedback disappearing on a submission without
  JavaScript. Native multipart error/success/replay messages now render as well.

Every test business write used `.netlify/stock-import-2026-11-09/` isolated databases.
Its credentials and logs are ignored. The cafe database was not seeded/imported.
Browser proof: `files/stock-import-browser-2026-11-09.png` (local, not part of release).
Publication/CI verification follows after pushing the tested application.
