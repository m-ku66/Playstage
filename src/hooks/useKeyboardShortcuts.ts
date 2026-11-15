import { useEffect } from "react";
import { useSceneStore } from "../store/sceneStore";
import { useEditorStore } from "../store/editorStore";
import { useCameraStore } from "../store/cameraStore";
import type { ViewName } from "../scene/views";
import { OPPOSITE_VIEW } from "../scene/views";
import {
  newScene,
  openScene,
  saveScene,
  saveSceneAs,
} from "../io/documentActions";

/**
 * Camera view keys, Blender's layout.
 *
 * Keyed on `event.code` rather than `event.key`: with Num Lock off the numpad
 * reports its keys as Home/End/PageUp, so `key` would miss them entirely. The
 * number row is bound to the same views, since plenty of keyboards have no
 * numpad at all.
 */
const VIEW_KEYS: Record<string, ViewName> = {
  Numpad1: "front",
  Digit1: "front",
  Numpad3: "right",
  Digit3: "right",
  Numpad7: "top",
  Digit7: "top",
};

const FLIP_KEYS = ["Numpad9", "Digit9"];
const PROJECTION_KEYS = ["Numpad5", "Digit5"];

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
      const camera = useCameraStore.getState();
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

      // Everything below is a bare letter or digit, so never steal it
      // mid-typing -- otherwise entering a position of 1 would also fling the
      // camera to the front view.
      if (typing) return;

      // --- help -----------------------------------------------------------
      if (e.key === "?") {
        editor.setShortcutsOpen(!editor.shortcutsOpen);
        e.preventDefault();
        return;
      }

      // With the reference up, swallow the editing keys. It is a reading
      // surface, and a stray H or Delete landing behind a modal on an object
      // you cannot see is a genuinely unpleasant surprise.
      if (editor.shortcutsOpen) {
        if (e.key === "Escape") {
          editor.setShortcutsOpen(false);
          e.preventDefault();
        }
        return;
      }

      // --- camera views ---------------------------------------------------
      const view = VIEW_KEYS[e.code];
      if (view) {
        // Ctrl gives the opposite side, as in Blender.
        camera.requestView(mod ? OPPOSITE_VIEW[view] : view);
        e.preventDefault();
        return;
      }
      if (FLIP_KEYS.includes(e.code)) {
        camera.flipView();
        e.preventDefault();
        return;
      }
      if (PROJECTION_KEYS.includes(e.code)) {
        camera.toggleOrthographic();
        e.preventDefault();
        return;
      }

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
        editor.clearSelection();
        e.preventDefault();
        return;
      }

      // --- object operations ----------------------------------------------
      // All of these act on the whole selection as one undo entry.
      const ids = editor.selectedIds;
      if (ids.length === 0) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        scene.deleteObjects(ids);
        e.preventDefault();
        return;
      }
      if (mod && key === "d") {
        scene.duplicateObjects(ids);
        e.preventDefault();
        return;
      }
      if (mod && key === "g") {
        // Shift reverses it, matching the convention everywhere else.
        if (e.shiftKey) scene.ungroupSelection();
        else scene.groupSelection();
        e.preventDefault();
        return;
      }

      // The active object decides which way a mixed selection flips, so the
      // key does what it looks like it will do for the row you just clicked.
      const primary = scene.objects.find((o) => o.id === ids[ids.length - 1]);

      if (!mod && key === "h") {
        if (primary) scene.setVisibleMany(ids, !primary.visible);
        e.preventDefault();
        return;
      }
      if (!mod && key === "l") {
        if (primary) scene.setLockedMany(ids, !primary.locked);
        e.preventDefault();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
