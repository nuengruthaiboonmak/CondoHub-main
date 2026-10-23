import type { APIRequestContext } from '@playwright/test';
import { apiJson } from '../../helpers/api';

export interface IntentData {
  imageId: string;
  uploadUrl: string;
  expiresAt: string;
  countCheck: { action: string; used: number; max: number };
}

export interface CompleteData {
  imageId: string;
  state: string;
  scope: string;
  byteSize: number;
  mimeVerified: string;
  width: number | null;
  height: number | null;
}

export async function mintIntent(
  request: APIRequestContext,
  body: { scope: string; entityRef: { type: string; id: string | null }; contentType: string; fileName: string },
): Promise<{ status: number; json: { data: IntentData } }> {
  return apiJson<{ data: IntentData }>(request, {
    method: 'POST',
    path: '/api/images/intents',
    body,
  });
}

export async function putBytes(
  uploadUrl: string,
  contentType: string,
  bytes: Buffer,
): Promise<number> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: new Uint8Array(bytes),
  });
  return response.status;
}

export async function completeUpload(
  request: APIRequestContext,
  imageId: string,
): Promise<{ status: number; json: { data: CompleteData } }> {
  return apiJson<{ data: CompleteData }>(request, {
    method: 'POST',
    path: `/api/images/${imageId}/complete`,
    body: {},
  });
}

export async function readAccess(
  request: APIRequestContext,
  imageId: string,
): Promise<{ status: number; json: { data: { url: string; expiresAt: string } } }> {
  return apiJson<{ data: { url: string; expiresAt: string } }>(request, {
    method: 'GET',
    path: `/api/images/${imageId}/access`,
  });
}
