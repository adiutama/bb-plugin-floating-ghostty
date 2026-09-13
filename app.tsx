import { definePluginApp, useRpc, useBbContext } from "@get-bb/plugin-sdk/app";
import { mountSettingsPresentation } from "./lib/settings-presentation";
import { mountNativeLauncherOverride } from "./lib/native-launcher";
import { FloatingTerminal } from "./components/floating-terminal";
import { ProjectEnvironmentSettings } from "./components/project-environment-settings";
import { windowController } from "./lib/controller";
import type { rpcContract } from "./server";
import "@wterm/dom/css";
import "./styles.css";

function FloatingGhosttyOverlay() {
  const rpc = useRpc<typeof rpcContract>();
  const selection = useBbContext();
  return <FloatingTerminal rpc={rpc} selection={selection} />;
}

function ProjectEnvironmentSettingsSection() {
  const rpc = useRpc<typeof rpcContract>();
  return <ProjectEnvironmentSettings rpc={rpc} />;
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
  app.slots.settingsSection({
    id: "project-environments",
    title: "Project environments",
    description:
      "Browse and edit the environment variables applied to new and restarted Floating Ghostty shells.",
    component: ProjectEnvironmentSettingsSection,
  });
  app.slots.sidebarFooterAction({
    id: "toggle",
    icon: "Terminal",
    title: "Floating Ghostty",
    run: () => windowController.toggle(),
  });
});
