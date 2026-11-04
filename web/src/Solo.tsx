import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./lib/go";
import { Action, Card, reportError } from "./lib/ui";
import { animate as playTrace, BoardView, sleep, type View } from "./Board";
import type { Board, Event as GameEvent, MoveScore, Stats } from "./types.gen";

// Response shapes of cmd/web: the board plus extras per endpoint.
export interface GameState {
  board: Board;
  over: boolean;
  final: number[];
  moves: number[] | null;
}
interface MoveResult extends GameState {
  trace: GameEvent[];
}
interface AIResult extends MoveResult {
  pit: number;
  scores: MoveScore[] | null;
  stats: Stats;
  ms: number;
  level: string;
}
interface Hint {
  scores: MoveScore[];
  stats: Stats;
}

type Level = "easy" | "medium" | "hard";

function Why({ r }: { r: AIResult | null }) {
  if (!r) return <div className="muted">The AI's last move and the alternatives it considered appear here.</div>;
  if (!r.scores)
    return <div className="muted">The {r.level} AI played pit {14 - r.pit}{r.level === "easy" ? " at random (easy plays a random move about a third of the time)" : ""}.</div>;
  return (
    <>
      <div>{r.level}: searched <b>{r.stats.nodes.toLocaleString()}</b> positions, {r.stats.depth} moves ahead, in {r.ms} ms.</div>
      <table className="why">
        <thead><tr><th>AI pit</th><th className="num">captures now</th><th className="num">expected final margin</th></tr></thead>
        <tbody>
          {r.scores.map((s) => (
            <tr key={s.pit} className={s.pit === r.pit ? "pick" : ""}>
              <td>{14 - s.pit}{s.pit === r.pit && " ← played"}</td>
              <td className="num">{s.captured}</td>
              <td className="num">{s.score > 0 ? "+" : ""}{s.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted">Margin = AI's seeds minus yours at the end, assuming both sides play the best move the search can see.</div>
    </>
  );
}

/** Playing against the Go AI, which runs in this tab as WebAssembly. */
export default function Solo({ speed }: { speed: number }) {
  const [level, setLevel] = useState<Level>("medium");
  const [youFirst, setYouFirst] = useState(false);
  const [s, setS] = useState<GameState | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [msg, setMsg] = useState<string>("");
  const [why, setWhy] = useState<AIResult | null>(null);
  const [locked, setLocked] = useState(false);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const animate = useCallback((trace: GameEvent[], who: string) => playTrace(trace, who, setView, () => speedRef.current), []);

  const settle = useCallback((st: GameState, note: string) => {
    setS(st);
    setView({ pits: st.board.pits, store: st.board.store, hl: {} });
    if (st.over) {
      const [you, ai] = st.final;
      setMsg(`${note} Round over: you ${you}, AI ${ai}. ${you > ai ? "You win!" : you < ai ? "The AI wins." : "Draw."}`);
    } else setMsg(note + (st.board.turn === 0 ? " Your move: click a glowing pit." : ""));
  }, []);

  const aiTurn = useCallback(async (prefix: string) => {
    let note = prefix;
    for (;;) {
      setMsg(`${note} The AI is thinking…`);
      await sleep(30);
      const r = await api<AIResult>("POST", "ai");
      note = await animate(r.trace, `AI lifted pit ${14 - r.pit}`);
      setWhy(r);
      if (r.over || r.board.turn !== 1) return settle(r, note);
    }
  }, [animate, settle]);

  const run = useCallback(async (f: () => Promise<void>) => {
    setLocked(true);
    try {
      await f();
    } catch (e) {
      reportError(e);
    } finally {
      setLocked(false);
    }
  }, []);

  const newGame = useCallback(() => run(async () => {
    const st = await api<GameState>("POST", "new", { Level: level, YouFirst: youFirst });
    setWhy(null);
    if (st.board.turn === 1) {
      setS(st);
      setView({ pits: st.board.pits, store: st.board.store, hl: {} });
      await aiTurn("New game.");
    } else settle(st, "New game.");
  }), [run, level, youFirst, aiTurn, settle]);

  const move = (p: number) => run(async () => {
    const r = await api<MoveResult>("POST", "move", { Pit: p });
    const note = await animate(r.trace, `You lifted pit ${p + 1}`);
    if (!r.over && r.board.turn === 1) {
      setS(r);
      await aiTurn(note);
    } else settle(r, note);
  });

  const hint = async () => {
    if (!s || s.over || s.board.turn !== 0) return;
    const h = await api<Hint>("GET", "hint");
    const best = h.scores[0];
    setView({ pits: s.board.pits, store: s.board.store, hl: { [best.pit]: "lift" } });
    setMsg(`Hint: pit ${best.pit + 1} (expected margin ${best.score > 0 ? "+" : ""}${best.score} for you, looking 4 moves ahead).`);
  };

  useEffect(() => {
    void newGame();
    // start one game on load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const legal = new Set(s && !s.over && s.board.turn === 0 && !locked ? s.moves ?? [] : []);
  return (
    <>
        <Card wide title="Play the AI">
          <div className="row">
            Opponent
            <select value={level} onChange={(e) => setLevel(e.target.value as Level)} aria-label="opponent">
              <option value="easy">easy</option>
              <option value="medium">medium (4 moves ahead)</option>
              <option value="hard">hard (searches 300,000 positions)</option>
            </select>
            <select value={youFirst ? "1" : "0"} onChange={(e) => setYouFirst(e.target.value === "1")} aria-label="who moves first">
              <option value="0">AI moves first</option>
              <option value="1">I move first</option>
            </select>
            <button onClick={newGame} disabled={locked}>New game</button>
            <Action variant="ghost" onRun={hint} disabled={locked}>Hint</Action>
          </div>
          <div className="msg" aria-live="polite">{msg}</div>
          {view && <BoardView pits={view.pits} store={view.store} hl={view.hl} legal={legal} onPick={move} />}
        </Card>
        <Card title="Why the AI played that">
          <Why r={why} />
        </Card>
    </>
  );
}
