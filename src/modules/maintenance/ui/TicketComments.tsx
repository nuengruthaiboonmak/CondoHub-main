'use client';

import { MessageSquareText } from 'lucide-react';
import type { TicketCommentDto } from '@/modules/maintenance/application/index';
import { TicketImage } from '@/modules/maintenance/ui/TicketImage';
import { formatInstant } from '@/modules/maintenance/ui/ticketLabels';

export function TicketComments({
  comments,
  testIdPrefix,
}: {
  comments: TicketCommentDto[];
  testIdPrefix: string;
}) {
  return (
    <section aria-label="Comments" className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <MessageSquareText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="text-heading leading-heading font-semibold text-foreground">Comments ({comments.length})</h2>
      </div>
      {comments.length === 0 ? (
        <p data-testid={`${testIdPrefix}-comments-empty`} className="text-small leading-small text-muted-foreground">
          No comments yet. Updates from the handler appear here.
        </p>
      ) : (
        <ul data-testid={`${testIdPrefix}-comments`} className="flex min-w-0 flex-col">
          {comments.map((comment) => (
            <li
              key={comment.id}
              data-testid={`${testIdPrefix}-comment-${comment.id}`}
              className="flex min-w-0 flex-col gap-2 border-b border-border py-4 last:border-b-0"
            >
              <p data-testid={`${testIdPrefix}-comment-body-${comment.id}`} className="whitespace-pre-wrap break-words text-body leading-body text-foreground">
                {comment.body}
              </p>
              {comment.images.length > 0 ? (
                <ul className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                  {comment.images.map((image, index) => (
                    <li key={image.id} className="min-w-0">
                      <TicketImage
                        imageId={image.id}
                        alt={`Comment photo ${index + 1}`}
                        testId={`${testIdPrefix}-comment-image-${comment.id}-${image.id}`}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="break-all text-xs leading-6 text-muted-foreground">{formatInstant(comment.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
