'use client';

import { Component } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Button } from '@/shared/ui/Button';

export interface ApiError {
  code: string;
  message: string;
}

interface BoundaryProps {
  children: ReactNode;
}

interface BoundaryState {
  error: ApiError | null;
}

function toApiError(value: unknown): ApiError | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const nested = record.error;
  if (typeof nested === 'object' && nested !== null) {
    const nestedRecord = nested as Record<string, unknown>;
    if (typeof nestedRecord.code === 'string') {
      return {
        code: nestedRecord.code,
        message: typeof nestedRecord.message === 'string' ? nestedRecord.message : 'Something went wrong.',
      };
    }
  }
  if (typeof record.code === 'string') {
    return {
      code: record.code,
      message: typeof record.message === 'string' ? record.message : 'Something went wrong.',
    };
  }
  return null;
}

function ErrorView({ error, onReset }: { error: ApiError; onReset: () => void }) {
  const router = useRouter();
  if (error.code === 'AUTH_REQUIRED') {
    router.push('/login');
    return null;
  }
  if (error.code === 'FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED') {
    router.push('/change-password');
    return null;
  }
  if (error.code === 'ROOM_ACCESS_REVOKED') {
    return (
      <EmptyState
        title="Room access revoked"
        description="Your access to this room was revoked. Your other rooms still work."
        action={<Button onClick={() => router.push('/')}>Back to home</Button>}
      />
    );
  }
  if (error.code === 'ACCESS_DENIED') {
    return (
      <EmptyState
        title="Access denied"
        description="You do not have permission to view this."
        action={<Button onClick={() => router.push('/')}>Back to home</Button>}
      />
    );
  }
  return (
    <EmptyState
      title="Something went wrong"
      description={error.message}
      action={<Button onClick={onReset}>Try again</Button>}
    />
  );
}

export class ApiErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: toApiError(error) ?? { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } };
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error !== null) {
      return <ErrorView error={this.state.error} onReset={this.reset} />;
    }
    return this.props.children;
  }
}
