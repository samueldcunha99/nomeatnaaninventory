import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfirmedPassword, CurrentPassword, NewPassword, PasswordChange } from './password.ts';

test('new passwords are bounded passphrases and meaningful spaces are preserved', () => {
  assert.equal(NewPassword.safeParse('short').success, false);
  assert.equal(NewPassword.safeParse('a'.repeat(1025)).success, false);
  const phrase = '  three ordinary words  ';
  assert.equal(NewPassword.parse(phrase), phrase);
  assert.equal(NewPassword.safeParse('a'.repeat(1024)).success, true);
  assert.equal(CurrentPassword.safeParse('').success, false);
});

test('both password administration forms require exact confirmation', () => {
  const password = 'a new ordinary passphrase';
  assert.equal(ConfirmedPassword.safeParse({ password, confirmation: password }).success, true);
  assert.equal(ConfirmedPassword.safeParse({ password, confirmation: password + ' ' }).success, false);
  assert.equal(PasswordChange.safeParse({ currentPassword: 'old', password, confirmation: 'different' }).success, false);
  assert.equal(PasswordChange.safeParse({ currentPassword: '', password, confirmation: password }).success, false);
});
