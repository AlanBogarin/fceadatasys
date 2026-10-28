import { createHash } from "node:crypto";
import { win32 } from "node:path";

export function windowsPowerShellEnvironment(inherited = process.env) {
  // Node does not remove PowerShell 7 module paths when starting Windows
  // PowerShell 5.1. Mixing their Security modules breaks Get-Credential.
  const systemRoot = inherited.SystemRoot || inherited.WINDIR || "C:\\Windows";
  return {
    ...inherited,
    PSModulePath: win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "Modules"),
  };
}

export function validTime(time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw Error("La hora debe tener el formato HH:MM, entre 00:00 y 23:59.");
  return time.split(":").map(Number);
}
export function scheduleName(root, profile) {
  if (!["demo", "production"].includes(profile))
    throw Error("Perfil inválido.");
  return `fceadatasys-backup-${createHash("sha256").update(root).digest("hex").slice(0, 10)}-${profile}`;
}
export function shellQuote(value) {
  if (/[\r\n\0]/.test(value)) throw Error("Ruta inválida.");
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
export function cronEntry({ root, node, script, config, profile, time, log }) {
  const [hour, minute] = validTime(time);
  const name = scheduleName(root, profile);
  const command = `cd ${shellQuote(root)} && ${[node, script, "--profile", profile, "--config", config].map(shellQuote).join(" ")} >> ${shellQuote(log)} 2>&1`;
  return `${minute} ${hour} * * * ${command.replaceAll("%", "\\%")} # ${name}`;
}
export function mergeCrontab(current, entry, marker) {
  return current
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trimEnd().endsWith(`# ${marker}`))
    .concat(entry, "")
    .join("\n");
}
export function removeCronTask(current, marker) {
  return current
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trimEnd().endsWith(`# ${marker}`))
    .concat("")
    .join("\n");
}
