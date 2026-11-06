import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 1024;

/** Do not trim passwords: spaces are part of the credential the person chose. */
export const NewPassword = z.string()
  .min(PASSWORD_MIN_LENGTH, 'Use at least 12 characters.')
  .max(PASSWORD_MAX_LENGTH, 'Use at most 1024 characters.');

export const CurrentPassword = z.string()
  .min(1, 'Enter your current password.')
  .max(PASSWORD_MAX_LENGTH, 'Use at most 1024 characters.');

export const ConfirmedPassword = z.object({
  password: NewPassword,
  confirmation: z.string().max(PASSWORD_MAX_LENGTH, 'Use at most 1024 characters.'),
}).refine(input => input.password === input.confirmation, {
  message: 'The new passwords do not match.', path: ['confirmation'],
});

export const PasswordChange = z.object({
  currentPassword: CurrentPassword,
  password: NewPassword,
  confirmation: z.string().max(PASSWORD_MAX_LENGTH, 'Use at most 1024 characters.'),
}).refine(input => input.password === input.confirmation, {
  message: 'The new passwords do not match.', path: ['confirmation'],
});
