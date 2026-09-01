// @ts-nocheck
import { useEffect } from "react";
const useRouter = () => ({ push: () => {}, replace: () => {} }); const useSearchParams = () => ({ get: () => null });

export function StatusRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
    const router = useRouter();

    useEffect(() => {
        const id = window.setInterval(() => router.refresh(), intervalMs);
        return () => window.clearInterval(id);
    }, [intervalMs, router]);

    return <p className="text-xs text-tertiary">Auto-refreshing every {Math.round(intervalMs / 1000)} seconds.</p>;
}
