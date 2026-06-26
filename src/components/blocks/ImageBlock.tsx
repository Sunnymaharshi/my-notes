import type { ImageNode } from "../../lib/schema.ts";
import { resolveAsset } from "../../lib/content.ts";
import { useNoteContext } from "./context.ts";
import styles from "./blocks.module.css";

export function ImageBlock({ node }: { node: ImageNode }) {
  const { noteId } = useNoteContext();
  return (
    <figure className={styles.figure}>
      <img
        className={styles.image}
        src={resolveAsset(noteId, node.src)}
        alt={node.alt}
        loading="lazy"
      />
      {node.caption && <figcaption className={styles.caption}>{node.caption}</figcaption>}
    </figure>
  );
}
