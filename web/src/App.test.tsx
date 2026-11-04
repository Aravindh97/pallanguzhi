import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "./App";
import { pitName } from "./Board";
import { setTransport } from "./lib/go";
import { headline } from "./Online";
import { backoff, setSocketFactory, type Socket } from "./online";
import type { GameState } from "./Solo";
import type { State } from "./types.gen";

afterEach(() => {
  cleanup();
  localStorage.clear();
  history.replaceState(null, "", "/");
});

const pits = [12, 12, 12, 2, 12, 12, 12, 12, 12, 12, 2, 12, 12, 12];

test("pit names follow the viewer's side of the board", () => {
  expect(pitName(0)).toBe("your pit 1");
  expect(pitName(13)).toBe("AI pit 1");
  expect(pitName(7)).toBe("AI pit 7");
  // North sees its own pits 7-13 along the bottom and South's 6..0 along the top.
  expect(pitName(7, 1, "Anita")).toBe("your pit 1");
  expect(pitName(6, 1, "Anita")).toBe("Anita pit 1");
  expect(pitName(0, 1, "Anita")).toBe("Anita pit 7");
});

test("reconnect backoff doubles and caps at 8 s", () => {
  expect([0, 1, 2, 3, 4, 9].map(backoff)).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
});

test("solo: a new game shows your pits as playable and sends the chosen pit to Go", async () => {
  const start: GameState = { board: { pits, store: [0, 0], turn: 0 }, over: false, final: [74, 74], moves: [0, 1, 2, 3, 4, 5, 6] };
  const calls: string[] = [];
  setTransport(async (method, path, body) => {
    calls.push(`${method} ${path} ${body}`);
    if (path === "new") return { status: 200, body: start };
    return { status: 200, body: { ...start, over: true, trace: [], board: { ...start.board, turn: 1 } } };
  });
  render(<App />);
  const pit = await screen.findByRole("button", { name: "your pit 4: 2 seeds" });
  expect(screen.getByRole("button", { name: "AI pit 1: 12 seeds" })).toHaveProperty("disabled", true);
  await act(async () => fireEvent.click(pit));
  expect(calls).toContain('POST move {"Pit":3}');
  expect(await screen.findByText(/Round over: you 74, AI 74. Draw./)).toBeTruthy();
});

// A fake WebSocket the test drives by hand.
class FakeSocket implements Socket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  sent: unknown[] = [];
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {}
  server(m: unknown) {
    act(() => this.onmessage?.({ data: JSON.stringify(m) }));
  }
}
beforeEach(() => {
  FakeSocket.all = [];
  setSocketFactory((u) => new FakeSocket(u));
});

const roomState = (over: Partial<State> = {}): State => ({
  code: "ABC234", board: { pits, store: [0, 0], turn: 0 }, over: false, final: [74, 74], moves: [0, 1, 2, 3, 4, 5, 6],
  players: [{ name: "Anita", joined: true, online: true }, { name: "Ravi", joined: true, online: true }],
  spectators: 1, version: 4, game: 1, rematch: [false, false], ...over,
});

test("online: joins from the link, plays a move against the current version, and reconnects with its token", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  history.replaceState(null, "", "/?room=abc234");
  localStorage.setItem("pallanguzhi:name", "Anita");
  render(<App />);
  const s = FakeSocket.all[0];
  expect(s.url).toContain("/api/rooms/ABC234/ws?name=Anita&token=&play=1");
  act(() => s.onopen?.());
  s.server({ type: "hello", seat: 0, token: "TOK123" });
  s.server({ type: "state", state: roomState() });
  expect(await screen.findByText("Your move: click a glowing pit.")).toBeTruthy();
  expect(screen.getByText("connected")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "your pit 2: 12 seeds" }));
  expect(s.sent).toEqual([{ type: "move", pit: 1, version: 4 }]);
  // While the move is in flight the pits are locked, so a double-click can't send twice.
  expect(screen.getByRole("button", { name: "your pit 2: 12 seeds" })).toHaveProperty("disabled", true);

  act(() => s.onclose?.({ code: 1006 }));
  expect(await screen.findByText("reconnecting…")).toBeTruthy();
  await act(async () => vi.advanceTimersByTime(600));
  expect(FakeSocket.all).toHaveLength(2);
  expect(FakeSocket.all[1].url).toContain("token=TOK123");
  vi.useRealTimers();
});

test("headline speaks from the viewer's side", () => {
  expect(headline(roomState({ board: { pits, store: [0, 0], turn: 1 } }), 0)).toBe("Ravi to move…");
  expect(headline(roomState({ over: true, final: [80, 68] }), 1)).toBe("Game over: Anita 80, You 68. Anita wins.");
  expect(headline(roomState({ over: true, final: [80, 68] }), -1)).toBe("Game over: Anita 80, Ravi 68. Anita wins.");
  expect(headline(roomState({ players: [{ name: "Anita", joined: true, online: true }, { name: "", joined: false, online: false }] }), 0)).toMatch(/Waiting for a second player/);
});
