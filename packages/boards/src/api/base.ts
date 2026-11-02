/** Empty in dev (Vite proxies /api and /ws). In prod, the Railway URL. */
export const SERVER_URL: string = (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export function wsUrl(): string {
  if (SERVER_URL) return SERVER_URL.replace(/^http/, "ws") + "/ws";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}
