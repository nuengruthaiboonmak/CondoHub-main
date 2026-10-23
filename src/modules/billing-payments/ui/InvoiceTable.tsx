import { Badge, DataTable, DataTableCell, DataTableRow } from '@/shared/ui';
import type { InvoiceDto } from '@/modules/billing-payments/application/index';
import {
  invoiceStateLabel,
  invoiceStateVariant,
  kindLabel,
} from '@/modules/billing-payments/ui/billingLabels';

export function InvoiceTable({
  rows,
  basePath,
  caption,
  roomLabels,
  tenancyLabels,
}: {
  rows: InvoiceDto[];
  basePath: string;
  caption: string;
  roomLabels?: Record<string, string>;
  tenancyLabels?: Record<string, string>;
}) {
  return (
    <DataTable
      testId="invoice-list"
      caption={caption}
      columns={[
        { key: 'invoice', header: 'Invoice', width: 320 },
        { key: 'state', header: 'State', width: 140 },
        { key: 'total', header: 'Total', width: 160 },
        { key: 'outstanding', header: 'Outstanding', width: 160 },
        { key: 'due', header: 'Due', width: 200 },
      ]}
    >
      {rows.map((row) => (
        <DataTableRow key={row.id} rowKey={row.id}>
          <DataTableCell link href={`${basePath}/${row.id}`} linkTestId={`invoice-row-${row.id}`}>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="truncate" title={kindLabel(row.kind)}>
                {kindLabel(row.kind)}
              </span>
              <span className="text-small font-normal text-body-secondary">{row.periodStart}</span>
              <span
                title={roomLabels?.[row.roomId]}
                className="line-clamp-2 whitespace-normal break-words text-small font-normal text-muted-foreground"
              >
                {roomLabels?.[row.roomId] ?? 'Room unavailable'}
              </span>
              {row.tenancyId && tenancyLabels?.[row.tenancyId] ? (
                <span
                  data-testid={`invoice-tenancy-${row.id}`}
                  className="whitespace-normal break-words text-small font-normal text-body-secondary"
                >
                  Rental period: {tenancyLabels[row.tenancyId]}
                </span>
              ) : null}
            </span>
          </DataTableCell>
          <DataTableCell>
            <Badge data-testid={`invoice-state-${row.id}`} variant={invoiceStateVariant(row.state)}>
              {invoiceStateLabel(row.state)}
            </Badge>
          </DataTableCell>
          <DataTableCell>
            <span data-testid={`invoice-total-${row.id}`} className="ui-tabular">
              {row.total.amount} {row.total.currency}
            </span>
          </DataTableCell>
          <DataTableCell>
            <span data-testid={`invoice-outstanding-${row.id}`} className="ui-tabular">
              {row.outstanding.amount} {row.outstanding.currency}
            </span>
          </DataTableCell>
          <DataTableCell>
            <span className="ui-tabular">
              Due {row.dueDate}
              {row.overdue ? ' · Overdue' : ''}
            </span>
          </DataTableCell>
        </DataTableRow>
      ))}
    </DataTable>
  );
}
