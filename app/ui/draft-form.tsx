'use client';

import { useEffect, useRef, type ComponentPropsWithRef } from 'react';

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type SavedField = { element: Field; value: string; checked?: boolean; selected?: string[] };

/** React resets uncontrolled forms after an action returns, including validation errors. */
export function DraftForm({ result, onSubmitCapture, ...props }: ComponentPropsWithRef<'form'> & {
  result: { error: string | null };
}) {
  const draft = useRef<SavedField[]>([]);
  useEffect(() => {
    if (result.error) for (const saved of draft.current) {
      if (!saved.element.isConnected) continue;
      if (saved.element instanceof HTMLInputElement && saved.checked !== undefined) saved.element.checked = saved.checked;
      else if (saved.element instanceof HTMLSelectElement && saved.selected) {
        for (const option of saved.element.options) option.selected = saved.selected.includes(option.value);
      } else saved.element.value = saved.value;
    }
    draft.current = [];
  }, [result]);
  return <form {...props} onSubmitCapture={event => {
    draft.current = Array.from(event.currentTarget.elements).flatMap(element => {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) return [];
      // Authentication fields and server-controlled identities must never be retained.
      if (!element.name || (element instanceof HTMLInputElement && ['password', 'hidden', 'file', 'submit', 'button', 'reset'].includes(element.type))) return [];
      return [{ element, value: element.value,
        ...(element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type) ? { checked: element.checked } : {}),
        ...(element instanceof HTMLSelectElement ? { selected: [...element.selectedOptions].map(option => option.value) } : {}) }];
    });
    onSubmitCapture?.(event);
  }} />;
}
