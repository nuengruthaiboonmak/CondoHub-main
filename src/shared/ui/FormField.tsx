import { cloneElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { cx } from './cx';

export interface FormFieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactElement;
  testId?: string;
  className?: string;
  errorTestId?: string;
}

export function FormField({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  children,
  testId,
  className,
  errorTestId,
}: FormFieldProps) {
  const fieldId = htmlFor ?? testId;
  const hintId = hint && fieldId ? `${fieldId}-hint` : undefined;
  const errorId = error && fieldId ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, error ? (errorId ?? undefined) : undefined]
    .filter(Boolean)
    .join(' ');

  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: fieldId ?? (children as ReactElement<Record<string, unknown>>).props.id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy.length > 0 ? describedBy : undefined,
      })
    : (children as ReactNode);

  return (
    <div data-testid={testId} className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={fieldId} className="text-body leading-body font-medium text-foreground">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-1 text-danger-foreground">
            *
          </span>
        ) : null}
      </label>
      {control}
      {hint ? (
        <p id={hintId} className="text-small leading-small text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          role="alert"
          data-testid={errorTestId ?? (fieldId ? `${fieldId}-error` : undefined)}
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
