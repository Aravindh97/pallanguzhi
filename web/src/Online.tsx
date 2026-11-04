import { useEffect, useRef, useState } from "react";
import { animate, BoardView, type View } from "./Board";
import { Action, Card, Pill } from "./lib/ui";
import { createRoom, onlineAvailable, useRoom, type Status } from "./online";
import type { State } from "./types.gen";

const nameKey = "pallanguzhi:name";

export function roomLink(code: string) {
  return `${location.origin}${location.pathname}?room=${code}`;
}

function statusPill(s: Status) {
  if (s === "online") return <Pill tone="ok">connected</Pill>;
  if (s === "reconnecting") return <Pill tone="warn">reconnecting…</Pill>;
  return <Pill>connecting…</Pill>;
}

/** What to say about the current position, from the viewer's side. */
export function headline(st: State, seat: number) {
  const [s, n] = st.players;
  const who = (i: number) => (i === seat ? "You" : st.players[i].name || (i === 0 ? "South" : "North"));
  if (!n.joined || !s.joined) return "Waiting for a second player. Send them the link.";
  if (st.over) {
    const [a, b] = st.final;
    const win = a === b ? -1 : a > b ? 0 : 1;
    const result = win < 0 ? "Draw." : win === seat ? "You win!" : `${who(win)} wins.`;
    return `Game over: ${who(0)} ${a}, ${who(1)} ${b}. ${result}`;
  }
  const t = st.board.turn;
  if (t === seat) return "Your move: click a glowing pit.";
  return `${who(t)} to move${st.players[t].online ? "…" : " (disconnected; their seat is kept for them)"}`;
}

function Room({ code, name, onLeave, speed }: { code: string; name: string; onLeave: () => void; speed: number }) {
  const { status, seat, state, error, send } = useRoom(code, name, true);
  const [view, setView] = useState<View | null>(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const shown = useRef(-1);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const me = seat === 1 ? 1 : 0;
  const names: [string, string] = state
    ? [seat === -1 ? state.players[me].name || "South" : "You", state.players[1 - me].name || (me === 0 ? "North" : "South")]
    : ["You", "Opponent"];

  // Animate each new move once, then show the final position.
  useEffect(() => {
    if (!state || state.version === shown.current) return;
    let cancelled = false;
    const prev = shown.current;
    shown.current = state.version;
    setPending(false);
    (async () => {
      const lm = state.last_move;
      if (lm?.trace && prev >= 0 && state.version === prev + 1) {
        const who = lm.seat === seat ? "You" : state.players[lm.seat].name || "Opponent";
        const text = await animate(lm.trace, `${who} lifted ${lm.seat === me ? "pit" : `their pit`} ${lm.pit % 7 + 1}`, (v) => !cancelled && setView(v), () => speedRef.current, me, names[1]);
        if (!cancelled) setNote(text);
      }
      if (!cancelled) setView({ pits: state.board.pits, store: state.board.store, hl: {} });
    })();
    return () => {
      cancelled = true;
    };
    // names and me derive from state and seat
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (error) setPending(false);
  }, [error]);

  const myTurn = !!state && seat !== null && seat >= 0 && !state.over && state.board.turn === seat && state.players[1 - seat].joined;
  const legal = new Set(myTurn && !pending ? state!.moves ?? [] : []);
  const copy = async () => {
    await navigator.clipboard?.writeText(roomLink(code));
    setNote("Link copied.");
  };
  return (
    <Card wide title={<>Room <span className="mono">{code}</span></>}>
      <div className="row">
        {statusPill(status)}
        {seat === -1 && <Pill>watching</Pill>}
        {state && state.players.map((p, i) => (
          <span key={i} className="player"><i className={"dot" + (p.online ? " on" : "")} />{i === 0 ? "South" : "North"}: <b>{p.joined ? p.name : "empty seat"}</b>{i === seat && " (you)"}</span>
        ))}
        {state && state.spectators > 0 && <span className="muted">{state.spectators} watching</span>}
        <span style={{ flex: 1 }} />
        <button className="ghost" onClick={copy}>Copy invite link</button>
        <button className="ghost" onClick={onLeave}>Leave</button>
      </div>
      <div className="msg" aria-live="polite">{state ? headline(state, seat ?? -1) : "Connecting to the room…"} <span className="muted">{note}</span></div>
      {error && <div className="bad">{error}</div>}
      {view && <BoardView pits={view.pits} store={view.store} hl={view.hl} legal={legal} me={me} names={names}
        onPick={(p) => { setPending(true); send({ type: "move", pit: p, version: state!.version }); }} />}
      {state?.over && seat !== null && seat >= 0 && (
        <div className="row" style={{ marginTop: 10 }}>
          <button onClick={() => send({ type: "rematch" })} disabled={state.rematch[seat]}>{state.rematch[seat] ? "Waiting for the other player…" : "Play again"}</button>
          {state.rematch[1 - seat] && !state.rematch[seat] && <span className="muted">{state.players[1 - seat].name} wants a rematch.</span>}
        </div>
      )}
      <div className="muted" style={{ marginTop: 22 }}>The server owns the board: it checks every move is legal, in turn and made against the latest position, so a double-click or a stale tab can't play twice. Closing the tab keeps your seat; open the link again to continue. Rooms are deleted 15 minutes after everyone leaves.</div>
    </Card>
  );
}

export default function Online({ room, setRoom, speed }: { room: string | null; setRoom: (c: string | null) => void; speed: number }) {
  const [name, setName] = useState(() => localStorage.getItem(nameKey) ?? "");
  const [join, setJoin] = useState("");
  const [waking, setWaking] = useState(false);
  // Someone opening an invite link is asked their name once before joining.
  const [ready, setReady] = useState(() => !!localStorage.getItem(nameKey));
  useEffect(() => {
    localStorage.setItem(nameKey, name);
  }, [name]);
  if (!onlineAvailable())
    return <Card wide title="Play a friend online"><p>Online play needs the game server, which this copy of the page isn't connected to.</p></Card>;
  if (room && !ready)
    return (
      <Card wide title={<>Join room <span className="mono">{room}</span></>}>
        <form className="row" onSubmit={(e) => { e.preventDefault(); setReady(true); }}>
          Your name <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="Player" aria-label="your name" autoFocus />
          <button type="submit">Join the game</button>
          <button type="button" className="ghost" onClick={() => setRoom(null)}>Cancel</button>
        </form>
        <div className="muted">If both seats are taken you'll watch instead.</div>
      </Card>
    );
  if (room) return <Room code={room} name={name || "Player"} onLeave={() => setRoom(null)} speed={speed} />;
  return (
    <Card wide title="Play a friend online">
      <div className="row">
        Your name <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="Player" aria-label="your name" />
        <Action onRun={async () => {
          const t = setTimeout(() => setWaking(true), 2500);
          try {
            setReady(true);
            setRoom(await createRoom());
          } finally {
            clearTimeout(t);
            setWaking(false);
          }
        }}>Create a room</Action>
        <span className="muted">or join</span>
        <input value={join} onChange={(e) => setJoin(e.target.value.toUpperCase())} maxLength={6} size={8} placeholder="CODE" aria-label="room code" className="mono" />
        <button className="ghost" disabled={join.length !== 6} onClick={() => setRoom(join)}>Join</button>
      </div>
      {waking && <div className="warn">Waking the server up. It runs on a free plan that sleeps after 15 idle minutes, so the first request can take up to a minute.</div>}
      <div className="muted">Create a room, send the link to a friend, and play on two phones or computers. Anyone else who opens the link watches.</div>
    </Card>
  );
}
