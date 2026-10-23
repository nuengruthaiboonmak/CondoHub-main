'use client';

import type { ReactNode } from 'react';
import { Dialog } from './Dialog';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
  className?: string;
}

export function Sheet({ footer, ...props }: SheetProps) {
  return <Dialog {...props} actions={footer} presentation="sheet" />;
}
