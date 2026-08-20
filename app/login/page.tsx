'use client';

import { useActionState } from 'react';
import { loginAction } from './actions.ts';

/**
 * Reference implementation for the internal tier. Styling only — the action, the hook
 * and the single generic failure message are unchanged.
 */
export default function LoginPage() {
  const [error, formAction, pending] = useActionState(loginAction, null);

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
            <input
              className="input"
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'signin-error' : undefined}
            />
          </div>

          <button className="btn btn--block" type="submit" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </main>
    </>
  );
}
