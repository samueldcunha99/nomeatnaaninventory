'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

export type IngredientChoice = {
  id: string;
  name: string;
  /** Muted tag in the option row — "recipe", say — when the name alone is ambiguous. */
  hint?: string;
};

/**
 * Type-to-filter picker. Ingredients on the receipt form; ingredients AND sub-recipes on
 * the recipe editor, which is why the options are a plain id/name list and the word for
 * what is being picked is a prop.
 *
 * A native `<select>` with 37 options means scrolling a long list with a thumb during a
 * rush. A native `<datalist>` fixes the typing but its popup is browser chrome — a black
 * full-height overlay that cannot be styled at all — so the list is rendered here instead.
 *
 * Hand-rolled listbox, so the ARIA has to be right rather than inherited:
 *   input  role=combobox, aria-expanded, aria-controls, aria-activedescendant
 *   list   role=listbox, options role=option with aria-selected
 *   keys   ArrowUp/Down to move, Enter to choose, Escape to close, Tab to leave
 *
 * **The submitted value is unchanged.** The visible input holds the ingredient *name* and
 * is never submitted; a hidden field carries the id under the field name the server action
 * already expects.
 */
export function IngredientCombobox({
  fieldName,
  options,
  value,
  text,
  onChange,
  ariaLabel,
  noun = 'ingredient',
  placeholder = 'Type to search…',
}: {
  /** Form field name for the hidden id, e.g. `lines[0][ingredientId]`. */
  fieldName: string;
  options: IngredientChoice[];
  /** Resolved id, or '' when the text matches nothing. */
  value: string;
  /** What the operator has typed. */
  text: string;
  onChange: (next: { id: string; text: string }) => void;
  ariaLabel: string;
  /** What the operator is picking, for the two messages that have to say it. */
  noun?: string;
  placeholder?: string;
}) {
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const query = text.trim().toLowerCase();
  const matches = query
    ? options.filter((i) => i.name.toLowerCase().includes(query))
    : options;

  /*
   * Fixed positioning, not absolute. The list lives inside `.table-wrap`, which sets
   * overflow-x for narrow viewports and would clip a dropdown escaping the cell. Anchoring
   * to the input's viewport rect sidesteps the clipping entirely.
   */
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const place = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom + 4, width: r.width });
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    // Reposition rather than drift if anything moves under it.
    const onMove = () => place();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  // Keep the highlighted option in view when arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`#${CSS.escape(optionId(active))}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (choice: IngredientChoice) => {
    onChange({ id: choice.id, text: choice.name });
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      setActive((a) => {
        const next = e.key === 'ArrowDown' ? a + 1 : a - 1;
        return Math.max(0, Math.min(matches.length - 1, next));
      });
      return;
    }
    if (e.key === 'Enter' && open && matches[active]) {
      e.preventDefault(); // do not submit the receipt while picking an ingredient
      choose(matches[active]);
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'Tab') setOpen(false);
  };

  // Typed something that matches nothing. Blank is not an error — it is an unused row.
  const unresolved = text.trim() !== '' && value === '';

  return (
    <div className="relative">
      <input type="hidden" name={fieldName} value={value} />

      <input
        ref={inputRef}
        className="input min-w-44"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? optionId(active) : undefined}
        aria-label={ariaLabel}
        aria-invalid={unresolved || undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const typed = e.target.value;
          const hit = options.find((i) => i.name.toLowerCase() === typed.trim().toLowerCase());
          onChange({ id: hit?.id ?? '', text: typed });
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        // A click lands before blur, so closing on blur would cancel the choice. The
        // option list uses onMouseDown, which fires first; this delay covers touch.
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
      />

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="combo-list"
          style={rect ? { left: rect.left, top: rect.top, width: Math.max(rect.width, 240) } : undefined}
        >
          {matches.length === 0 ? (
            <li className="combo-empty">No {noun} matches “{text.trim()}”</li>
          ) : (
            matches.map((m, i) => (
              <li
                key={m.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                className={`combo-option ${i === active ? 'combo-option--active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus on the input
                  choose(m);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {m.name}
                {m.hint ? <span className="ml-2 text-xs muted">{m.hint}</span> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}

      {unresolved ? (
        <span className="block text-xs text-danger font-semibold mt-1">No such {noun}</span>
      ) : null}
    </div>
  );
}
