import { Toolbar } from "./components/Toolbar";
import { Outliner } from "./components/Outliner";
import { Inspector } from "./components/Inspector";
import { Viewport } from "./components/Viewport";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";

export default function App() {
  useKeyboardShortcuts();

  return (
    <div className="flex h-full flex-col bg-stage-shell">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <Outliner />
        <main className="min-w-0 flex-1">
          <Viewport />
        </main>
        <Inspector />
      </div>
    </div>
  );
}
