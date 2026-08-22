import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Root } from "./app/Root";
import { Providers } from "./providers";
import "./app/styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <Providers>
      <Root />
    </Providers>
  </StrictMode>,
);
