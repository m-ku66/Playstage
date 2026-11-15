import { useEffect } from "react";
import { useSceneStore } from "../store/sceneStore";
import { useEditorStore } from "../store/editorStore";
import {
  newScene,
  openScene,
  saveScene,
  saveSceneAs,
} from "../io/documentActions";

/**
 * Global editor shortcuts.
 *
 * Deliberately reads stores via getState() instead of subscribing: this hook
 * should install exactly one listener for the life of the app, not re-bind
 * every time the selection changes.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const editor = useEditorStore.getState();
      const scene = useSceneStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const typing = isTypingTarget(e.target);

      // --- undo / redo --------------------------------------------------
      // These stay live even while a field is focused: the browser's own
      // text undo is not what the user means in an editor like this.
      if (mod && key === "z") {
        if (e.shiftKey) scene.redo();
        else scene.undo();
        e.preventDefault();
        return;
      }
      if (mod && key === "y") {
        scene.redo();
        e.preventDefault();
        return;
      }

      // --- document -----------------------------------------------------
      // Also live while a field is focused. Ctrl+S with the cursor in an
      // object-name box still means "save the scene", and the alternative --
      // silently doing nothing -- is how people lose work.
      if (mod && key === "s") {
        if (e.shiftKey) void saveSceneAs();
        else void saveScene();
        e.preventDefault();
        return;
      }
      if (mod && key === "o") {
        void openScene();
        e.preventDefault();
        return;
      }
      if (mod && key === "n") {
        void newScene();
        e.preventDefault();
        return;
      }

      // Everything below is a bare letter, so never steal it mid-typing.
      if (typing) return;

      const id = editor.selectedId;

      // --- gizmo modes --------------------------------------------------
      if (!mod && key === "w") {
        editor.setTransformMode("translate");
        e.preventDefault();
        return;
      }
      if (!mod && key === "e") {
        editor.setTransformMode("rotate");
        e.preventDefault();
        return;
      }
      if (!mod && key === "r") {
        editor.setTransformMode("scale");
        e.preventDefault();
        return;
      }

      // --- snapping -------------------------------------------------------
      if (!mod && key === "x") {
        editor.toggleSnap();
        e.preventDefault();
        return;
      }

      // --- selection ------------------------------------------------------
      if (e.key === "Escape") {
        editor.select(null);
        e.preventDefault();
        return;
      }

      // --- object operations ----------------------------------------------
      if (!id) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        scene.deleteObject(id);
        e.preventDefault();
        return;
      }
      if (mod && key === "d") {
        scene.duplicateObject(id);
        e.preventDefault();
        return;
      }
      if (!mod && key === "h") {
        const obj = scene.objects.find((o) => o.id === id);
        if (obj) scene.setVisible(id, !obj.visible);
        e.preventDefault();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
