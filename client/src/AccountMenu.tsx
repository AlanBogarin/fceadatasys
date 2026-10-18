import { useEffect, useRef, useState } from "react";
import { ChevronDown, UserRound, LockKeyhole, LogOut } from "lucide-react";
import type { UserDto as User } from "./data/contracts";
import { roleLabel } from "./model";
import { initials } from "./ui";
export function AccountMenu({
  user,
  navigate,
  logout,
}: {
  user: User;
  navigate: (targetId: string) => void;
  logout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div
      className="account-menu"
      ref={container}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="profile-button"
        onClick={() => setOpen(!open)}
        aria-label="Opciones de mi cuenta"
        aria-expanded={open}
        aria-controls="account-options"
      >
        <span className="avatar small">{initials(user.name)}</span>
        <span>{roleLabel[user.role]}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <nav
          id="account-options"
          className="account-options"
          aria-label="Opciones de mi cuenta"
        >
          <a
            href="#perfil"
            onClick={() => {
              setOpen(false);
              navigate("perfil");
            }}
          >
            <UserRound size={17} />
            Mi perfil
          </a>
          <a
            href="#password"
            onClick={() => {
              setOpen(false);
              navigate("password");
            }}
          >
            <LockKeyhole size={17} />
            Cambiar contraseña
          </a>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              logout();
            }}
          >
            <LogOut size={17} />
            Cerrar sesión
          </button>
        </nav>
      )}
    </div>
  );
}
