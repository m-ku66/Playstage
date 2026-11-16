import { Toolbar } from "./components/Toolbar";
import { LeftPanel } from "./components/LeftPanel";
import { Inspector } from "./components/Inspector";
import { Viewport } from "./components/Viewport";
import { TextureTray } from "./components/TextureTray";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useTextureSync } from "./hooks/useTextureSync";

export default function App() {
  useKeyboardShortcuts();
  // At the root rather than in the tray: the viewport needs loaded textures
  // whether or not the tray is expanded.
  useTextureSync();

  return (
    <div className="flex h-full flex-col bg-stage-shell">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <LeftPanel />

        {/* The viewport takes the slack and the tray takes what it needs.
            `min-h-0` is what lets the viewport actually shrink when the tray
            expands -- without it a flex child refuses to go below its content
            height and the tray gets pushed off the bottom of the window. */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <Viewport />
          </div>
          <TextureTray />
        </main>

        <Inspector />
      </div>

      <ShortcutsModal />
    </div>
  );
}
