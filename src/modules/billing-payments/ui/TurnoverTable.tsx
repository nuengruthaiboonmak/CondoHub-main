import { Badge, DataTable, DataTableCell, DataTableRow } from '@/shared/ui';
import type { TurnoverReviewDto } from '@/modules/billing-payments/application/index';
import {
  turnoverStateLabel,
  turnoverStateVariant,
} from '@/modules/billing-payments/ui/billingLabels';

export function TurnoverTable({
  rows,
  roomNames,
  basePath,
  prefix,
  caption,
  showMode,
}: {
  rows: TurnoverReviewDto[];
  roomNames: Map<string, string>;
  basePath: string;
  prefix: 'owner-turnover-review' | 'turnover-review';
  caption: string;
  showMode: boolean;
}) {
  return (
    <DataTable
      testId={`${prefix}-list`}
      caption={caption}
      columns={[
        { key: 'review', header: 'Review' },
        ...(showMode ? [{ key: 'mode', header: 'Mode' }] : []),
        { key: 'state', header: 'State' },
        { key: 'candidates', header: 'Candidates', numeric: true },
        { key: 'version', header: 'Version', numeric: true },
      ]}
    >
      {rows.map((row) => (
        <DataTableRow key={row.id} rowKey={row.id}>
          <DataTableCell link href={`${basePath}/${row.id}`} linkTestId={`${prefix}-row-${row.id}`}>
            {roomNames.get(row.roomId) ?? row.roomId} · {row.calendarMonth}
          </DataTableCell>
          {showMode ? (
            <DataTableCell>
              <span>
                {row.managementModeAtCreation === 'PROJECT_MANAGED' ? 'Project-managed' : 'Private'}
              </span>
            </DataTableCell>
          ) : null}
          <DataTableCell>
            <span className="inline-flex flex-wrap items-center gap-2">
              <Badge
                data-testid={`${prefix}-state-${row.id}`}
                variant={turnoverStateVariant(row.state)}
              >
                {turnoverStateLabel(row.state)}
              </Badge>
              {row.blocked ? (
                <span
                  data-testid={`${prefix}-blocked-${row.id}`}
                  className="text-small font-medium text-danger-foreground"
                >
                  Blocked
                </span>
              ) : null}
            </span>
          </DataTableCell>
          <DataTableCell numeric>
            <span className="ui-tabular">{row.candidateTenancyIds.length} candidate tenancies</span>
          </DataTableCell>
          <DataTableCell numeric>
            <span className="ui-tabular">Version {row.version}</span>
          </DataTableCell>
        </DataTableRow>
      ))}
    </DataTable>
  );
}
