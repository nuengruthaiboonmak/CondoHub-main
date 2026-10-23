'use client';

import { useRef, useState, type ReactNode } from 'react';
import type { DataTableColumn } from './DataTable';
import { cx } from './cx';

export function TableFrame({
  columns,
  testId,
  caption,
  className,
  children,
}: {
  columns: DataTableColumn[];
  testId?: string | undefined;
  caption?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  const [widths, setWidths] = useState<number[] | null>(null);
  const headRef = useRef<HTMLTableRowElement>(null);
  const drag = useRef<{ index: number; start: number; widths: number[] } | null>(null);
  const defaults = columns.map((column) => column.width ?? 200);
  const total = (widths ?? defaults).reduce((sum, width) => sum + width, 0);
  function resize(index: number, next: number, base: number[]) {
    const column = columns[index];
    if (!column) return;
    setWidths(
      base.map((width, cell) =>
        cell === index
          ? Math.max(column.minWidth ?? 100, Math.min(column.maxWidth ?? 640, next))
          : width,
      ),
    );
  }
  function measuredWidths() {
    return Array.from(headRef.current?.cells ?? []).map(
      (cell) => cell.getBoundingClientRect().width,
    );
  }
  return (
    <div
      data-testid={testId}
      className={cx(
        '@container/table min-w-0 overflow-x-auto rounded-xl border border-border bg-surface',
        className,
      )}
    >
      <table
        role="table"
        style={{ width: widths ? total : '100%' }}
        className="min-w-full table-fixed border-collapse text-body @max-2xl/table:!w-full @max-2xl/table:block"
      >
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <colgroup className="@max-2xl/table:hidden">
          {columns.map((column, index) => (
            <col
              key={column.key}
              style={{
                width: widths ? widths[index] : `${((defaults[index] ?? 200) / total) * 100}%`,
              }}
            />
          ))}
        </colgroup>
        <thead
          role="rowgroup"
          className="sticky top-0 z-[var(--ui-z-sticky)] bg-background @max-2xl/table:hidden"
        >
          <tr ref={headRef} role="row">
            {columns.map((column, index) => (
              <th
                key={column.key}
                scope="col"
                aria-label={column.header}
                className={cx(
                  'relative border-b border-border px-4 py-3.5 text-caption font-semibold text-body-secondary',
                  column.numeric ? 'text-right' : 'text-left',
                )}
              >
                <span className="block truncate">{column.header}</span>
                <button
                  type="button"
                  role="separator"
                  aria-orientation="vertical"
                  title="Drag to resize. Use arrow keys to adjust, or Home to reset."
                  aria-label={`Resize ${column.header} column`}
                  aria-valuemin={column.minWidth ?? 100}
                  aria-valuemax={column.maxWidth ?? 640}
                  aria-valuenow={Math.round(widths?.[index] ?? defaults[index] ?? 200)}
                  data-testid={testId ? `${testId}-resize-${column.key}` : undefined}
                  className="absolute inset-y-0 -right-1 z-10 w-3 touch-none cursor-col-resize border-0 bg-transparent after:absolute after:inset-y-3 after:left-1/2 after:w-px after:bg-border-strong hover:after:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    const base = measuredWidths();
                    drag.current = { index, start: event.clientX, widths: base };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    const current = drag.current;
                    if (current?.index === index)
                      resize(
                        index,
                        (current.widths[index] ?? 200) + event.clientX - current.start,
                        current.widths,
                      );
                  }}
                  onPointerUp={() => {
                    drag.current = null;
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                  }}
                  onLostPointerCapture={() => {
                    drag.current = null;
                  }}
                  onDoubleClick={() => setWidths(null)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                      event.preventDefault();
                      const base = measuredWidths();
                      resize(
                        index,
                        (base[index] ?? 200) + (event.key === 'ArrowRight' ? 16 : -16),
                        base,
                      );
                    } else if (event.key === 'Home') {
                      event.preventDefault();
                      setWidths(null);
                    }
                  }}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" className="@max-2xl/table:block">
          {children}
        </tbody>
      </table>
    </div>
  );
}
