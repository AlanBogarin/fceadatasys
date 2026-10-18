import type { SessionDto, UserDto } from "./contracts";
import { browserLock } from "./coordination";
import { HttpTransport } from "./http";
import { ClientProblem } from "./problems";
import { clientDeadline } from "./query";

type Pair = { accessToken: string; expiresIn: number; user: UserDto };
export type SessionSnapshot = {
  session: SessionDto | null;
  loading: boolean;
  error?: unknown;
  revision: number;
  lockedUser?: UserDto;
};
type Signal = "closed" | "session" | "data" | "activity";
export type SessionBus = {
  send(value: Signal): void;
  listen(callback: (value: Signal) => void): () => void;
};
export function browserSessionBus(): SessionBus {
  const key = "fcea-datasys.api.signal";
  const channel =
    typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(key) : null;
  return {
    send(value) {
      if (channel) channel.postMessage(value);
      else
        localStorage.setItem(
          key,
          JSON.stringify({ value, nonce: crypto.randomUUID() }),
        );
    },
    listen(callback) {
      const message = (event: MessageEvent) => {
        if (["closed", "session", "data", "activity"].includes(event.data))
          callback(event.data);
      };
      const storage = (event: StorageEvent) => {
        if (event.key !== key || !event.newValue) return;
        try {
          const value = JSON.parse(event.newValue).value;
          if (["closed", "session", "data", "activity"].includes(value))
            callback(value);
        } catch {
          /* Señal ajena inválida. */
        }
      };
      channel?.addEventListener("message", message);
      if (!channel) window.addEventListener("storage", storage);
      return () => {
        channel?.removeEventListener("message", message);
        window.removeEventListener("storage", storage);
      };
    },
  };
}
export class ApiSession {
  private snapshot: SessionSnapshot = {
    session: null,
    loading: true,
    revision: 0,
  };
  private listeners = new Set<() => void>();
  private deadline = 0;
  private recovering?: Promise<SessionDto>;
  private lastActivity = 0;
  private activityPending = false;
  private refreshing?: Promise<SessionDto>;
  private lastCheck = 0;
  private checkingDeadline = false;
  private generation = 0;
  constructor(
    readonly http: HttpTransport,
    private lock = <T>(work: () => Promise<T>) => browserLock("api-auth", work),
    private bus?: SessionBus,
    private now = Date.now,
  ) {
    http.recover = () => this.restore();
    http.unauthorized = () => this.clear(true);
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(update: Partial<SessionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...update };
    for (const listener of this.listeners) listener();
  }
  invalidate = (broadcast = true) => {
    this.publish({ revision: this.snapshot.revision + 1 });
    if (broadcast) this.bus?.send("data");
  };
  clear(broadcast = false, locked = false) {
    const lockedUser = locked ? this.snapshot.session?.user : undefined;
    this.generation++;
    this.http.clear();
    this.deadline = 0;
    this.publish({
      session: null,
      lockedUser,
      loading: false,
      error: undefined,
      revision: this.snapshot.revision + 1,
    });
    if (broadcast) this.bus?.send("closed");
  }
  private accept(value: SessionDto, pair?: Pair) {
    const current = this.snapshot.session;
    if (
      current?.session.id === value.session.id &&
      Date.parse(current.serverTime) > Date.parse(value.serverTime)
    )
      return current;
    const { accessToken, expiresIn, ...safe } = value;
    if (pair || accessToken)
      this.http.setToken(
        pair?.accessToken ?? accessToken!,
        pair?.expiresIn ?? expiresIn,
      );
    const previous = this.snapshot.session?.session.id;
    if (previous && previous !== value.session.id) this.http.clear();
    if (previous && previous !== value.session.id && (pair || accessToken))
      this.http.setToken(
        pair?.accessToken ?? accessToken!,
        pair?.expiresIn ?? expiresIn,
      );
    this.deadline = clientDeadline(
      value.serverTime,
      value.session.expiresAt,
      value.session.idleExpiresAt,
      this.now(),
    );
    this.publish({
      session: safe,
      lockedUser: undefined,
      loading: false,
      error: undefined,
      revision:
        this.snapshot.revision + (previous === value.session.id ? 0 : 1),
    });
    return safe;
  }
  initializeBrowser = async () => {
    await this.lock(async () => {
      await this.http.request("/auth/browser", {
        method: "POST",
        public: true,
      });
    });
  };
  private async readCookieSession() {
    const generation = this.generation;
    const result = await this.http.request<SessionDto>("/auth/session", {
      public: true,
    });
    if (generation !== this.generation)
      throw new DOMException("Sesión reemplazada", "AbortError");
    return this.accept(result.data);
  }
  restore = (): Promise<SessionDto> => {
    if (!this.recovering) {
      const generation = this.generation;
      this.recovering = this.lock(async () => {
        if (generation !== this.generation)
          throw new DOMException("Sesión reemplazada", "AbortError");
        return this.readCookieSession();
      })
        .catch((error) => {
          if (generation === this.generation) {
            if (error instanceof ClientProblem && error.status === 401)
              this.clear(true);
            else this.publish({ loading: false, error });
          }
          throw error;
        })
        .finally(() => {
          this.recovering = undefined;
        });
    }
    return this.recovering;
  };
  login = async (username: string, password: string) =>
    this.lock(async () => {
      try {
        const pair = (
          await this.http.request<Pair>("/auth/login", {
            method: "POST",
            body: { username, password },
            public: true,
          })
        ).data;
        this.http.setToken(pair.accessToken, pair.expiresIn);
        const result = await this.readCookieSession();
        this.bus?.send("session");
        return result;
      } catch (error) {
        if (
          error instanceof ClientProblem &&
          error.code === "BROWSER_SESSION_ACTIVE"
        ) {
          await this.readCookieSession();
          this.bus?.send("session");
        }
        throw error;
      }
    });
  refresh = (): Promise<SessionDto> => {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.lock(async () => {
      // Releer bajo el mismo mutex que inicialización, logout y contraseña.
      try {
        const pair = (
          await this.http.request<Pair>("/auth/refresh", {
            method: "POST",
            public: true,
          })
        ).data;
        this.http.setToken(pair.accessToken, pair.expiresIn);
        return await this.readCookieSession();
      } catch (error) {
        if (error instanceof ClientProblem && error.status === 401)
          this.clear(true);
        throw error;
      }
    }).finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  };
  logout = async () =>
    this.lock(async () => {
      await this.http.request("/auth/logout", { method: "POST", public: true });
      this.clear(true);
    });
  password = async (currentPassword: string, newPassword: string) => {
    // Autorización antes de tomar el mutex: evita una renovación recursiva.
    await this.restore();
    await this.lock(async () => {
      const pair = (
        await this.http.request<Pair>("/me/password", {
          method: "PATCH",
          body: { currentPassword, newPassword },
          renew: false,
        })
      ).data;
      this.http.setToken(pair.accessToken, pair.expiresIn);
      await this.readCookieSession();
      this.bus?.send("session");
    });
  };
  session = async (signal?: AbortSignal) => {
    const generation = this.generation;
    const result = await this.http.get<SessionDto>("/auth/session", signal);
    if (generation !== this.generation)
      throw new DOMException("Identidad reemplazada", "AbortError");
    return this.accept(result);
  };
  updateUser(user: UserDto) {
    this.generation++;
    if (this.snapshot.session)
      this.publish({ session: { ...this.snapshot.session, user } });
    this.invalidate();
    this.bus?.send("session");
  }
  activity = async () => {
    await this.http.request("/auth/activity", { method: "POST" });
    const result = await this.session();
    this.bus?.send("activity");
    return result;
  };
  start() {
    const unlisten = this.bus?.listen((value) => {
      if (value === "closed") this.clear();
      else if (value === "data") {
        this.invalidate(false);
        if (this.snapshot.session) void this.session().catch(() => {});
      } else if (value === "activity") {
        if (this.snapshot.session) void this.session().catch(() => {});
      } else {
        this.clear();
        void this.restore().catch(() => {});
      }
    });
    void this.initializeBrowser()
      .then(this.restore)
      .catch((error) => {
        if (!(error instanceof ClientProblem && error.status === 401))
          this.publish({ loading: false, error });
      });
    const sync = () => {
      if (!this.snapshot.session) {
        void this.restore().catch(() => {});
        return;
      }
      void this.session().catch(() => {});
    };
    const activity = (event: Event) => {
      if (
        !event.isTrusted ||
        !this.snapshot.session ||
        this.activityPending ||
        this.now() < this.lastActivity + 15_000 ||
        this.now() >= this.deadline
      )
        return;
      this.lastActivity = this.now();
      this.activityPending = true;
      void this.activity()
        .catch(() => {})
        .finally(() => {
          this.activityPending = false;
        });
    };
    const tick = setInterval(() => {
      if (!this.snapshot.session) return;
      if (this.now() >= this.deadline) {
        if (this.checkingDeadline) return;
        const user = this.snapshot.session.user;
        this.checkingDeadline = true;
        // Otra pestaña pudo comunicar actividad mientras esta estaba suspendida.
        void this.session()
          .catch((error) => {
            if (error instanceof DOMException && error.name === "AbortError")
              return;
            if (error instanceof ClientProblem && error.status === 401)
              this.publish({ lockedUser: user });
            else this.clear(false, true);
          })
          .finally(() => {
            this.checkingDeadline = false;
          });
      } else if (this.http.renewalDue) void this.refresh().catch(() => {});
      else if (this.now() - this.lastCheck >= 30_000) {
        this.lastCheck = this.now();
        void this.session().catch(() => {});
      }
    }, 1000);
    window.addEventListener("focus", sync);
    const visibility = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", visibility);
    for (const event of ["pointerdown", "keydown", "wheel", "touchstart"])
      window.addEventListener(event, activity, {
        capture: true,
        passive: true,
      });
    return () => {
      unlisten?.();
      clearInterval(tick);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", visibility);
      for (const event of ["pointerdown", "keydown", "wheel", "touchstart"])
        window.removeEventListener(event, activity, true);
    };
  }
}
