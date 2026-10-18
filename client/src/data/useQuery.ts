import { useEffect, useMemo, useRef, useState } from "react";
import { LatestQuery } from "./query";
import { useDataEnvironment } from "./context";

export function useQuery<T>(
  query: (signal: AbortSignal) => Promise<T>,
  dependencies: readonly unknown[],
) {
  const [revision, setRevision] = useState(0);
  const environment = useDataEnvironment();
  const key = useMemo(
    () => ({}),
    [...dependencies, revision, environment.revision],
  );
  const [result, setResult] = useState<{
    key: object;
    data?: T;
    error?: unknown;
  }>();
  const latest = useRef(query);
  latest.current = query;
  useEffect(() => {
    const request = new LatestQuery();
    void request.run(
      latest.current,
      (data) => setResult({ key, data }),
      (error) => setResult({ key, error }),
    );
    return () => request.cancel();
  }, [key]);
  return {
    data: result?.key === key ? result.data : undefined,
    error: result?.key === key ? result.error : undefined,
    loading: result?.key !== key,
    reload: () => setRevision((value) => value + 1),
  };
}
