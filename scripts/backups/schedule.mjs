import { createHash } from "node:crypto";
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
