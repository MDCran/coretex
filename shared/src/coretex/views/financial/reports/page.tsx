// @ts-nocheck
import { ReportsClient } from './reports-client';
import { useLifeOSQuery } from '../../personal/use-lifeos-query';
import { QueryBoundary } from '../../personal/personal-ui';

export default function ReportsPage({ client }) {
    const query = useLifeOSQuery(client, 'financial:getReports');
    return (
        <QueryBoundary loading={query.loading} error={query.error} onRetry={query.refresh}>
            {query.data && <ReportsClient client={client} rows={query.data.transactions} monthly={query.data.monthly} />}
        </QueryBoundary>
    );
}
