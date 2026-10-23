export const PROJECT_TIMEZONE = process.env.PROJECT_TIMEZONE ?? 'Asia/Bangkok';

export const PROJECT_CURRENCY = 'THB' as const;

export type ProjectCurrency = typeof PROJECT_CURRENCY;

export const PROJECT_PAYEE_ID = '00000000-0000-4000-8000-000000000001';
