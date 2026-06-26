/**
 * Catalog editor (local admin): create/edit/delete domains and categories, persisted to
 * content/domains.json and content/categories.json via the admin API. Domains are saved
 * first so categories can reference newly-added domains. The same Zod schemas validate on
 * the server as at build time.
 */
import { useState } from "react";
import type { Category, Domain } from "../../src/lib/schema.ts";
import { api, ApiError } from "./api.ts";

export function CatalogDialog({
  categories,
  domains,
  onClose,
  onSaved,
}: {
  categories: Category[];
  domains: Domain[];
  onClose: () => void;
  onSaved: (categories: Category[], domains: Domain[]) => void;
}) {
  // `__origId` tags a row that loaded from an existing category, so editing its `id`
  // reads as a rename (cascaded into referencing notes on save) rather than delete + add.
  type CatRow = Category & { __origId?: string };
  const [doms, setDoms] = useState<Domain[]>(() => domains.map((d) => ({ ...d })));
  const [cats, setCats] = useState<CatRow[]>(() =>
    categories.map((c) => ({ ...c, __origId: c.id })),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patchDom = (i: number, patch: Partial<Domain>) =>
    setDoms((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const patchCat = (i: number, patch: Partial<Category>) =>
    setCats((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const addDom = () =>
    setDoms((ds) => [...ds, { id: "", label: "", color: "", order: ds.length + 1 }]);
  const addCat = () =>
    setCats((cs) => [
      ...cs,
      { id: "", label: "", domain: doms[0]?.id ?? "", color: "", order: cs.length + 1 },
    ]);
  const delDom = (i: number) => setDoms((ds) => ds.filter((_, j) => j !== i));
  const delCat = (i: number) => setCats((cs) => cs.filter((_, j) => j !== i));

  // Reorder by swapping array neighbours; `order` is (re)assigned from position on save,
  // so the list order you see is the order that ships.
  const swap = <T,>(arr: T[], i: number, j: number): T[] => {
    if (j < 0 || j >= arr.length) return arr;
    const next = [...arr];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };
  const moveDom = (i: number, dir: -1 | 1) => setDoms((ds) => swap(ds, i, i + dir));
  const moveCat = (i: number, dir: -1 | 1) => setCats((cs) => swap(cs, i, i + dir));

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      // Renames: a row that loaded with one id but now carries another (cascades to notes).
      const renames: Record<string, string> = {};
      for (const c of cats) {
        if (c.__origId && c.__origId !== c.id) renames[c.__origId] = c.id;
      }
      // Drop empty color strings and the __origId tag; `order` follows list position.
      const cleanDoms = doms.map((d, i) => ({ ...d, color: d.color || undefined, order: i + 1 }));
      const cleanCats = cats.map(({ __origId, ...c }, i) => ({
        ...c,
        color: c.color || undefined,
        order: i + 1,
      }));
      const savedDoms = await api.saveDomains(cleanDoms);
      const savedCats = await api.saveCategories(cleanCats, renames);
      onSaved(savedCats, savedDoms);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.issues) {
        const i = e.issues[0];
        setError(`${i.path.join(".") || "(root)"}: ${i.message}`);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modal catalogModal" onClick={(e) => e.stopPropagation()}>
        <h2>Manage catalog</h2>

        <div className="catalogCols">
          <section className="catalogCol">
            <div className="paneHead">
              Domains
              <span className="spacer" />
              <button className="tiny" onClick={addDom}>+ domain</button>
            </div>
            <div className="catalogRows">
              {doms.map((d, i) => (
                <div className="catalogRow" key={i}>
                  <input className="cId" placeholder="id" value={d.id} onChange={(e) => patchDom(i, { id: e.target.value })} />
                  <input placeholder="label" value={d.label} onChange={(e) => patchDom(i, { label: e.target.value })} />
                  <input className="cColor" placeholder="#color" value={d.color ?? ""} onChange={(e) => patchDom(i, { color: e.target.value })} />
                  <button className="tiny" title="Move up" disabled={i === 0} onClick={() => moveDom(i, -1)}>↑</button>
                  <button className="tiny" title="Move down" disabled={i === doms.length - 1} onClick={() => moveDom(i, 1)}>↓</button>
                  <button className="tiny danger" title="Delete" onClick={() => delDom(i)}>✕</button>
                </div>
              ))}
            </div>
          </section>

          <section className="catalogCol">
            <div className="paneHead">
              Categories
              <span className="spacer" />
              <button className="tiny" onClick={addCat}>+ category</button>
            </div>
            <div className="catalogRows">
              {cats.map((c, i) => (
                <div className="catalogRow" key={i}>
                  <input className="cId" placeholder="id" value={c.id} onChange={(e) => patchCat(i, { id: e.target.value })} />
                  <input placeholder="label" value={c.label} onChange={(e) => patchCat(i, { label: e.target.value })} />
                  <select value={c.domain} onChange={(e) => patchCat(i, { domain: e.target.value })}>
                    {!doms.some((d) => d.id === c.domain) && <option value={c.domain}>{c.domain || "—"}</option>}
                    {doms.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label || d.id}
                      </option>
                    ))}
                  </select>
                  <input className="cColor" placeholder="#color" value={c.color ?? ""} onChange={(e) => patchCat(i, { color: e.target.value })} />
                  <button className="tiny" title="Move up" disabled={i === 0} onClick={() => moveCat(i, -1)}>↑</button>
                  <button className="tiny" title="Move down" disabled={i === cats.length - 1} onClick={() => moveCat(i, 1)}>↓</button>
                  <button className="tiny danger" title="Delete" onClick={() => delCat(i)}>✕</button>
                </div>
              ))}
            </div>
          </section>
        </div>

        {error && <div className="paneError">{error}</div>}
        <p className="hint">
          Use ↑/↓ to reorder — the list order is the order shown in the sidebar (saved as
          <code> order</code>). Renaming a category's id updates every note that uses it. Deleting
          a category that notes still use is blocked — reassign or rename those notes first.
        </p>

        <div className="modalActions">
          <button onClick={onClose}>Cancel</button>
          <span className="spacer" />
          <button className="primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save catalog"}
          </button>
        </div>
      </div>
    </div>
  );
}
