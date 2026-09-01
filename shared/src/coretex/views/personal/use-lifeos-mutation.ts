import { useCallback, useState } from "react";
import { requestLiveRefresh } from "@/hooks/use-live-refresh";
import type { LifeOSClient } from "./use-lifeos-query";

let mutationSequence = 0;

export interface LifeOSMutationState {
    mutate: <T = unknown>(payload?: Record<string, unknown>) => Promise<T>;
    pending: boolean;
    error: string | null;
}

/** Small request/response helper for allow-listed LifeOS mutations. */
export function useLifeOSMutation(client: LifeOSClient, type: string): LifeOSMutationState {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const mutate = useCallback(<T,>(payload: Record<string, unknown> = {}) => {
        const requestId = `lifeos_mutation_${Date.now()}_${++mutationSequence}`;
        setPending(true);
        setError(null);

        return new Promise<T>((resolve, reject) => {
            const finish = (failure?: Error, value?: T) => {
                window.clearTimeout(timeout);
                client.offMessage(onMessage);
                setPending(false);
                if (failure) {
                    setError(failure.message);
                    reject(failure);
                    return;
                }
                requestLiveRefresh();
                resolve(value as T);
            };
            const onMessage = (message: any) => {
                if (!message || message.type !== type || message.requestId !== requestId) return;
                if (message.error) finish(new Error(String(message.error)));
                else finish(undefined, message.result as T);
            };
            const timeout = window.setTimeout(() => finish(new Error("The operation timed out. Check the local Coretex service.")), 15_000);
            client.onMessage(onMessage);
            if (!client.send({ type, requestId, payload })) {
                finish(new Error("The Coretex service is offline."));
            }
        });
    }, [client, type]);

    return { mutate, pending, error };
}
