import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import { FloatingTerminal } from "./components/floating-terminal";
import { windowController } from "./lib/controller";
import type { rpcContract } from "./server";
import "@wterm/dom/css";
import "./styles.css";

function FloatingGhosttyOverlay() {
  const rpc = useRpc<typeof rpcContract>();
  return <FloatingTerminal rpc={rpc} />;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "ghost-window",
    component: FloatingGhosttyOverlay,
  });
  app.slots.sidebarFooterAction({
    id: "toggle",
    icon: "Terminal",
    title: "Floating Ghostty (Ctrl+Shift+`)",
    run: () => windowController.toggle(),
  });
});
