import { createContext, useContext } from "react";

/** Per-note render context (used to resolve note-relative asset URLs). */
export const NoteContext = createContext<{ noteId: string }>({ noteId: "" });
export const useNoteContext = () => useContext(NoteContext);

/** Tree expand/collapse control, provided by NoteView. */
export interface TreeControl {
  isOpen: (path: string) => boolean;
  toggle: (path: string) => void;
}
export const TreeContext = createContext<TreeControl>({
  isOpen: () => true,
  toggle: () => {},
});
export const useTree = () => useContext(TreeContext);
