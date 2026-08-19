'use client';

import { useActionState } from 'react';
import { loginAction } from './actions.ts';

export default function LoginPage() {
  const [error, formAction, pending] = useActionState(loginAction, null);

  return (
    <main style={{ maxWidth: 320 }}>
      <h1>Sign in</h1>
      <form action={formAction}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required style={{ display: 'block', width: '100%', marginBottom: 12 }} />

        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required style={{ display: 'block', width: '100%', marginBottom: 12 }} />

        {error ? (
          <p role="alert" style={{ color: '#b00' }}>
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={pending}>
          {pending ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
