'use client';

import { useActionState, useState } from 'react';
import { loginAction } from './actions.ts';

/** One eye, drawn once. The slash is added over it when the password is showing. */
const EYE =
  'M10 4.5c-4.2 0-7.2 4.2-7.9 5.2a.6.6 0 0 0 0 .6c.7 1 3.7 5.2 7.9 5.2s7.2-4.2 7.9-5.2a.6.6 0 0 0 0-.6c-.7-1-3.7-5.2-7.9-5.2Zm0 8.8a3.3 3.3 0 1 1 0-6.6 3.3 3.3 0 0 1 0 6.6Zm0-5.1a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z';

/**
 * Reference implementation for the internal tier. Styling only — the action, the hook
 * and the single generic failure message are unchanged.
 */
export default function LoginPage() {
  const [error, formAction, pending] = useActionState(loginAction, null);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <>
      <header className="brandbar">
        <div className="brandbar__inner">
          {/* No logo asset was supplied, so the wordmark is set in Poppins for now. */}
          <span className="brandbar__name">NO MEAT NAAN</span>
          <span className="text-sm opacity-85">
            Management
          </span>
        </div>
      </header>

      <main className="page page--narrow">
        <h1>Sign in</h1>
        <p className="prose-note">
          Staff access only.
        </p>

        <form action={formAction} noValidate>
          {error ? (
            /*
             * Not colour alone: an icon, a bold heading and the message itself. This
             * still reads correctly in greyscale and on a washed-out tablet screen.
             */
            <div className="msg msg--error" role="alert" id="signin-error">
              <svg
                className="msg__icon"
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M10 1.7 19 18H1L10 1.7Zm0 5.3a1 1 0 0 0-1 1v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-1-1Zm0 8.2a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z" />
              </svg>
              <span>
                <span className="msg__title">Couldn’t sign in. </span>
                {error}
              </span>
            </div>
          ) : null}

          <div className="field">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              className="input"
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'signin-error' : undefined}
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="password">
              Password
            </label>
            {/*
             * A password typed on a tablet, one-handed, in a kitchen is mistyped often
             * enough that "Incorrect email or password" is usually a typo rather than the
             * wrong password - and the one generic failure message cannot say which. The
             * eye is how someone checks before submitting.
             *
             * The button is 44px wide inside the field, so it clears the tap floor, and
             * the input gains matching right padding so the text never runs under it.
             */}
            <div className="relative">
              <input
                className="input pr-tap"
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={error ? 'signin-error' : undefined}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 w-tap flex items-center justify-center text-navy bg-transparent border-0 cursor-pointer"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-pressed={showPassword}
                // The label names the ACTION, and the icon draws the same action, so the
                // two cannot contradict each other in a screen reader and on screen.
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d={EYE} />
                  {showPassword ? (
                    <path d="M3.5 3.5 16.5 16.5" stroke="currentColor" strokeWidth="2" fill="none" />
                  ) : null}
                </svg>
              </button>
            </div>
          </div>

          <button className="btn btn--block" type="submit" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </main>
    </>
  );
}
