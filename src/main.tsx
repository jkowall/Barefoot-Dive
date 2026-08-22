import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { registerPwa } from "./platform/pwa";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>
);

registerPwa();
