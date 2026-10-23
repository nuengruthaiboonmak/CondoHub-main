"use client";

import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { Dialog } from "./Dialog";
import { cx } from "./cx";

export interface LightboxProps {
  open: boolean;
  onClose: () => void;
  src: string | null;
  alt: string;
  title?: string;
  testId?: string;
}

export function Lightbox({ open, onClose, src, alt, title, testId }: LightboxProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (open) {
      setLoaded(false);
      setFailed(false);
    }
  }, [open, src]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title ?? alt}
      size="lg"
      testId={testId}
    >
      <div className="flex min-h-48 items-center justify-center">
        {!src || failed ? (
          <div
            data-testid={testId ? `${testId}-unavailable` : undefined}
            className="flex flex-col items-center gap-2 py-8 text-center"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
              <ImageOff aria-hidden="true" className="size-6" />
            </span>
            <p className="text-small leading-small text-muted-foreground">Image unavailable</p>
          </div>
        ) : (
          <div className="relative w-full">
            {!loaded ? (
              <div
                role="status"
                aria-label="Loading image"
                className="motion-reduce:animate-none h-48 w-full animate-pulse rounded-lg bg-skeleton"
              />
            ) : null}
            <img
              src={src}
              alt={alt}
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
              data-testid={testId ? `${testId}-image` : undefined}
              className={cx(
                "max-h-[60vh] w-full rounded-lg object-contain",
                loaded ? "block" : "hidden",
              )}
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}
