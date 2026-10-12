import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { startSync } from "./sync";
import "./index.css";

// Sync gets a moment before the first render, so every component seeds itself
// from data that's already current. It never throws, and never waits long.
startSync().then(() => {
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});
