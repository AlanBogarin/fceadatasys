// Exclusión entre pestañas; IndexedDB conserva la exclusión donde Web Locks no existe.
export async function browserLock<T>(
  name: string,
  work: () => Promise<T>,
): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request(`fcea-datasys.mock.${name}`, work);
  if (typeof indexedDB === "undefined")
    throw Error("No se pudo coordinar la operación entre pestañas.");
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`fcea-datasys.coordination.${name}`, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("locks");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(Error("No se pudo coordinar la operación local."));
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction("locks", "readwrite");
      const store = transaction.objectStore("locks");
      let finished = false;
      let result: T;
      let failure: unknown;
      let failed = false;
      const keepAlive = () => {
        const request = store.get(name);
        request.onsuccess = () => {
          if (!finished) keepAlive();
        };
      };
      const first = store.get(name);
      first.onsuccess = () => {
        keepAlive();
        Promise.resolve()
          .then(work)
          .then(
            (value) => {
              result = value;
              finished = true;
            },
            (error) => {
              failed = true;
              failure = error;
              finished = true;
            },
          );
      };
      transaction.oncomplete = () =>
        failed ? reject(failure) : resolve(result!);
      transaction.onabort = () =>
        reject(failure ?? Error("La coordinación local fue interrumpida."));
      transaction.onerror = () => {};
    });
  } finally {
    database.close();
  }
}
