export const LOGOUT_PREFIX = "fcea-datasys.logout.";
export const SESSION_GENERATION_KEY = "fcea-datasys.session.generation";
export function logoutKey(userId: string): string {
  return `${LOGOUT_PREFIX}${userId}`;
}
export function sessionGenerationMatches(
  userId: string,
  generation: string,
  storage: Pick<Storage, "getItem">,
): boolean {
  return generation === (storage.getItem(logoutKey(userId)) ?? "");
}
