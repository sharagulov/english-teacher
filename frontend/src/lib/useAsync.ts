import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';
export interface AsyncState<T> {
    data: T | null;
    error: string | null;
    loading: boolean;
    reload: () => void;
    setData: (value: T) => void;
}
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [tick, setTick] = useState(0);
    const runId = useRef(0);
    const loaderRef = useRef(loader);
    loaderRef.current = loader;
    useEffect(() => {
        const current = ++runId.current;
        setLoading(true);
        setError(null);
        loaderRef
            .current()
            .then((result) => {
            if (runId.current !== current)
                return;
            setData(result);
        })
            .catch((cause: unknown) => {
            if (runId.current !== current)
                return;
            setError(cause instanceof ApiError ? cause.message : 'Не удалось загрузить данные');
        })
            .finally(() => {
            if (runId.current === current)
                setLoading(false);
        });
    }, [tick, ...deps]);
    const reload = useCallback(() => setTick((value) => value + 1), []);
    return { data, error, loading, reload, setData };
}
