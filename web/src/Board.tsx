import type { Event as GameEvent } from "./types.gen";

export type Highlight = Record<number, "hot" | "lift" | "cap">;
export interface View { pits: number[]; store: number[]; hl: Highlight }

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Names a pit from the viewer's side of the board. The viewer's own pits are
 * numbered 1-7 left to right along the bottom; the opponent's 1-7 left to
 * right along the top. me is 0 (South) or 1 (North).
 */
export function pitName(p: number, me = 0, opponent = "AI") {
  const owner = p < 7 ? 0 : 1;
  if (owner === me) return `your pit ${p - me * 7 + 1}`;
  return `${opponent} pit ${(1 - me) * 7 + 6 - p + 1}`;
}

function Pit({ i, n, legal, hl, onPick, me, opponent }: {
  i: number; n: number; legal: boolean; hl?: string; onPick: (i: number) => void; me: number; opponent: string;
}) {
  const mine = (i < 7 ? 0 : 1) === me;
  const name = pitName(i, me, opponent);
  return (
    <button className={["pit", mine && "mine", legal && "legal", hl].filter(Boolean).join(" ")} disabled={!legal} onClick={() => onPick(i)} aria-label={`${name}: ${n} seeds`}>
      {n}
      <span className="seeds">{Array.from({ length: Math.min(n, 24) }, (_, k) => <i key={k} />)}</span>
      <small className={mine ? "" : "top"}>{mine ? name.split(" ").pop() : `${opponent} ${name.split(" ").pop()}`}</small>
    </button>
  );
}

/** The board as seen by seat `me`: their pits along the bottom, sowing counter-clockwise. */
export function BoardView({ pits, store, legal, hl, onPick, me = 0, names = ["You", "AI"] }: {
  pits: number[]; store: number[]; legal: Set<number>; hl: Highlight; onPick: (i: number) => void; me?: number; names?: [string, string];
}) {
  const own = Array.from({ length: 7 }, (_, k) => me * 7 + k);
  const opp = Array.from({ length: 7 }, (_, k) => (1 - me) * 7 + 6 - k);
  const pit = (i: number) => <Pit key={i} i={i} n={pits[i]} legal={legal.has(i)} hl={hl[i]} onPick={onPick} me={me} opponent={names[1]} />;
  return (
    <div className="board">
      {opp.map(pit)}
      <div className="store">{names[1]}<b>{store[1 - me]}</b>captured</div>
      {own.map(pit)}
      <div className="store">{names[0]}<b>{store[me]}</b>captured</div>
    </div>
  );
}

/**
 * Plays a move's trace step by step through show(); returns a sentence
 * about what it captured. delay() is read on every step so the speed slider
 * takes effect mid-move.
 */
export async function animate(trace: GameEvent[], who: string, show: (v: View) => void, delay: () => number, me = 0, opponent = "AI") {
  const caps: string[] = [];
  for (const e of trace) {
    if (e.kind === "end") break;
    const cls = ({ lift: "lift", drop: "hot", pasu: "cap", capture: "cap" } as const)[e.kind as "lift"];
    show({ pits: e.pits, store: e.store, hl: cls ? { [e.pit]: cls } : {} });
    if (e.kind === "pasu") caps.push(`pasu at ${pitName(e.pit, me, opponent)} (+6)`);
    if (e.kind === "capture") caps.push(`captured ${e.seeds} from ${pitName(e.pit, me, opponent)}`);
    const d = delay();
    if (d) await sleep(e.kind === "drop" ? d : d * 3);
  }
  return caps.length ? `${who}: ${caps.join(", ")}.` : `${who}: no capture.`;
}
