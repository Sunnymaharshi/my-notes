import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { Note } from "../../lib/schema.ts";
import { collectCards } from "../../lib/cards.ts";
import styles from "./views.module.css";

const shuffle = <T,>(arr: T[]): T[] => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** "Test me" deck: one card at a time, flip to reveal, keyboard-driven. */
export function FlashcardView({ note }: { note: Note }) {
  const cards = useMemo(() => collectCards(note.body), [note]);
  const [order, setOrder] = useState<number[]>(() => cards.map((_, i) => i));
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);

  // Reset the deck whenever the note (and therefore its cards) changes.
  useEffect(() => {
    setOrder(cards.map((_, i) => i));
    setPos(0);
    setRevealed(false);
  }, [cards]);

  const count = order.length;
  const go = useCallback(
    (delta: number) => {
      if (count === 0) return;
      setPos((p) => (p + delta + count) % count);
      setRevealed(false);
    },
    [count],
  );
  const flip = useCallback(() => setRevealed((r) => !r), []);
  const reshuffle = useCallback(() => {
    setOrder((o) => shuffle(o));
    setPos(0);
    setRevealed(false);
  }, []);

  // Keyboard nav: ←/→ prev/next, Space or Enter flips, "s" shuffles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      if (el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        flip();
      } else if (e.key.toLowerCase() === "s") {
        reshuffle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, flip, reshuffle]);

  if (count === 0) {
    return (
      <p className={styles.cardsEmpty}>
        No flashcards in this note. Add <code>flashcard</code> blocks, or give outline items a
        <code> note</code> — they’ll appear here as cards.
      </p>
    );
  }

  const card = cards[order[pos]];

  return (
    <div className={styles.deck}>
      <div className={styles.deckBar}>
        <span className={styles.deckProgress}>
          {pos + 1} / {count}
        </span>
        <div className={styles.deckTrack}>
          <div className={styles.deckFill} style={{ width: `${((pos + 1) / count) * 100}%` }} />
        </div>
        <button className={styles.deckBtn} onClick={reshuffle} title="Shuffle (s)">
          ⤮ Shuffle
        </button>
      </div>

      <motion.button
        key={`${order[pos]}-${revealed}`}
        className={styles.card}
        onClick={flip}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16 }}
      >
        <span className={styles.cardSide}>{revealed ? "Answer" : "Question"}</span>
        <span className={styles.cardText}>{revealed ? card.a : card.q}</span>
        {card.derived && <span className={styles.cardDerived}>from outline note</span>}
        {!revealed && <span className={styles.cardHint}>click or press Space to flip</span>}
      </motion.button>

      <div className={styles.deckNav}>
        <button className={styles.deckBtn} onClick={() => go(-1)}>
          ← Prev
        </button>
        <button className={styles.deckBtn} onClick={flip}>
          Flip
        </button>
        <button className={styles.deckBtn} onClick={() => go(1)}>
          Next →
        </button>
      </div>
    </div>
  );
}
