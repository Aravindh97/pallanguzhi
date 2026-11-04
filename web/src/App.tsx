import { useEffect, useState } from "react";
import "./app.css";
import { Card, Footer, Header } from "./lib/ui";
import Online from "./Online";
import Solo from "./Solo";

type Mode = "ai" | "online";
const roomFromURL = () => new URLSearchParams(location.search).get("room")?.toUpperCase() ?? null;

export default function App() {
  const [room, setRoomState] = useState<string | null>(roomFromURL);
  const [mode, setMode] = useState<Mode>(room ? "online" : "ai");
  const [speed, setSpeed] = useState(60);
  // The room code lives in the URL, so the link is the invite and Back works.
  const setRoom = (code: string | null) => {
    const u = new URL(location.href);
    if (code) u.searchParams.set("room", code);
    else u.searchParams.delete("room");
    history.pushState(null, "", u);
    setRoomState(code);
  };
  useEffect(() => {
    const onPop = () => setRoomState(roomFromURL());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  return (
    <>
      <Header repo="pallanguzhi" title="Pallanguzhi" tagline="பல்லாங்குழி, against the AI or a friend">
        <p>The fourteen-pit mancala game played across Tamil Nadu. Lift all seeds from one of your pits and sow them one by one, counter-clockwise. Play the Go AI in your tab (WebAssembly), or a friend online through the Go game server.</p>
      </Header>
      <main>
        <div className="wide row tabs" role="tablist">
          <button role="tab" aria-selected={mode === "ai"} className={mode === "ai" ? "" : "ghost"} onClick={() => setMode("ai")}>Play the AI</button>
          <button role="tab" aria-selected={mode === "online"} className={mode === "online" ? "" : "ghost"} onClick={() => setMode("online")}>Play a friend online</button>
          <span style={{ flex: 1 }} />
          <span className="muted">animation speed</span>
          <input type="range" min={0} max={300} value={300 - speed} onChange={(e) => setSpeed(300 - +e.target.value)} aria-label="animation speed" />
        </div>
        {mode === "ai" ? <Solo speed={speed} /> : <Online room={room} setRoom={setRoom} speed={speed} />}
        <Card wide title="Rules">
          <ul className="muted rules">
            <li>After your last seed, if the next pit has seeds, you lift them and keep sowing.</li>
            <li>If the next pit is empty, you capture everything in the pit after it, and your turn ends.</li>
            <li><b>Pasu</b>: any pit you bring to exactly 6 seeds is yours at once.</li>
            <li>When the player to move has no seeds, the round ends; each side keeps the seeds on its row. Most seeds wins.</li>
          </ul>
          <div className="muted">Moving first is a disadvantage in this version: between two random players the second player wins 70% of games.</div>
        </Card>
      </main>
      <Footer>Single round, following the rules on Wikipedia; village rules vary (multi-round play with "rubbish" pits is not included).</Footer>
    </>
  );
}
