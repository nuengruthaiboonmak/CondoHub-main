import type { ImageState } from './imageState';
import type { ImageScope } from '@/shared/storage/objectKeys';

export interface AttachCandidate {
  id: string;
  state: ImageState;
  scope: ImageScope;
  uploadedBy: string;
  ownerEntityType: string | null;
  ownerEntityId: string | null;
}

export interface AttachValidationInput {
  scope: ImageScope;
  entityRef: { type: string; id: string };
  ownerUserId: string;
  maxCount: number;
}

export function validateAttachable(
  requestedIds: string[],
  found: AttachCandidate[],
  input: AttachValidationInput,
): string | null {
  const uniqueIds = [...new Set(requestedIds)];
  if (uniqueIds.length !== requestedIds.length) {
    return 'Duplicate image ids are not allowed.';
  }
  if (uniqueIds.length > input.maxCount) {
    return `Too many images. The maximum is ${input.maxCount}.`;
  }
  if (uniqueIds.length === 0) return null;
  if (found.length !== uniqueIds.length) {
    return 'One or more images were not found.';
  }
  for (const image of found) {
    if (image.state !== 'READY') {
      return 'Only verified images can be attached.';
    }
    if (image.scope !== input.scope) {
      return 'The image scope does not match.';
    }
    if (image.uploadedBy !== input.ownerUserId) {
      return 'Only your own images can be attached.';
    }
    const sameEntity =
      image.ownerEntityType === input.entityRef.type && image.ownerEntityId === input.entityRef.id;
    if (image.ownerEntityType !== null && !sameEntity) {
      return 'This image is already attached to another record.';
    }
  }
  return null;
}
