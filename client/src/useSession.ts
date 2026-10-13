import { useEffect, useRef, useState } from "react";
import { SESSION_KEY } from "./storage";
import { INACTIVITY_MS, renewActivity, sessionExpired } from "./security";

const DEADLINE_KEY = "fcea-datasys.session.deadline";

export function useSession() {
  const [session, setSession] = useState(() =>
    sessionStorage.getItem(SESSION_KEY),
  );
  const deadline = useRef(Number(sessionStorage.getItem(DEADLINE_KEY)));
  const [locked, setLocked] = useState(
    () => Boolean(session) && sessionExpired(deadline.current),
  );

  function assertActive() {
    // Paso 1: verificar identidad y plazo antes de persistir cualquier acción privada.
    if (!session || locked || sessionExpired(deadline.current)) {
      // Paso 2: bloquear también si el temporizador se demoró por suspensión del equipo.
      setLocked(true);
      throw Error(
        "La sesión está bloqueada por inactividad. Volvé a iniciar sesión.",
      );
    }
    // Paso 3: permitir que el servicio continúe; no renovar por tareas automáticas.
  }

  function login(userId: string) {
    // Paso 1: el llamador ya verificó las credenciales.
    const nextDeadline = Date.now() + INACTIVITY_MS;
    // Paso 2: guardar el vencimiento por pestaña, conservado al recargar.
    sessionStorage.setItem(SESSION_KEY, userId);
    sessionStorage.setItem(DEADLINE_KEY, String(nextDeadline));
    // Paso 3: abrir la sesión únicamente tras guardar correctamente.
    deadline.current = nextDeadline;
    setSession(userId);
    setLocked(false);
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(DEADLINE_KEY);
    deadline.current = 0;
    setSession(null);
    setLocked(false);
  }

  useEffect(() => {
    if (!session || locked) {
      return;
    }

    function checkDeadline() {
      if (sessionExpired(deadline.current)) {
        setLocked(true);
      }
    }

    function registerActivity(event: Event) {
      // Paso 1: solo actividad real del usuario; nunca polling ni eventos sintéticos.
      if (!event.isTrusted) {
        return;
      }
      // Paso 2: comprobar el plazo ANTES de renovarlo.
      const renewed = renewActivity(deadline.current);
      if (renewed === null) {
        setLocked(true);
        return;
      }
      // Paso 3: persistir el nuevo plazo. Si falla, bloquear de forma defensiva.
      try {
        sessionStorage.setItem(DEADLINE_KEY, String(renewed));
        deadline.current = renewed;
      } catch {
        setLocked(true);
      }
    }

    const activityEvents = ["pointerdown", "keydown", "wheel", "touchstart"];
    for (const eventName of activityEvents) {
      window.addEventListener(eventName, registerActivity, {
        capture: true,
        passive: true,
      });
    }
    const timer = window.setInterval(checkDeadline, 1000);
    window.addEventListener("focus", checkDeadline);
    document.addEventListener("visibilitychange", checkDeadline);

    return () => {
      clearInterval(timer);
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, registerActivity, true);
      }
      window.removeEventListener("focus", checkDeadline);
      document.removeEventListener("visibilitychange", checkDeadline);
    };
  }, [session, locked]);

  return { session, locked, login, logout, assertActive };
}
