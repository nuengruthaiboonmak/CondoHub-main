'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button, type ButtonVariant } from './Button';
import { Dialog, type DialogSize } from './Dialog';

interface FormDialogContextValue {
  complete: () => void;
  requestClose: () => void;
  setPending: (pending: boolean) => void;
  markDirty: () => void;
}

const FormDialogContext = createContext<FormDialogContextValue | null>(null);

export function useFormDialog(pending = false) {
  const context = useContext(FormDialogContext);
  const setPending = context?.setPending;
  useEffect(() => {
    setPending?.(pending);
    return () => setPending?.(false);
  }, [pending, setPending]);
  return context;
}

export function FormDialog({
  triggerLabel,
  title,
  description,
  triggerTestId,
  testId,
  size = 'md',
  variant = 'primary',
  icon = 'plus',
  disabled = false,
  triggerTitle,
  children,
}: {
  triggerLabel: string;
  title: string;
  description?: string;
  triggerTestId: string;
  testId: string;
  size?: DialogSize;
  variant?: ButtonVariant;
  icon?: 'plus' | 'edit' | 'none';
  disabled?: boolean;
  triggerTitle?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const markDirty = useCallback(() => setDirty(true), []);
  const complete = useCallback(() => {
    setOpen(false);
    setDirty(false);
    setPending(false);
    setDiscardOpen(false);
  }, []);
  const requestClose = useCallback(() => {
    if (pending) return;
    if (dirty) setDiscardOpen(true);
    else complete();
  }, [pending, dirty, complete]);
  const value = useMemo(
    () => ({ complete, requestClose, setPending, markDirty }),
    [complete, requestClose, markDirty],
  );
  return (
    <>
      <Button
        data-testid={triggerTestId}
        disabled={disabled}
        title={triggerTitle}
        variant={variant}
        className="w-fit max-w-full shrink-0"
        onClick={() => setOpen(true)}
      >
        {icon === 'plus' ? (
          <Plus aria-hidden="true" className="size-4" />
        ) : icon === 'edit' ? (
          <Pencil aria-hidden="true" className="size-4" />
        ) : null}
        {triggerLabel}
      </Button>
      <Dialog
        open={open}
        busy={pending}
        onClose={requestClose}
        title={title}
        description={description}
        size={size}
        testId={testId}
      >
        <FormDialogContext.Provider value={value}>
          <div onChangeCapture={markDirty}>{children}</div>
        </FormDialogContext.Provider>
      </Dialog>
      <Dialog
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        title="Discard changes?"
        description="Your unsaved changes will be lost."
        size="sm"
        testId={`${testId}-discard`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDiscardOpen(false)}>
              Keep editing
            </Button>
            <Button variant="destructive" onClick={complete}>
              Discard changes
            </Button>
          </>
        }
      >
        <p className="text-body text-body-secondary">Close this form without saving?</p>
      </Dialog>
    </>
  );
}
