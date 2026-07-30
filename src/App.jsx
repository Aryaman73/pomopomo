import Backup from "./Backup";
import History from "./History";
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
          <Backup />
        </header>

        <main className="layout">
          <div className="column">
            <Timer {...timer} />
            <History
              sessions={timer.sessions}
              removeSession={timer.removeSession}
              clearSessions={timer.clearSessions}
            />
          </div>
          <Planner />
        </main>
      </div>
    </>
  );
}
