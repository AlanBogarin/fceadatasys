import { useEffect, useRef, useState } from "react";
import {
  MockSessionStore,
  SHARED_SESSION_KEY,
  SESSION_SIGNAL,
  type SharedSession,
} from "./data/session";
import { INACTIVITY_MS } from "./security";
import { clientDeadline } from "./data/query";

export function useSession() {
  const [store] = useState(
    () =>
      new MockSessionStore(localStorage, Date.now, undefined, () =>
        window.dispatchEvent(new Event(SESSION_SIGNAL)),
      ),
  );
  const [info, setInfo] = useState<SharedSession | null>(() => store.read());
  const [locked, setLocked] = useState(() => !!info && !store.active(info));
  const identity = useRef(info);
  identity.current = info;
  function synchronize() {
    const current = store.read();
    identity.current = current;
    setInfo(current);
    const time = current ? store.timing(current) : undefined;
    setLocked(
      !!time &&
        clientDeadline(time.serverTime, time.expiresAt, time.idleExpiresAt) <=
          Date.now(),
    );
  }
  function assertActive() {
    store.assert(identity.current?.id ?? "closed");
  }
  async function login(
    userId: string,
    before?: (session: SharedSession) => void | Promise<void>,
  ) {
    try {
      await store.login(userId, before);
    } finally {
      synchronize();
    }
  }
  async function logout(before?: () => void | Promise<void>) {
    const current = identity.current;
    if (current) await store.logout(current.id, before);
    synchronize();
  }
  async function confirmation(
    valid: boolean,
    auditFailure?: () => void | Promise<void>,
  ) {
    try {
      return await store.confirmation(
        identity.current?.id ?? "closed",
        valid,
        auditFailure,
      );
    } finally {
      synchronize();
    }
  }
  async function activity() {
    const current = store.read();
    if (current) await store.activity(current.id);
    synchronize();
  }
  useEffect(() => {
    for (const key of [
      "fcea-datasys.session",
      "fcea-datasys.session.deadline",
      "fcea-datasys.session.generation",
      "fcea-datasys.audit.session",
      "fcea-datasys.audit.started",
    ])
      sessionStorage.removeItem(key);
    const storageListener = (event: StorageEvent) => {
      if (event.key === SHARED_SESSION_KEY || event.key === null) synchronize();
    };
    const timer = setInterval(synchronize, 1000);
    const activity = (event: Event) => {
      if (
        !event.isTrusted ||
        !identity.current ||
        !store.active(identity.current)
      ) {
        synchronize();
        return;
      }
      if (Date.now() - identity.current.lastActivityAt < 15000) return;
      void store
        .activity(identity.current.id)
        .then(synchronize)
        .catch(synchronize);
    };
    window.addEventListener("storage", storageListener);
    window.addEventListener(SESSION_SIGNAL, synchronize);
    window.addEventListener("focus", synchronize);
    document.addEventListener("visibilitychange", synchronize);
    for (const event of ["pointerdown", "keydown", "wheel", "touchstart"])
      window.addEventListener(event, activity, {
        capture: true,
        passive: true,
      });
    synchronize();
    return () => {
      clearInterval(timer);
      window.removeEventListener("storage", storageListener);
      window.removeEventListener(SESSION_SIGNAL, synchronize);
      window.removeEventListener("focus", synchronize);
      document.removeEventListener("visibilitychange", synchronize);
      for (const event of ["pointerdown", "keydown", "wheel", "touchstart"])
        window.removeEventListener(event, activity, true);
    };
  }, [store]);
  return {
    session: info?.userId ?? null,
    info,
    locked,
    login,
    logout,
    assertActive,
    confirmation,
    activity,
    current: () => store.read(),
    serverTime: new Date().toISOString(),
    idleExpiresAt: info
      ? new Date(
          Math.min(info.expiresAt, info.lastActivityAt + INACTIVITY_MS),
        ).toISOString()
      : null,
  };
}
