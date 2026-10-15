/** Reserve BEFORE awaiting persistence; pending transactions also consume capacity. */
export function createDeliverySlots(capacity = 100): () => (() => void) | undefined {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Capacidad de entrega inválida.');
  let active = 0;
  return () => {
    if (active >= capacity) return undefined;
    active++;
    let released = false;
    return () => {
      if (!released) { released = true; active--; }
    };
  };
}
