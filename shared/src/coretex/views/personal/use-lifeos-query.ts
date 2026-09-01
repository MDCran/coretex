import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LIVE_REFRESH_EVENT } from "@/hooks/use-live-refresh";

export interface LifeOSClient {
    send(command: Record<string, unknown>): boolean;
    onMessage(handler: (message: any) => void): void;
    offMessage(handler: (message: any) => void): void;
}

export interface LifeOSQueryState<T> {
    data: T | null;
    loading: boolean;
    error: string | null;
    refresh: () => void;
}

let requestSequence = 0;

/** Request/response bridge for Electron-native LifeOS screens. */
export function useLifeOSQuery<T>(client: LifeOSClient, type: string, payload?: Record<string, unknown>): LifeOSQueryState<T> {
    const payloadKey = useMemo(() => JSON.stringify(payload ?? {}), [payload]);
    const queryKey = `${type}:${payloadKey}`;
    const [data, setData] = useState<T | null>(null);
    const [dataKey, setDataKey] = useState("");
    const [loading, setLoading] = useState(true);
    const [loadingKey, setLoadingKey] = useState(queryKey);
    const [error, setError] = useState<string | null>(null);
    const [errorKey, setErrorKey] = useState(queryKey);
    const requestId = useRef<string>("");
    const timeoutId = useRef<number | null>(null);

    const refresh = useCallback(() => {
        const nextId = `lifeos_${Date.now()}_${++requestSequence}`;
        requestId.current = nextId;
        if (timeoutId.current !== null) window.clearTimeout(timeoutId.current);
        setLoadingKey(queryKey);
        setLoading(true);
        setErrorKey(queryKey);
        setError(null);
        const sent = client.send({ type, requestId: nextId, ...(payload ? { payload } : {}) });
        if (!sent) {
            setLoading(false);
            setErrorKey(queryKey);
            setError("The Coretex service is offline. Start the local Brain and try again.");
            return;
        }
        timeoutId.current = window.setTimeout(() => {
            setLoading(false);
            setErrorKey(queryKey);
            setError("The local Coretex service did not answer this request. Try again.");
        }, 15_000);
    }, [client, type, payloadKey, queryKey]);

    useEffect(() => {
        const onMessage = (message: any) => {
            if (!message || message.type !== type) return;
            if (message.requestId && message.requestId !== requestId.current) return;
            if (message.error) {
                if (timeoutId.current !== null) window.clearTimeout(timeoutId.current);
                setErrorKey(queryKey);
                setError(String(message.error));
                setLoadingKey(queryKey);
                setLoading(false);
                return;
            }
            if (Object.prototype.hasOwnProperty.call(message, "result")) {
                if (timeoutId.current !== null) window.clearTimeout(timeoutId.current);
                setData(message.result as T);
                setDataKey(queryKey);
                setErrorKey(queryKey);
                setError(null);
                setLoadingKey(queryKey);
                setLoading(false);
            }
        };

        client.onMessage(onMessage);
        refresh();
        window.addEventListener(LIVE_REFRESH_EVENT, refresh);
        return () => {
            if (timeoutId.current !== null) window.clearTimeout(timeoutId.current);
            client.offMessage(onMessage);
            window.removeEventListener(LIVE_REFRESH_EVENT, refresh);
        };
    }, [client, type, payloadKey, refresh]);

    return {
        data: dataKey === queryKey ? data : null,
        loading: loadingKey === queryKey ? loading : true,
        error: errorKey === queryKey ? error : null,
        refresh,
    };
}
