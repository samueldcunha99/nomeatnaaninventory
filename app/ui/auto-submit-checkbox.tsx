'use client';
import { useTranslations } from '../i18n/provider.tsx';

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
  const t = useTranslations();
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
      {t(label)}
    </label>
  );
}
