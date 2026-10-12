import Backup from "./Backup";
import Dailies from "./Dailies";
import History from "./History";
import Planner from "./Planner";
import SyncPanel from "./SyncPanel";
import Timer from "./Timer";
import { useDailies } from "./useDailies";
import { useTimer } from "./useTimer";

export default function App() {
  const timer = useTimer();
  const dailies = useDailies();

  return (
    <>
      <div className="backdrop" aria-hidden="true" />
      <div className="app">
        <header className="masthead">
          <h1 className="wordmark">pomopomo</h1>
          <SyncPanel />
          <Backup />
        </header>

        <main className="layout">
          <div className="column">
            <Timer {...timer} />
            <History
              sessions={timer.sessions}
              removeSession={timer.removeSession}
              clearSessions={timer.clearSessions}
              dailies={dailies}
            />
          </div>
          <div className="column">
            <Planner />
            <Dailies dailies={dailies} />
          </div>
        </main>
      </div>
    </>
  );
}
