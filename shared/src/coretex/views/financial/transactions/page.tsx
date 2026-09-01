// @ts-nocheck
import { TransactionsClient } from './transactions-client';
import { useLifeOSQuery } from '../../personal/use-lifeos-query';
import { QueryBoundary } from '../../personal/personal-ui';
import { useState } from 'react';

export default function TransactionsPage({ client }) {
    const pageSize = 500;
    const [offset, setOffset] = useState(0);
    const query = useLifeOSQuery(client, 'financial:getTransactions', { offset, limit: pageSize });
    return (
        <QueryBoundary loading={query.loading} error={query.error} onRetry={query.refresh}>
            {query.data && (
                <TransactionsClient
                    client={client}
                    {...query.data}
                    onPageChange={(nextOffset) => setOffset(Math.max(0, nextOffset))}
                />
            )}
        </QueryBoundary>
    );
}
