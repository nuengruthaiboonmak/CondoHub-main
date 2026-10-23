import { Children, cloneElement, isValidElement, type ReactNode } from 'react';
import { cx } from './cx';
import { TableFrame } from './TableFrame';

export interface DataTableColumn {
  key: string;
  header: string;
  numeric?: boolean;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  truncate?: boolean;
}

export interface DataTableProps {
  columns: DataTableColumn[];
  testId?: string;
  caption?: string;
  emptyState?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function DataTable({
  columns,
  testId,
  caption,
  emptyState,
  className,
  children,
}: DataTableProps) {
  if (Children.toArray(children).length === 0 && emptyState !== undefined) {
    return <div data-testid={testId}>{emptyState}</div>;
  }

  const rows = Children.map(children, (row) => {
    if (!isValidElement<DataTableRowProps>(row) || row.type !== DataTableRow) return row;
    return cloneElement(row, {
      children: Children.map(row.props.children, (cell, index) =>
        isValidElement<DataTableCellProps>(cell) && cell.type === DataTableCell
          ? cloneElement(cell, {
              label: columns[index]?.header,
              truncate: columns[index]?.truncate,
            })
          : cell,
      ),
    });
  });

  return (
    <TableFrame
      key={columns.map((column) => column.key).join(':')}
      columns={columns}
      testId={testId}
      caption={caption}
      className={className}
    >
      {rows}
    </TableFrame>
  );
}

export interface DataTableRowProps {
  rowKey: string;
  onClick?: () => void;
  children: ReactNode;
}

export function DataTableRow({ rowKey, onClick, children }: DataTableRowProps) {
  return (
    <tr
      role="row"
      data-row-key={rowKey}
      onClick={onClick}
      className={cx(
        'border-b border-border transition-[background-color] duration-fast ease-out last:border-b-0 hover:bg-secondary/50 motion-reduce:transition-none @max-2xl/table:grid @max-2xl/table:grid-cols-2 @max-2xl/table:gap-x-4 @max-2xl/table:px-5 @max-2xl/table:py-3',
        onClick !== undefined && 'cursor-pointer',
      )}
    >
      {children}
    </tr>
  );
}

export interface DataTableCellProps {
  label?: string | undefined;
  numeric?: boolean;
  link?: boolean;
  href?: string;
  linkTestId?: string;
  truncate?: boolean | undefined;
  children: ReactNode;
}

export function DataTableCell({
  label,
  numeric = false,
  link = false,
  href,
  linkTestId,
  truncate,
  children,
}: DataTableCellProps) {
  const shouldTruncate = truncate ?? (typeof children === 'string' || typeof children === 'number');
  return (
    <td
      role="cell"
      className={cx(
        'overflow-hidden px-4 py-4 text-body leading-body whitespace-nowrap text-body-secondary @max-2xl/table:min-w-0 @max-2xl/table:px-0 @max-2xl/table:py-2 @max-2xl/table:whitespace-normal @max-2xl/table:text-left @max-2xl/table:last:col-span-full',
        numeric && 'text-right tabular-nums',
      )}
    >
      {label ? (
        <span className="mb-1 hidden text-caption font-medium text-muted-foreground @max-2xl/table:block">
          {label}
        </span>
      ) : null}
      <div
        title={
          shouldTruncate && (typeof children === 'string' || typeof children === 'number')
            ? String(children)
            : undefined
        }
        className={cx(
          'min-w-0 @max-2xl/table:[overflow-wrap:anywhere]',
          shouldTruncate && 'truncate @max-2xl/table:whitespace-normal',
        )}
      >
        {link && href !== undefined ? (
          <a
            data-testid={linkTestId}
            href={href}
            className="rounded-lg font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {children}
          </a>
        ) : (
          children
        )}
      </div>
    </td>
  );
}
