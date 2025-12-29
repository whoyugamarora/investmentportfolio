import React, { useEffect, useMemo, useState, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import SiteHeader from "../Components/SiteHeader"; // top nav/header
import { auth, db } from "../Authentication/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

/* ----------------------- Small helpers ----------------------- */
function useAuthUid() {
  const [uid, setUid] = useState(null);
  useEffect(() => {
    const off = auth.onAuthStateChanged((u) => setUid(u ? u.uid : null));
    return () => off();
  }, []);
  return uid;
}

function clsx(...xs) {
  return xs.filter(Boolean).join(" ");
}

/* Markdown to simple HTML */
function mdToHtml(md = "") {
  const esc = (s) =>
    s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  let html = esc(md);
  html = html
    .replace(/^###\s?(.*)$/gm, '<h3 class="text-lg font-semibold mt-4">$1<\/h3>')
    .replace(/^##\s?(.*)$/gm, '<h2 class="text-xl font-bold mt-5">$1<\/h2>')
    .replace(/^#\s?(.*)$/gm, '<h1 class="text-2xl font-bold mt-6">$1<\/h1>')
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1<\/strong>")
    .replace(/\*(.*?)\*/g, "<em>$1<\/em>")
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-black\/5">$1<\/code>');
  html = html.replace(/(^|\n)-\s+(.*?)(?=\n(?!-\s)|$)/gms, (m) => {
    const items = m
      .trim()
      .split(/\n-\s+/)
      .map((x) => x.replace(/^-/, "").trim());
    return `\n<ul class="list-disc ml-6 my-2">${items
      .map((i) => `<li>${i}<\/li>`)
      .join("")}</ul>`;
  });
  html = html.replace(
    /^(?!<h\d|<ul|<li|<pre|<code)(.+)$/gm,
    '<p class="my-2">$1<\/p>'
  );
  return html;
}

function useDebounce(value, delay = 600) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/* ------------------------- Component ------------------------- */
export default function CompanyNotes() {
  const uid = useAuthUid();
  const { code: routeCode } = useParams();
  const [searchParams] = useSearchParams();
  const portfolioId = searchParams.get("pf") || "default";

  const [selectedCode, setSelectedCode] = useState(routeCode || "");
  const [list, setList] = useState([]);
  const [holdings, setHoldings] = useState([]);
  const [content, setContent] = useState("");
  const [tags, setTags] = useState([]);
  const [links, setLinks] = useState([]);
  const [company, setCompany] = useState("");
  const [rating, setRating] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [snapForm, setSnapForm] = useState({
    date: "",
    price: "",
    pe: "",
    pb: "",
    eps: "",
    note: "",
  });
  const [filter, setFilter] = useState("");

  // Save UX
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null); // Date
  const [lastSavedSig, setLastSavedSig] = useState("");

  const debouncedContent = useDebounce(content, 600);

  const makeSig = (c = debouncedContent) =>
    JSON.stringify({ company, content: c, tags, links, pinned, rating, selectedCode, portfolioId });

  /* Load Notes List */
  useEffect(() => {
    if (!uid) return;
    const colRef = collection(db, "users", uid, "portfolios", portfolioId, "notes");
    const q = query(colRef, orderBy("pinned", "desc"), orderBy("updatedAt", "desc"));
    return onSnapshot(q, (ss) =>
      setList(ss.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
  }, [uid, portfolioId]);

  /* Load Holdings */
  useEffect(() => {
    if (!uid) return;
    const colRef = collection(db, "users", uid, "portfolios", portfolioId, "holdings");
    const q = query(colRef, orderBy("Company"));
    return onSnapshot(q, (ss) => {
      const rows = ss.docs.map((d) => {
        const x = d.data();
        const code = x.code || x["Company Code"] || d.id;
        const name = x.company || x.Company || d.id;
        return { id: d.id, code, company: name, raw: x };
      });
      setHoldings(rows);
      if (!selectedCode && routeCode) {
        const hit = rows.find((r) => r.code === routeCode || r.id === routeCode);
        if (hit) setSelectedCode(hit.code);
      }
    });
  }, [uid, portfolioId]);

  /* Load or init one Note */
  useEffect(() => {
    if (!uid || !selectedCode) return;
    const dref = doc(db, "users", uid, "portfolios", portfolioId, "notes", selectedCode);
    getDoc(dref).then((ds) => {
      if (ds.exists()) {
        const data = ds.data();
        setCompany(data.company || deriveCompanyFromHolding(selectedCode, holdings));
        setContent(data.content || "");
        setTags(Array.isArray(data.tags) ? data.tags : []);
        setLinks(Array.isArray(data.links) ? data.links : []);
        setPinned(!!data.pinned);
        setRating(Number(data.rating || 0));
        // establish clean signature
        setLastSavedSig(
          JSON.stringify({
            company: data.company || deriveCompanyFromHolding(selectedCode, holdings) || "",
            content: data.content || "",
            tags: Array.isArray(data.tags) ? data.tags : [],
            links: Array.isArray(data.links) ? data.links : [],
            pinned: !!data.pinned,
            rating: Number(data.rating || 0),
            selectedCode,
            portfolioId,
          })
        );
        setSavedAt(null);
      } else {
        const inferredName = deriveCompanyFromHolding(selectedCode, holdings);
        setCompany(inferredName || "");
        setContent("");
        setTags([]);
        setLinks([]);
        setPinned(false);
        setRating(0);
        setLastSavedSig(makeSig("")); // fresh unsaved
        setSavedAt(null);
      }
    });

    const snapsCol = collection(
      db,
      "users",
      uid,
      "portfolios",
      portfolioId,
      "notes",
      selectedCode,
      "snapshots"
    );
    const q = query(snapsCol, orderBy("date", "desc"));
    const off = onSnapshot(q, (ss) =>
      setSnapshots(ss.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    return () => off();
  }, [uid, portfolioId, selectedCode, holdings.length]);

  /* Auto Save */
  useEffect(() => {
    if (!uid || !selectedCode) return;
    const sig = makeSig();
    if (sig === lastSavedSig) return; // nothing changed

    const save = async () => {
      setIsSaving(true);
      const dref = doc(db, "users", uid, "portfolios", portfolioId, "notes", selectedCode);
      const payload = {
        company: company || deriveCompanyFromHolding(selectedCode, holdings) || selectedCode,
        code: selectedCode,
        content: debouncedContent,
        tags,
        links,
        pinned,
        rating: Number(rating || 0),
        updatedAt: serverTimestamp(),
      };
      await setDoc(dref, { createdAt: serverTimestamp(), ...payload }, { merge: true });
      setIsSaving(false);
      setSavedAt(new Date());
      setLastSavedSig(sig);
    };
    save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedContent, tags, links, pinned, rating, company, uid, selectedCode, portfolioId]);

  /* Manual Save (Save button + Ctrl/Cmd+S) */
  const saveNow = async () => {
    if (!uid || !selectedCode) return;
    const sig = makeSig(content);
    setIsSaving(true);
    const dref = doc(db, "users", uid, "portfolios", portfolioId, "notes", selectedCode);
    const payload = {
      company: company || deriveCompanyFromHolding(selectedCode, holdings) || selectedCode,
      code: selectedCode,
      content,
      tags,
      links,
      pinned,
      rating: Number(rating || 0),
      updatedAt: serverTimestamp(),
    };
    await setDoc(dref, { createdAt: serverTimestamp(), ...payload }, { merge: true });
    setIsSaving(false);
    setSavedAt(new Date());
    setLastSavedSig(sig);
  };

  // Delete entire Note (CRUD: D)
  const deleteNote = async () => {
    if (!uid || !selectedCode) return;
    if (!confirm(`Delete note for ${selectedCode}? This will remove its content (snapshots remain).`)) return;
    await deleteDoc(doc(db, "users", uid, "portfolios", portfolioId, "notes", selectedCode));
    setContent("");
    setTags([]);
    setLinks([]);
    setPinned(false);
    setRating(0);
    setCompany(deriveCompanyFromHolding(selectedCode, holdings) || "");
    setLastSavedSig(makeSig(""));
    setSavedAt(null);
  };

  // Ctrl/Cmd+S shortcut (stable)
  const saveNowRef = useRef(saveNow);
  useEffect(() => { saveNowRef.current = saveNow; });
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "s") {
        e.preventDefault();
        if (saveNowRef.current) saveNowRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const holdingForSelected = useMemo(
    () => holdings.find((h) => h.code === selectedCode) || null,
    [holdings, selectedCode]
  );
  const html = useMemo(() => mdToHtml(content), [content]);
  const isDirty = makeSig(content) !== lastSavedSig;

  /* ------ Derived / filtered lists ------ */
  const filteredHoldings = useMemo(() => {
    const f = filter.toLowerCase();
    if (!f) return holdings;
    return holdings.filter((h) =>
      h.company.toLowerCase().includes(f) || h.code.toLowerCase().includes(f)
    );
  }, [holdings, filter]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Global nav/header */}
      {typeof SiteHeader === "function" && <SiteHeader />}

      {/* Page header */}
      <header className="border-b bg-white/70 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">Company Notes</h1>
            <p className="text-sm text-slate-600">
              Portfolio: <span className="font-mono">{portfolioId}</span>
            </p>
          </div>
          <div className="hidden md:flex items-center gap-3">
            <div className="text-xs text-slate-500">
              {isSaving ? "Saving…" : savedAt ? `Saved ${timeAgo(savedAt)}` : "Draft"}
            </div>
            <button
              onClick={saveNow}
              className={clsx(
                "group inline-flex items-center gap-2 px-4 py-2 rounded-full shadow-sm border transition focus:outline-none focus:ring-2 focus:ring-offset-2",
                isDirty
                  ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white border-indigo-700 hover:from-indigo-500 hover:to-violet-500"
                  : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
              )}
              disabled={!isDirty}
              title="Ctrl/Cmd + S"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={createNewNote}
              className="px-3 py-2 rounded-full border hover:bg-slate-50"
              title="Create/Load note for current code"
            >
              New / Open
            </button>
            <button
              onClick={deleteNote}
              className="px-3 py-2 rounded-full border hover:bg-red-50 text-red-600 border-red-300"
              title="Delete this note"
            >
              Delete
            </button>
            <a
              href={`/notes/${encodeURIComponent(selectedCode || "")}?pf=${encodeURIComponent(portfolioId)}`}
              className="px-4 py-2 rounded-full border hover:bg-slate-50"
            >
              Share
            </a>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-4">
        <div className="grid grid-cols-12 gap-4">
          {/* Sidebar */}
          <aside className="col-span-12 md:col-span-4 lg:col-span-3">
            <div className="sticky top-[72px] space-y-3">
              <div className="rounded-2xl border bg-white shadow-sm">
                <div className="p-3 border-b bg-slate-50/60 rounded-t-2xl">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Holdings</div>
                </div>
                <div className="p-3 border-b">
                  <div className="flex gap-2">
                    <input
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="Search companies or code"
                      className="w-full px-3 py-2 border rounded-lg"
                    />
                    <input
                      value={selectedCode}
                      onChange={(e) => setSelectedCode(e.target.value.trim())}
                      placeholder="Code"
                      className="w-40 px-3 py-2 border rounded-lg"
                    />
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={createNewNote}
                      className="w-full px-3 py-2 rounded-lg bg-black text-white hover:bg-black/90"
                    >
                      Open Note
                    </button>
                    <button
                      onClick={saveNow}
                      className={clsx(
                        "px-3 py-2 rounded-lg border",
                        isDirty ? "border-black hover:bg-black/5" : "opacity-60 cursor-not-allowed"
                      )}
                      disabled={!isDirty}
                      title="Ctrl/Cmd + S"
                    >
                      Save
                    </button>
                  </div>
                </div>
                <ul className="max-h-[60vh] overflow-auto divide-y">
                  {filteredHoldings.map((h) => {
                    const hasNote = !!list.find((n) => n.code === h.code);
                    const isActive = selectedCode === h.code;
                    return (
                      <li key={h.id}>
                        <button
                          onClick={() => setSelectedCode(h.code)}
                          className={clsx(
                            "w-full text-left px-3 py-2",
                            isActive ? "bg-slate-100" : "hover:bg-slate-50"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="truncate font-medium">{h.company}</div>
                            <div className="text-xs">{hasNote ? "📝" : ""}</div>
                          </div>
                          <div className="text-xs text-slate-600 truncate">{h.code}</div>
                        </button>
                      </li>
                    );
                  })}
                  {filteredHoldings.length === 0 && (
                    <li className="p-3 text-sm text-slate-500">No matches</li>
                  )}
                </ul>
              </div>

              {list.length > 0 && (
                <div className="rounded-2xl border bg-white shadow-sm">
                  <div className="p-3 border-b bg-slate-50/60 rounded-t-2xl">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Your Notes</div>
                  </div>
                  <ul className="max-h-[40vh] overflow-auto divide-y">
                    {list.map((n) => (
                      <li key={n.code}>
                        <button
                          onClick={() => setSelectedCode(n.code)}
                          className={clsx(
                            "w-full text-left px-3 py-2",
                            selectedCode === n.code ? "bg-slate-100" : "hover:bg-slate-50"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="truncate font-medium">{n.company || n.code}</div>
                            {n.pinned && <span className="text-xs">📌</span>}
                          </div>
                          <div className="text-xs text-slate-600 truncate">{n.code}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </aside>

          {/* Editor */}
          <main className="col-span-12 md:col-span-8 lg:col-span-9 space-y-4">
            {holdingForSelected && (
              <div className="rounded-2xl border bg-white shadow-sm p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-slate-500">Linked holding</div>
                    <div className="font-semibold text-lg">
                      {holdingForSelected.company}{" "}
                      <span className="font-mono text-slate-500">
                        ({holdingForSelected.code})
                      </span>
                    </div>
                  </div>
                  <div className="text-sm grid grid-flow-col auto-cols-max gap-6">
                    {renderFact(holdingForSelected.raw, "Quantity")}
                    {renderFact(holdingForSelected.raw, "Buy Price", "Avg Buy")}
                    {renderFact(holdingForSelected.raw, "Current Price")}
                    {renderFact(holdingForSelected.raw, "Sector")}
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-2xl border bg-white shadow-sm p-4">
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-12 md:col-span-6">
                  <label className="text-xs uppercase text-slate-500">Company</label>
                  <input
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Company name"
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div className="col-span-6 md:col-span-3">
                  <label className="text-xs uppercase text-slate-500">Rating</label>
                  <StarRating value={rating} onChange={setRating} />
                </div>
                <div className="col-span-6 md:col-span-3 flex items-end">
                  <button
                    onClick={() => setPinned(!pinned)}
                    className={clsx(
                      "w-full px-3 py-2 rounded-lg border",
                      pinned ? "bg-yellow-100 border-yellow-400" : "hover:bg-slate-50"
                    )}
                  >
                    {pinned ? "Pinned" : "Pin Note"}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-12 gap-3 mt-3">
                <TagEditor tags={tags} onAdd={addTag} onRemove={removeTag} />
                <LinkEditor links={links} onAdd={addLink} onRemove={removeLink} />
              </div>
            </div>

            <div className="grid grid-cols-12 gap-4">
              <section className="col-span-12 md:col-span-6 rounded-2xl border bg-white shadow-sm p-3">
                <label className="text-xs uppercase tracking-wide text-slate-500">Notes (Markdown)</label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={`# Thesis\n\n- Moat...\n- Risks...\n\n## Triggers\n- ...`}
                  className="mt-2 w-full h-[48vh] border rounded-lg p-3 font-mono text-sm"
                />
              </section>
              <section className="col-span-12 md:col-span-6 rounded-2xl border bg-white shadow-sm p-3">
                <label className="text-xs uppercase tracking-wide text-slate-500">Preview</label>
                <div
                  className="mt-2 w-full h-[48vh] border rounded-lg p-3 overflow-auto prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              </section>
            </div>

            <section className="rounded-2xl border bg-white shadow-sm p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Valuation snapshots</h3>
                <form
                  onSubmit={addSnapshot}
                  className="grid grid-cols-12 gap-2 w-full md:w-auto md:grid-flow-col"
                >
                  <input
                    className="border rounded px-2 py-1"
                    placeholder="YYYY-MM-DD"
                    value={snapForm.date}
                    onChange={(e) => setSnapForm({ ...snapForm, date: e.target.value })}
                  />
                  <input
                    className="border rounded px-2 py-1"
                    placeholder="Price"
                    value={snapForm.price}
                    onChange={(e) => setSnapForm({ ...snapForm, price: e.target.value })}
                  />
                  <input
                    className="border rounded px-2 py-1"
                    placeholder="PE"
                    value={snapForm.pe}
                    onChange={(e) => setSnapForm({ ...snapForm, pe: e.target.value })}
                  />
                  <input
                    className="border rounded px-2 py-1"
                    placeholder="PB"
                    value={snapForm.pb}
                    onChange={(e) => setSnapForm({ ...snapForm, pb: e.target.value })}
                  />
                  <input
                    className="border rounded px-2 py-1"
                    placeholder="EPS (TTM)"
                    value={snapForm.eps}
                    onChange={(e) => setSnapForm({ ...snapForm, eps: e.target.value })}
                  />
                  <input
                    className="border rounded px-2 py-1"
                    placeholder="Note"
                    value={snapForm.note}
                    onChange={(e) => setSnapForm({ ...snapForm, note: e.target.value })}
                  />
                  <button className="px-3 py-1 border rounded">Add</button>
                </form>
              </div>

              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2">Date</th>
                      <th>Price</th>
                      <th>PE</th>
                      <th>PB</th>
                      <th>EPS</th>
                      <th>Note</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map((s) => (
                      <tr key={s.id} className="border-b last:border-b-0">
                        <td className="py-1 font-mono">{s.date}</td>
                        <td>{fmtNum(s.price)}</td>
                        <td>{fmtNum(s.pe)}</td>
                        <td>{fmtNum(s.pb)}</td>
                        <td>{fmtNum(s.eps)}</td>
                        <td className="max-w-[24ch] truncate" title={s.note}>
                          {s.note}
                        </td>
                        <td>
                          <button
                            onClick={() => deleteSnapshot(s.id)}
                            className="text-red-600 text-xs"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                    {snapshots.length === 0 && (
                      <tr>
                        <td className="py-2 text-sm text-slate-500" colSpan={7}>
                          No snapshots yet. Add your first above.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </main>
        </div>
      </div>

      {/* Floating unsaved changes bar */}
      {isDirty && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40">
          <div className="rounded-2xl shadow-lg border bg-white/90 backdrop-blur px-4 py-2 flex items-center gap-3">
            <span className="inline-flex items-center gap-2 text-amber-700 text-sm">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Unsaved changes
            </span>
            <button
              onClick={saveNow}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black text-white hover:bg-black/90"
            >
              Save
            </button>
            <span className="text-xs text-slate-500">Press ⌘S / Ctrl+S</span>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtNum(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return "-";
  return Intl.NumberFormat().format(v);
}

function timeAgo(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function deriveCompanyFromHolding(code, holdings) {
  const h = holdings.find((x) => x.code === code || x.id === code);
  return h ? h.company || code : undefined;
}

function renderFact(raw, key, label) {
  if (!raw) return null;
  const val = raw[key];
  if (val === undefined || val === null || val === "") return null;
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase text-slate-500">{label || key}</div>
      <div className="font-medium">
        {typeof val === "number" ? fmtNum(val) : String(val)}
      </div>
    </div>
  );
}

function StarRating({ value, onChange }) {
  const stars = [1, 2, 3, 4, 5];
  return (
    <div className="flex items-center gap-1 select-none">
      {stars.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={clsx(
            "w-8 h-8 rounded-full border flex items-center justify-center",
            s <= Number(value) ? "bg-amber-400/90 border-amber-400" : "hover:bg-slate-50"
          )}
          title={`${s} star${s === 1 ? "" : "s"}`}
        >
          {s <= Number(value) ? "★" : "☆"}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange(0)}
        className="ml-2 text-xs px-2 py-1 border rounded hover:bg-slate-50"
        title="Clear rating"
      >
        Clear
      </button>
    </div>
  );
}

/* Editors */
function TagEditor({ tags, onAdd, onRemove }) {
  const [v, setV] = useState("");
  return (
    <section className="col-span-12 md:col-span-6">
      <label className="text-xs uppercase tracking-wide text-slate-500">Tags</label>
      <div className="flex gap-2 mt-1">
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="e.g. pharma, CDMO, high-ROCE"
          className="border rounded-lg px-3 py-2 w-full"
        />
        <button
          className="px-3 py-2 border rounded-lg hover:bg-slate-50"
          onClick={() => {
            const t = v.trim();
            if (t) onAdd(t);
            setV("");
          }}
        >
          Add
        </button>
      </div>
      <div className="flex flex-wrap gap-2 mt-2">
        {tags.map((t) => (
          <span key={t} className="px-2 py-1 rounded-full bg-slate-100 text-slate-700 text-xs border">
            {t}
            <button className="ml-1" onClick={() => onRemove(t)} title="Remove">
              ×
            </button>
          </span>
        ))}
        {tags.length === 0 && <span className="text-sm text-slate-500">No tags</span>}
      </div>
    </section>
  );
}

function LinkEditor({ links, onAdd, onRemove }) {
  const [v, setV] = useState("");
  return (
    <section className="col-span-12 md:col-span-6">
      <label className="text-xs uppercase tracking-wide text-slate-500">Links (earnings, presentations, filings)</label>
      <div className="flex gap-2 mt-1">
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="https://..."
          className="border rounded-lg px-3 py-2 w-full"
        />
        <button
          className="px-3 py-2 border rounded-lg hover:bg-slate-50"
          onClick={() => {
            const u = v.trim();
            if (u) onAdd(u);
            setV("");
          }}
        >
          Add
        </button>
      </div>
      <ul className="list-disc ml-6 mt-2 space-y-1">
        {links.map((u) => (
          <li key={u} className="break-all">
            <a className="text-blue-600 underline" href={u} target="_blank" rel="noreferrer">
              {u}
            </a>
            <button className="ml-2 text-xs" onClick={() => onRemove(u)}>
              Remove
            </button>
          </li>
        ))}
        {links.length === 0 && <span className="text-sm text-slate-500">No links</span>}
      </ul>
    </section>
  );
}
