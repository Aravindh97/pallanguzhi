import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import App, { label, type GameState } from "./App";
import { setTransport } from "./lib/go";

afterEach(cleanup);

const start: GameState = {
  board: { pits: [12, 12, 12, 2, 12, 12, 12, 12, 12, 12, 2, 12, 12, 12], store: [0, 0], turn: 0 },
  over: false, final: [74, 74], moves: [0, 1, 2, 3, 4, 5, 6],
};

test("pit labels match the board layout", () => {
  expect(label(0)).toBe("your pit 1");
  expect(label(13)).toBe("AI pit 1");
  expect(label(7)).toBe("AI pit 7");
});

test("a new game shows your pits as playable and sends the chosen pit to Go", async () => {
  const calls: string[] = [];
  setTransport(async (method, path, body) => {
    calls.push(`${method} ${path} ${body}`);
    if (path === "new") return { status: 200, body: start };
    // after the move it is the AI's turn but the round is over: no AI call needed
    return { status: 200, body: { ...start, over: true, trace: [], board: { ...start.board, turn: 1 } } };
  });
  render(<App />);
  const pit = await screen.findByRole("button", { name: "your pit 4: 2 seeds" });
  expect(screen.getByRole("button", { name: "AI pit 1: 12 seeds" })).toHaveProperty("disabled", true);
  await act(async () => fireEvent.click(pit));
  expect(calls).toContain('POST move {"Pit":3}');
  expect(await screen.findByText(/Round over: you 74, AI 74. Draw./)).toBeTruthy();
});
