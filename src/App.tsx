import { Toolbar } from "./components/Toolbar";
import { LeftPanel } from "./components/LeftPanel";
import { Inspector } from "./components/Inspector";
import { Viewport } from "./components/Viewport";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";

export default function App() {
  useKeyboardShortcuts();

  return (
    <div className="flex h-full flex-col bg-stage-shell">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <LeftPanel />
        <main className="min-w-0 flex-1">
          <Viewport />
        </main>
        <Inspector />
      </div>

      <ShortcutsModal />
    </div>
  );
}
