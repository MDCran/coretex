// @ts-nocheck
import { TaxClient } from './tax-client';
import { useLifeOSQuery } from '../../personal/use-lifeos-query';
import { QueryBoundary } from '../../personal/personal-ui';

export default function TaxPage({ client }) {
    const query = useLifeOSQuery(client, 'financial:getTax');
    return (
        <QueryBoundary loading={query.loading} error={query.error} onRetry={query.refresh}>
            {query.data && <TaxClient client={client} {...query.data} />}
        </QueryBoundary>
    );
}
