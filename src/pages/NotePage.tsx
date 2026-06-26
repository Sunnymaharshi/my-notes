import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { Note } from "../lib/schema.ts";
import { fetchNote } from "../lib/content.ts";
import { NoteView } from "../components/NoteView.tsx";
import styles from "./pages.module.css";

export function NotePage() {
  const { id = "" } = useParams();
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setNote(null);
    setError(null);
    fetchNote(id)
      .then((n) => !cancelled && setNote(n))
      .catch((err) => !cancelled && setError(String(err.message ?? err)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) return <div className={styles.dim}>Couldn’t load note: {error}</div>;
  if (!note) return <div className={styles.dim}>Loading…</div>;
  return <NoteView note={note} />;
}
