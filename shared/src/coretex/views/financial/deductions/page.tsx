// @ts-nocheck
import { useMemo, useState } from 'react';
import { DeductionsClient } from './deductions-client';
import { useLifeOSQuery } from '../../personal/use-lifeos-query';
import { QueryBoundary } from '../../personal/personal-ui';

export default function DeductionsPage({ client }) {
    const [year, setYear] = useState<number | null>(null);
    const payload = useMemo(() => (year ? { year } : undefined), [year]);
    const query = useLifeOSQuery(client, 'financial:getDeductions', payload);
    return (
        <QueryBoundary loading={query.loading} error={query.error} onRetry={query.refresh}>
            {query.data && <DeductionsClient client={client} {...query.data} onYearChange={setYear} />}
        </QueryBoundary>
    );
}
