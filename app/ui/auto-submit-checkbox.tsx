'use client';

export function AutoSubmitCheckbox({
  name,
  value,
  defaultChecked,
  label,
  className,
}: {
  name: string;
  value: string;
  defaultChecked?: boolean;
  label: string;
  className?: string;
}) {
  return (
    <label className={className ?? 'checkfield'}>
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="size-5"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      />
      {label}
    </label>
  );
}
