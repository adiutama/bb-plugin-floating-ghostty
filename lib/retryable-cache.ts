export function createRetryablePromiseCache<Value>(
  load: () => Promise<Value>,
): () => Promise<Value> {
  let pending: Promise<Value> | null = null;
  return () => {
    if (pending) return pending;
    pending = load().catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}
