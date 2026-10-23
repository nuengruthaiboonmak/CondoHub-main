import 'server-only';
import type { Db } from '@/shared/db/transaction';
import { listAttachedImages } from '../infrastructure/imageRepository';

export interface AttachedImageDto {
  id: string;
  sizeBytes: number;
  mime: string;
  width: number | null;
  height: number | null;
}

export async function listAttachedImagesForEntity(
  conn: Db,
  owner: { type: string; id: string },
): Promise<AttachedImageDto[]> {
  const rows = await listAttachedImages(conn, owner);
  return rows.map((row) => ({
    id: row.id,
    sizeBytes: row.sizeBytes,
    mime: row.mime,
    width: row.width,
    height: row.height,
  }));
}
