import { createRoot } from "react-dom/client";
import "./design/fonts.css";
import "./design/tokens.css";
import "./design/base.css";
import "./design/components.css";
import "./styles/shell.css";
import "./styles/main.css";
import "./styles/windows.css";
import "./styles/sheets.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
