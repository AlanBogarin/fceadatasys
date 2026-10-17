import { INACTIVITY_MS } from "../security";
import { browserLock } from "./coordination";
import { problem } from "./problems";

export const SHARED_SESSION_KEY = "fcea-datasys.mock.session.v2";
export const SESSION_SIGNAL = "fcea-datasys.mock.session.changed";
export const ABSOLUTE_SESSION_MS = 7 * 24 * 60 * 60_000;
export type SharedSession = {
  id: string;
  userId: string;
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number;
  confirmationFailures: number;
};
type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Lock = <T>(work: () => Promise<T>) => Promise<T>;

export class MockSessionStore {
  constructor(
    private storage: SessionStorage,
    private now = Date.now,
    private lock: Lock = (work) => browserLock("session", work),
    private notify = () => {},
  ) {}
  read(): SharedSession | null {
    try {
      const value = JSON.parse(
        this.storage.getItem(SHARED_SESSION_KEY) ?? "null",
      ) as SharedSession | null;
      if (
        !value ||
        typeof value.id !== "string" ||
        typeof value.userId !== "string" ||
        ![
          value.createdAt,
          value.lastActivityAt,
          value.expiresAt,
          value.confirmationFailures,
        ].every(Number.isFinite) ||
        value.expiresAt !== value.createdAt + ABSOLUTE_SESSION_MS ||
        value.lastActivityAt < value.createdAt ||
        value.lastActivityAt > this.now() ||
        value.confirmationFailures < 0 ||
        value.confirmationFailures > 2
      )
        return null;
      return value;
    } catch {
      return null;
    }
  }
  active(session = this.read()) {
    return (
      !!session &&
      Math.min(session.expiresAt, session.lastActivityAt + INACTIVITY_MS) >
        this.now()
    );
  }
  timing(session: SharedSession) {
    return {
      serverTime: new Date(this.now()).toISOString(),
      expiresAt: new Date(session.expiresAt).toISOString(),
      idleExpiresAt: new Date(
        Math.min(session.expiresAt, session.lastActivityAt + INACTIVITY_MS),
      ).toISOString(),
    };
  }
  assert(id?: string) {
    const session = this.read();
    if (!session || (id && id !== session.id) || !this.active(session))
      throw problem(
        401,
        "UNAUTHENTICATED",
        "La sesión se cerró o venció. Volvé a iniciar sesión.",
      );
    return session;
  }
  private write(session: SharedSession | null) {
    if (session)
      this.storage.setItem(SHARED_SESSION_KEY, JSON.stringify(session));
    else this.storage.removeItem(SHARED_SESSION_KEY);
    this.notify();
  }
  async login(
    userId: string,
    before: (session: SharedSession) => void | Promise<void> = () => {},
  ) {
    return this.lock(async () => {
      if (this.active())
        throw problem(
          409,
          "BROWSER_SESSION_ACTIVE",
          "Este navegador ya tiene una sesión activa. Se recuperó la cuenta compartida.",
        );
      const time = this.now();
      const session = {
        id: crypto.randomUUID(),
        userId,
        createdAt: time,
        lastActivityAt: time,
        expiresAt: time + ABSOLUTE_SESSION_MS,
        confirmationFailures: 0,
      };
      await before(session);
      this.write(session);
      return session;
    });
  }
  async logout(id: string, before: () => void | Promise<void> = () => {}) {
    return this.lock(async () => {
      const current = this.read();
      if (!current || current.id !== id) return;
      await before();
      this.write(null);
    });
  }
  async activity(id: string) {
    return this.lock(async () => {
      const current = this.assert(id);
      if (this.now() - current.lastActivityAt >= 15000)
        this.write({ ...current, lastActivityAt: this.now() });
      return this.assert(id);
    });
  }
  async confirmation(
    id: string,
    valid: boolean,
    auditFailure: () => void | Promise<void> = () => {},
  ) {
    return this.lock(async () => {
      const current = this.assert(id);
      await auditFailure();
      const count = valid ? 0 : current.confirmationFailures + 1;
      this.write(
        count >= 3 ? null : { ...current, confirmationFailures: count },
      );
      return count;
    });
  }
}
