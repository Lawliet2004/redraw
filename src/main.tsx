import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Self-hosted Excalidraw fonts (copied to public/fonts)
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH =
  "/";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
