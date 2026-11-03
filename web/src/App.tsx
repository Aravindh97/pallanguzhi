import { useCallback, useEffect, useRef, useState } from "react";
import "./app.css";
import { api } from "./lib/go";
import { Action, Card, Footer, Header, reportError } from "./lib/ui";
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
type Highlight = Record<number, "hot" | "lift" | "cap">;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Pits 0-6 are the player's, left to right; 7-13 the AI's, shown 1-7 from the left of the top row. */
export const label = (p: number) => (p < 7 ? `your pit ${p + 1}` : `AI pit ${14 - p}`);

function Pit({ i, n, legal, hl, onPick }: { i: number; n: number; legal: boolean; hl?: string; onPick: (i: number) => void }) {
  const mine = i < 7;
  return (
    <button
      className={["pit", mine && "mine", legal && "legal", hl].filter(Boolean).join(" ")}
      disabled={!legal}
      onClick={() => onPick(i)}
      aria-label={`${label(i)}: ${n} seeds`}
    >
      {n}
      <span className="seeds">{Array.from({ length: Math.min(n, 24) }, (_, k) => <i key={k} />)}</span>
      <small className={mine ? "" : "top"}>{mine ? i + 1 : `AI ${14 - i}`}</small>
    </button>
  );
}

export function BoardView({ pits, store, legal, hl, onPick }: { pits: number[]; store: number[]; legal: Set<number>; hl: Highlight; onPick: (i: number) => void }) {
  const top = [13, 12, 11, 10, 9, 8, 7], bottom = [0, 1, 2, 3, 4, 5, 6];
  const pit = (i: number) => <Pit key={i} i={i} n={pits[i]} legal={legal.has(i)} hl={hl[i]} onPick={onPick} />;
  return (
    <div className="board">
      {top.map(pit)}
      <div className="store">AI<b>{store[1]}</b>captured</div>
      {bottom.map(pit)}
      <div className="store">You<b>{store[0]}</b>captured</div>
    </div>
  );
}

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

export default function App() {
  const [level, setLevel] = useState<Level>("medium");
  const [youFirst, setYouFirst] = useState(false);
  const [speed, setSpeed] = useState(60);
  const [s, setS] = useState<GameState | null>(null);
  const [view, setView] = useState<{ pits: number[]; store: number[]; hl: Highlight } | null>(null);
  const [msg, setMsg] = useState<string>("");
  const [why, setWhy] = useState<AIResult | null>(null);
  const [locked, setLocked] = useState(false);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  /** Plays a move's trace step by step; returns a sentence about what was captured. */
  const animate = useCallback(async (trace: GameEvent[], who: string) => {
    const caps: string[] = [];
    for (const e of trace) {
      if (e.kind === "end") break;
      const cls = ({ lift: "lift", drop: "hot", pasu: "cap", capture: "cap" } as const)[e.kind as "lift"];
      setView({ pits: e.pits, store: e.store, hl: cls ? { [e.pit]: cls } : {} });
      if (e.kind === "pasu") caps.push(`pasu at ${label(e.pit)} (+6)`);
      if (e.kind === "capture") caps.push(`captured ${e.seeds} from ${label(e.pit)}`);
      const d = speedRef.current;
      if (d) await sleep(e.kind === "drop" ? d : d * 3);
    }
    return caps.length ? `${who}: ${caps.join(", ")}.` : `${who}: no capture.`;
  }, []);

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
      <Header repo="pallanguzhi" title="Pallanguzhi" tagline="பல்லாங்குழி, against a Go AI">
        <p>The fourteen-pit mancala game played across Tamil Nadu. You play the bottom row. Lift all seeds from one of your pits and sow them one by one, counter-clockwise. The rules engine and the opponent are Go, compiled to WebAssembly and running in your tab.</p>
      </Header>
      <main>
        <Card wide title="Play">
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
            <span className="muted">speed</span>
            <input type="range" min={0} max={300} value={speed} onChange={(e) => setSpeed(+e.target.value)} aria-label="animation delay" />
          </div>
          <div className="msg" aria-live="polite">{msg}</div>
          {view && <BoardView pits={view.pits} store={view.store} hl={view.hl} legal={legal} onPick={move} />}
        </Card>
        <Card title="Rules">
          <ul className="muted rules">
            <li>After your last seed, if the next pit has seeds, you lift them and keep sowing.</li>
            <li>If the next pit is empty, you capture everything in the pit after it, and your turn ends.</li>
            <li><b>Pasu</b>: any pit you bring to exactly 6 seeds is yours at once.</li>
            <li>When the player to move has no seeds, the round ends; each side keeps the seeds on its row. Most seeds wins.</li>
          </ul>
          <div className="muted">Moving first is a disadvantage in this version: between two random players the second player wins 70% of games.</div>
        </Card>
        <Card title="Why the AI played that">
          <Why r={why} />
        </Card>
      </main>
      <Footer>Single round, following the rules on Wikipedia; village rules vary (multi-round play with "rubbish" pits is not included).</Footer>
    </>
  );
}
