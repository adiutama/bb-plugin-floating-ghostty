import { definePluginApp, useRpc, useBbContext } from "@get-bb/plugin-sdk/app";
import { mountSettingsPresentation } from "./lib/settings-presentation";
import { mountNativeLauncherOverride } from "./lib/native-launcher";
import { FloatingTerminal } from "./components/floating-terminal";
import { windowController } from "./lib/controller";
import type { rpcContract } from "./server";
import "@wterm/dom/css";
import "./styles.css";

function FloatingGhosttyOverlay() {
  const rpc = useRpc<typeof rpcContract>();
  const selection = useBbContext();
  return <FloatingTerminal rpc={rpc} selection={selection} />;
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "native-terminal-launcher",
    mount: () => {
      const releaseLauncher = mountNativeLauncherOverride();
      const releaseSettings = mountSettingsPresentation();
      return () => {
        releaseLauncher();
        releaseSettings();
      };
    },
  });
  app.slots.experimental_appOverlay({
    id: "ghost-window",
    component: FloatingGhosttyOverlay,
  });
  app.slots.sidebarFooterAction({
    id: "toggle",
    icon: "Terminal",
    title: "Floating Ghostty",
    run: () => windowController.toggle(),
  });
});
