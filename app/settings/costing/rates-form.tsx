'use client';

import { useActionState } from 'react';
import { saveRatesAction, type FormState } from '../actions.ts';

const ALERT =
  'M10 1.7 19 18H1L10 1.7Zm0 5.3a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1Zm0 8.2a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z';

export function RatesForm({
  labour,
  kitchen,
}: {
  /** Rupees per hour as decimal strings, or '' for not set. */
  labour: string;
  kitchen: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveRatesAction, {
    error: null,
  });

  return (
    <form action={formAction} className="max-w-xl">
      {state.error ? (
        <div className="msg msg--error" role="alert">
          <svg className="msg__icon" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d={ALERT} />
          </svg>
          <span>
            <span className="msg__title">Not saved. </span>
            {state.error}
          </span>
        </div>
      ) : null}

      <div className="field max-w-sm">
        <label className="label" htmlFor="labour">
          Labour, ₹ per hour
        </label>
        <input
          className="input tabular-nums"
          id="labour"
          name="labour"
          defaultValue={labour}
          inputMode="decimal"
          placeholder="80"
          aria-describedby="labour-hint"
        />
        <p id="labour-hint" className="prose-note mt-1">
          What an hour of kitchen work costs you, wages and everything on top. If a baker is
          on ₹16,000 a month for 26 days of 8 hours, that is about ₹77 an hour.
        </p>
      </div>

      <div className="field max-w-sm">
        <label className="label" htmlFor="kitchen">
          Kitchen overhead, ₹ per hour
        </label>
        <input
          className="input tabular-nums"
          id="kitchen"
          name="kitchen"
          defaultValue={kitchen}
          inputMode="decimal"
          placeholder="30"
          aria-describedby="kitchen-hint"
        />
        <p id="kitchen-hint" className="prose-note mt-1">
          Gas, power and rent, per hour the kitchen is working. Take a month of those bills
          and divide by the hours you actually cook — ₹18,000 over 600 hours is ₹30.
        </p>
      </div>

      <p className="prose-note">
        Leave either blank if you do not know it yet. Blank is not zero: a recipe is then
        costed on its ingredients and the breakdown says so, rather than quietly claiming
        the time was free.
      </p>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save rates'}
      </button>
    </form>
  );
}
