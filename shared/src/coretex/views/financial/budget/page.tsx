// @ts-nocheck
import { BudgetClient } from './budget-client';
import { useLifeOSQuery } from '../../personal/use-lifeos-query';
import { QueryBoundary } from '../../personal/personal-ui';

export default function BudgetPage({ client, onNavigateTab }) {
    const query = useLifeOSQuery(client, 'financial:getBudget');
    return (
        <QueryBoundary loading={query.loading} error={query.error} onRetry={query.refresh}>
            {query.data && <BudgetClient client={client} onNavigateTab={onNavigateTab} {...query.data} />}
        </QueryBoundary>
    );
}
