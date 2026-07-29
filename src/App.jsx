import Planner from "./Planner";
import Timer from "./Timer";
import { useTimer } from "./useTimer";

export default function App() {
  const timer = useTimer();

  return (
    <>
      <div className="backdrop" aria-hidden="true" />
      <div className="app">
        <header className="masthead">
          <h1 className="wordmark">pomopomo</h1>
          <p className="tagline">focus · plan · repeat</p>
        </header>

        <main className="layout">
          <Timer {...timer} />
          <Planner />
        </main>

        <footer className="footer">
          Everything lives in your browser — no account, no server, nothing sent
          anywhere. Clearing site data clears your planner.
        </footer>
      </div>
    </>
  );
}
