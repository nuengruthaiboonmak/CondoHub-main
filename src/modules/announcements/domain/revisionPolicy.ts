export interface RevisionSnapshotInput {
  title: string;
  body: string;
  publishAt: Date | null;
  imageIds: string[];
  revision: number;
}

export interface RevisionBump {
  nextRevision: number;
  editedAt: Date;
  snapshotVersion: number;
}

export function bumpRevision(currentRevision: number, now: Date): RevisionBump {
  return { nextRevision: currentRevision + 1, editedAt: now, snapshotVersion: currentRevision + 1 };
}

export function snapshotAnnouncement(input: RevisionSnapshotInput): Record<string, unknown> {
  return {
    title: input.title,
    body: input.body,
    publishAt: input.publishAt === null ? null : input.publishAt.toISOString(),
    imageIds: [...input.imageIds],
    revision: input.revision,
  };
}
