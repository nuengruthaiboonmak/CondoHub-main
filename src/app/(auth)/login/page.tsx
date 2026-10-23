import { Suspense } from 'react';
import LoginForm from '@/modules/identity-access/ui/LoginForm';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
