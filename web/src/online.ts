import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMsg, ServerMsg, State } from "./types.gen";

/**
 * Where the online server is. Empty means the page was served by the Go
 * server itself (same origin). The GitHub Pages build sets VITE_SERVER_URL.
 */
export const SERVER = ((import.meta.env.VITE_SERVER_URL as string | undefined) ?? "").replace(/\/$/, "");
export const onlineAvailable = () => SERVER !== "" || !location.hostname.endsWith("github.io");

/** The socket the hook opens; tests replace it with a fake. */
export interface Socket {
  onopen: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: ((e: { code: number }) => void) | null;
  send(data: string): void;
  close(): void;
}
let makeSocket: (url: string) => Socket = (url) => new WebSocket(url) as unknown as Socket;
export function setSocketFactory(f: (url: string) => Socket) {
  makeSocket = f;
}

export function wsURL(code: string, q: Record<string, string>) {
  const base = SERVER || location.origin;
  return base.replace(/^http/, "ws") + `/api/rooms/${encodeURIComponent(code)}/ws?` + new URLSearchParams(q).toString();
}

export async function createRoom(): Promise<string> {
  const r = await fetch(`${SERVER}/api/rooms`, { method: "POST" });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body.code;
}

const tokenKey = (code: string) => `pallanguzhi:${code}:token`;
export type Status = "connecting" | "online" | "reconnecting" | "gone";

/** Delay before reconnect attempt n: 0.5 s, 1 s, 2 s, 4 s, then 8 s. */
export const backoff = (n: number) => Math.min(8000, 500 * 2 ** n);

/**
 * Connects to a room and stays connected: on a dropped connection it
 * reconnects with backoff and takes the same seat back with the token the
 * server gave this browser.
 */
export function useRoom(code: string, name: string, play: boolean) {
  const [status, setStatus] = useState<Status>("connecting");
  const [seat, setSeat] = useState<number | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string>("");
  const sock = useRef<Socket | null>(null);

  useEffect(() => {
    let closed = false, attempt = 0, timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      const token = localStorage.getItem(tokenKey(code)) ?? "";
      const s = makeSocket(wsURL(code, { name, token, play: play ? "1" : "0" }));
      sock.current = s;
      s.onopen = () => {
        attempt = 0;
        setStatus("online");
      };
      s.onmessage = (e) => {
        const m = JSON.parse(e.data) as ServerMsg;
        if (m.type === "hello") {
          setSeat(m.seat ?? -1);
          if (m.token) localStorage.setItem(tokenKey(code), m.token);
        } else if (m.type === "state" && m.state) {
          setState(m.state);
          setError("");
        } else if (m.type === "error") setError(m.error ?? "error");
      };
      s.onclose = (e) => {
        if (closed) return;
        // 4404-style failures arrive as a close before open; a missing room is final.
        if (e.code === 1008) setError("disconnected: too many messages");
        setStatus("reconnecting");
        timer = setTimeout(connect, backoff(attempt++));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      sock.current?.close();
    };
  }, [code, name, play]);

  const send = useCallback((m: Partial<ClientMsg>) => {
    sock.current?.send(JSON.stringify(m));
  }, []);
  return { status, seat, state, error, send };
}
