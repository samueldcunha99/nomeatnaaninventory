# Full cafe flow audit — 8 November 2026

Requested: test the whole software, look for bugs and fix the findings. All business
test writes were made to separate native PostgreSQL databases on localhost:55434.
The compiled QA app used restricted `cafe_app` access on localhost:3100. The client's
Netlify/Supabase workspace remained empty for the trial.

## Reproduced and fixed

| Finding | Reproduction | Fix |
|---|---|---|
| Stale stock forms could reinterpret kg as litres | Open a weight ingredient's receipt; change it to volume with the same 1,000-base-unit purchase factor; the old form saved. Also reproduced in opening stock, adjustment and wastage. | Submit both measurement and pack factor, require them in the action, and compare against the current ingredient under the stock lock before any write. Covers edits that finish while a receipt waits. |
| Unsafe numeric storage could round quantities/money | A correction of 9,007,199,254,740,993 milli-base, and oversized thresholds/rates/recipe quantities, could cross to JS number without exactness checks. Multiple individually valid inflows could also overflow the derived quantity. | Guard conversion boundaries and the folded stock result against the exact supported range. Invalid entries throw before commit; ledger/cache remain atomic. |
| Negative low-stock thresholds caused a server error | Submitting -1 from the ingredient form reached the database check and rendered 500. | Pure input validation rejects negatives and overly long/unsafe values with localized operator messages; valid fractions and explicit zero are exact. |
| Validation errors erased business form drafts | In the browser, submit an existing ingredient name with a brand, pack and threshold; after rejection those fields reverted to defaults. | Shared `DraftForm` restores ordinary fields on action errors without changing the action identity or progressive form submission. Passwords, file inputs and hidden identities are excluded. Successful resets and redirects remain. |
| Hindi bill balance used a stock label | The bill reused the inventory translation of “Balance,” showing “remaining stock” beside money owed. | Bills now use the distinct “Balance due” key with the correct Hindi and Marathi money labels. |

The stock-unit, pack, concurrency and unsafe-number regressions were observed failing
before their fixes. Afterward all new cases pass. All new operator messages include
Hindi and Marathi; a regression checks that ingredient names survive translation.

## Verification

| Check | Result |
|---|---|
| Full native PostgreSQL suite | **382 passed, 0 failed, 0 skipped** |
| Typecheck and optimized production build | Passed |
| Existing inventory/production HTTP workflows | **18 passed** |
| Existing orders/payment/access HTTP workflows | **17 passed** |
| Additional form workflow groups | **12 passed** |
| Changed measurement on four stock forms | All refused with zero stock writes |
| Negative and unsafe thresholds | Refused with readable errors; no ingredient written |
| Fresh migration, restricted runtime and populated backup/restore | Passed; all table counts and history triggers restored |
| npm dependency audit | **0 reported vulnerabilities** |
| Live read-only cafe check | Healthy; zero active catalogue rows, stock movements, batches, orders and payments; owner and archived history retained |

The 47 compiled workflow groups cover actual rendered action submissions for:

- Authentication, wrong-password/anonymous guards, role restrictions and sign-out.
- Ingredient creation, exact fractional thresholds, duplicate handling and stale units.
- Multi-line receipt atomicity, weighted-average costs, concurrent retries and opening valuation.
- Recipe creation with count yield, metric ingredient lines, wastage and preparation time;
  recipe costing and menu serving/fulfillment setup.
- Backdated fractional production, measured output, prepared-shelf production, parent usage
  without double raw deductions, reversal, tiny-quantity refusal and separate wastage.
- Daily/date/recipe reports and CSV filtering, translation and access controls.
- Order confirmation and retries, saved costs/prices, invalid delivery details, missing
  external-payment references, stale menu and tax quotes, inclusive/exclusive tax.
- Partial payments and retries, overpayment refusal, manager-only refunds, prepared sales,
  cancellation before/after preparation, saved margins and private customer tracking.
- Staff changes, disposable password change/session revocation and all three languages,
  including nested ingredient, recipe and order pages.

Some early harness failures were not product defects: the old production test selected
both batch and reversal forms by the same hidden request field; the test server needed
readiness before requests; and fully paid orders correctly omit new-payment controls.
The harness was corrected and affected checks rerun. Report receipt totals are checked
against the test cafe's actual receipt ledger so independent scenarios can coexist.

## Browser interaction verification

The browser reproduced draft clearing before the fix. Post-fix it retained a rejected
ingredient's name, brand, purchase unit and threshold, then saved the corrected name.
A real 1.25 kg / INR 125 test receipt saved, previewed INR 100/kg and cleared the receipt
for the next delivery. A recipe with a deliberately zero line was refused without losing
its name, yield, time, notes or lines; correcting the quantity saved a ten-piece batch at
INR 10 total / INR 1 per piece. Menu configuration saved INR 20 per serving.

The order draft retained item/count, customer name and notes across switching to Hindi.
The narrow 320-pixel order form had no horizontal overflow. The Hindi order confirmed
two INR 20 servings, a saved INR 2 material cost and INR 40 bill. A manual test cash
payment settled the INR 40 balance, and the actual UI advanced through kitchen, baking,
out of oven, ready and completed. Public tracking and final publication evidence follow
below. These are fabricated local test records, not transactions in the cafe database.

Private helpers, dumps, credentials, logs and test database files remain under ignored
`.netlify/` paths. The checked-in regressions, source fixes and this report contain no
production credentials. No migration, demo seed or test write was applied to Supabase.

## Remaining operational limits

The cafe still needs real setup and staff acceptance/reconciliation. Off-site backup
automation remains disabled until client configuration and recovery validation. Payments
are manual records, not a payment gateway. Existing denied internal routes fail closed
with a generic error page; tests verify the data/action refusal, not an ideal 403 UX.
The test results establish the checked scenarios and do not replace the month of staff
testing with actual measurements and physical stock.
