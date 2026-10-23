export interface FeedOrderKey {
  publishAt: Date;
  id: string;
}

export function compareFeedOrder(left: FeedOrderKey, right: FeedOrderKey): number {
  const byPublishedAt = right.publishAt.getTime() - left.publishAt.getTime();
  if (byPublishedAt !== 0) return byPublishedAt;
  if (left.id < right.id) return 1;
  if (left.id > right.id) return -1;
  return 0;
}

export function sortFeedOrder<T extends FeedOrderKey>(items: T[]): T[] {
  return [...items].sort(compareFeedOrder);
}
