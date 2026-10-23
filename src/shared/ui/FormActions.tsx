import type { ReactNode } from 'react';
import { Button } from './Button';

export function FormActions({
  children,
  onCancel,
  pending = false,
  cancelTestId,
}: {
  children: ReactNode;
  onCancel?: (() => void) | undefined;
  pending?: boolean;
  cancelTestId?: string | undefined;
}) {
  return (
    <div
      data-ui-form-actions
      className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-5 [&>button]:min-h-10 [&>button]:max-w-full"
    >
      {onCancel ? (
        <Button
          variant="secondary"
          disabled={pending}
          data-testid={cancelTestId}
          onClick={onCancel}
        >
          Cancel
        </Button>
      ) : null}
      {children}
    </div>
  );
}
