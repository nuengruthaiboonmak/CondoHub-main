export const FOCUS_RING_CLASS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export const FOCUS_RING_COMPACT_CLASS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

export const INPUT_CLASS = `h-10 w-full min-w-0 rounded-md border border-input-border bg-input px-3 text-body text-foreground placeholder:text-input-placeholder transition-[border-color] duration-fast ease-out hover:border-border-strong ${FOCUS_RING_COMPACT_CLASS} aria-[invalid=true]:border-danger-foreground disabled:cursor-not-allowed disabled:border-disabled-border disabled:bg-disabled disabled:text-disabled-foreground disabled:hover:border-disabled-border motion-reduce:transition-none`;

export const INPUT_BASE_CLASS = `w-full min-w-0 rounded-md border border-input-border bg-input px-3 text-body text-foreground placeholder:text-input-placeholder transition-[border-color] duration-fast ease-out hover:border-border-strong ${FOCUS_RING_COMPACT_CLASS} aria-[invalid=true]:border-danger-foreground disabled:cursor-not-allowed disabled:border-disabled-border disabled:bg-disabled disabled:text-disabled-foreground disabled:hover:border-disabled-border motion-reduce:transition-none`;

export const TEXTAREA_CLASS = `w-full min-w-0 rounded-md border border-input-border bg-input px-3 py-2 text-body text-foreground placeholder:text-input-placeholder transition-[border-color] duration-fast ease-out hover:border-border-strong ${FOCUS_RING_COMPACT_CLASS} aria-[invalid=true]:border-danger-foreground disabled:cursor-not-allowed disabled:border-disabled-border disabled:bg-disabled disabled:text-disabled-foreground disabled:hover:border-disabled-border motion-reduce:transition-none`;

export const CHECKBOX_CLASS = `size-4 shrink-0 accent-primary ${FOCUS_RING_CLASS}`;

export const FILTER_LINK_BASE = `rounded-md border border-transparent px-3 py-1.5 text-body leading-body font-medium transition-[background-color,color,border-color] duration-fast ease-out ${FOCUS_RING_COMPACT_CLASS} motion-reduce:transition-none`;

export const FILTER_LINK_ACTIVE = 'border-border bg-surface text-foreground shadow-raised';

export const FILTER_LINK_IDLE = 'border-transparent text-body-secondary hover:bg-surface';

export const ACTION_LINK_CLASS = `inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-body leading-body font-medium text-primary-foreground transition-[background-color,transform] duration-fast ease-out hover:bg-primary-hover active:scale-[0.98] ${FOCUS_RING_CLASS} motion-reduce:transition-none motion-reduce:active:scale-100`;

export const ACTION_LINK_SECONDARY_CLASS = `inline-flex h-10 items-center gap-2 rounded-md border border-input-border bg-surface px-4 text-body leading-body font-medium text-secondary-foreground transition-[background-color,color] duration-fast ease-out hover:bg-secondary ${FOCUS_RING_COMPACT_CLASS} motion-reduce:transition-none`;
