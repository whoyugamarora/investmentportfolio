// src/pages/HoldingDetail.jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import SiteHeader from "../Components/SiteHeader";
import { auth, db, storage } from "../Authentication/firebase";
import {
  collection, doc, getDoc, getDocs, orderBy, query, addDoc,
  serverTimestamp, setDoc, updateDoc, where
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { onSnapshot } from "firebase/firestore";

/* ---------- Helpers ---------- */
function useAuthUid() {
  const [uid, setUid] = useState(null);
  useEffect(() => {
    const off = auth.onAuthStateChanged(function (u) { setUid(u ? u.uid : null); });
    return function () { off(); };
  }, []);
  return uid;
}
function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function pct(v) { return (v).toFixed(1) + "%"; }
function toNum(v) { return (v === "" || v == null) ? null : Number(v); }
function bytes(n) {
  if (!n && n !== 0) return "";
  var u = ["B","KB","MB","GB"], i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v = v/1024; i++; }
  return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + " " + u[i];
}

/* ---------- Tiny Markdown Preview ---------- */
function Preview({ md }) {
  const html = useMemo(() => {
    if (!md) return "";
    var s = md.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    s = s.replace(/^### (.*)$/gm,"<h3 class='text-base font-semibold mt-4 mb-2'>$1</h3>");
    s = s.replace(/^## (.*)$/gm,"<h2 class='text-lg font-bold mt-5 mb-3'>$1</h2>");
    s = s.replace(/^# (.*)$/gm,"<h1 class='text-xl font-bold mt-6 mb-4'>$1</h1>");
    s = s.replace(/\*\*(.+?)\*\*/g,"<strong class='font-semibold'>$1</strong>");
    s = s.replace(/\*(.+?)\*/g,"<em>$1</em>");
    s = s.replace(/`([^`]+)`/g,"<code class='px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[12px] font-mono'>$1</code>");
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="text-indigo-600 hover:text-indigo-700 underline decoration-indigo-300 hover:decoration-indigo-500" href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/^(?:-|\*) (.*)$/gm,"<li class='mb-1'>$1</li>");
    s = s.replace(/(<li>.*<\/li>)/gs,"<ul class='list-disc pl-6 space-y-1 my-3'>$1</ul>");
    s = s.replace(/\n{2,}/g,"</p><p class='mb-3'>").replace(/\n/g,"<br/>");
    return "<div class='leading-relaxed'><p class='mb-3'>" + s + "</p></div>";
  }, [md]);
  return <div className="prose prose-sm max-w-none break-words text-gray-800" dangerouslySetInnerHTML={{ __html: html }} />;
}

/* ---------- Conviction UI ---------- */
var convictionLabels = ["", "Low", "Medium", "High", "Very High"];
var convictionColors = ["", "bg-rose-100 text-rose-700", "bg-amber-100 text-amber-700", "bg-emerald-100 text-emerald-700", "bg-green-100 text-green-700"];

/* ====================================================================== */
export default function HoldingDetail({ pid = "default" }) {
  const { symbol } = useParams();
  const [sp] = useSearchParams();
  const effectivePid = sp.get("pid") || pid;
  const uid = useAuthUid();

  /* state */
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [savedTick, setSavedTick] = useState(false);

  const [thesis, setThesis] = useState("");
  const [target, setTarget] = useState("");
  const [current, setCurrent] = useState("");
  const [conviction, setConviction] = useState(3);
  const [tags, setTags] = useState([]);

  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState("");

  const [theses, setTheses] = useState([]);
  const [thFormTitle, setThFormTitle] = useState("");
  const [thFormBody, setThFormBody] = useState("");

  const [files, setFiles] = useState([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [trades, setTrades] = useState([]);
  const [dividends, setDividends] = useState([]);

  const docRef = useMemo(function () {
    return uid ? doc(db, "users", uid, "portfolios", effectivePid, "holdings", symbol) : null;
  }, [uid, effectivePid, symbol]);

  /* files live updates */
  useEffect(() => {
    if (!uid) return;
    const fCol = collection(db, "users", uid, "portfolios", effectivePid, "holdings", symbol, "files");
    const qy = query(fCol, orderBy("createdAt", "desc"));
    const off = onSnapshot(qy, function (snap) {
      setFiles(snap.docs.map(function (d) { return { id: d.id, ...d.data() }; }));
    }, function (e) { setErr(e.message); });
    return off;
  }, [uid, effectivePid, symbol]);

  const initialRef = useRef({ thesis: "", target: "", current: "", conviction: 3, tags: [] });
  const isDirty =
    thesis !== initialRef.current.thesis ||
    target !== initialRef.current.target ||
    current !== initialRef.current.current ||
    conviction !== initialRef.current.conviction ||
    JSON.stringify(tags) !== JSON.stringify(initialRef.current.tags);

  /* load doc + lists */
  const load = useCallback(async function () {
    if (!docRef) return;
    setErr(null); setLoading(true);
    try {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const d = snap.data();
        const init = {
          thesis: d && d.thesis ? d.thesis : "",
          target: (d && d.targetPrice != null) ? String(d.targetPrice) : "",
          current: (d && d.currentPrice != null) ? String(d.currentPrice) : "",
          conviction: (d && typeof d.conviction === "number") ? d.conviction : 3,
          tags: (d && Array.isArray(d.tags)) ? d.tags : [],
        };
        setThesis(init.thesis);
        setTarget(init.target);
        setCurrent(init.current);
        setConviction(init.conviction);
        setTags(init.tags);
        initialRef.current = init;
      } else {
        await setDoc(docRef, {
          symbol,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          thesis: "",
          conviction: 3,
          tags: [],
        }, { merge: true });
        initialRef.current = { thesis: "", target: "", current: "", conviction: 3, tags: [] };
      }

      // txn & dividends
      const txCol = collection(db, "users", uid, "portfolios", effectivePid, "transactions");
      const divCol = collection(db, "users", uid, "portfolios", effectivePid, "dividends");
      const txQ = query(txCol, where("symbol", "==", symbol), orderBy("date", "desc"));
      const divQ = query(divCol, where("symbol", "==", symbol), orderBy("date", "desc"));
      const [txSnap, divSnap] = await Promise.all([getDocs(txQ), getDocs(divQ)]);
      setTrades(txSnap.docs.map(function (d) { return { id: d.id, ...d.data() }; }));
      setDividends(divSnap.docs.map(function (d) { return { id: d.id, ...d.data() }; }));

      // notes
      const notesCol = collection(db, "users", uid, "portfolios", effectivePid, "holdings", symbol, "notes");
      const notesQ = query(notesCol, orderBy("createdAt", "desc"));
      const notesSnap = await getDocs(notesQ);
      setNotes(notesSnap.docs.map(function (d) { return { id: d.id, ...d.data() }; }));

      // theses
      const thCol = collection(db, "users", uid, "portfolios", effectivePid, "holdings", symbol, "theses");
      const thQ = query(thCol, orderBy("createdAt", "desc"));
      const thSnap = await getDocs(thQ);
      setTheses(thSnap.docs.map(function (d) { return { id: d.id, ...d.data() }; }));

      // fallback current from latest trade
      if (!initialRef.current.current && txSnap.docs.length) {
        const latest = txSnap.docs[0].data();
        if (latest && latest.price != null) {
          setCurrent(String(latest.price));
          initialRef.current.current = String(latest.price);
        }
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [docRef, effectivePid, symbol, uid]);

  useEffect(() => { load(); }, [load]);

  /* save core */
  async function saveCore() {
    if (!docRef) return;
    setSaving(true); setErr(null);
    try {
      await updateDoc(docRef, {
        thesis,
        targetPrice: toNum(target),
        currentPrice: toNum(current),
        conviction: Number(conviction),
        tags,
        updatedAt: serverTimestamp(),
      });
      initialRef.current = { thesis, target, current, conviction, tags };
      setSavedTick(true);
      setTimeout(function () { setSavedTick(false); }, 1400);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  }

  /* keyboard: ⌘/Ctrl+S */
  useEffect(() => {
    function onKey(e) {
      var key = (e.key || "").toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === "s") {
        e.preventDefault();
        if (!saving && isDirty) saveCore();
      }
    }
    window.addEventListener("keydown", onKey);
    return function () { window.removeEventListener("keydown", onKey); };
  }, [saving, isDirty, thesis, target, current, conviction, tags]);

  /* tags */
  function onTagKey(e) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      var v = (e.currentTarget.value || "").trim();
      if (v && tags.indexOf(v) === -1) setTags(tags.concat([v]));
      e.currentTarget.value = "";
    }
  }
  function removeTag(t) { setTags(tags.filter(function (x) { return x !== t; })); }

  /* timeline */
  const timeline = useMemo(function () {
    var rows = []
      .concat(trades.map(function (t) { return { type: t.side || "TRADE", date: t.date && t.date.toDate ? t.date.toDate() : new Date(t.date), note: (t.side || "") + " " + t.qty + " @ ₹" + t.price }; }))
      .concat(dividends.map(function (d) { return { type: "DIV", date: d.date && d.date.toDate ? d.date.toDate() : new Date(d.date), note: "Dividend ₹" + d.amount }; }))
      .filter(function (x) { return x.date && !isNaN(x.date); });
    rows.sort(function (a, b) { return b.date - a.date; });
    return rows;
  }, [trades, dividends]);

  /* upside */
  var currentNum = toNum(current);
  var targetNum = toNum(target);
  var upside = (currentNum && targetNum) ? ((targetNum - currentNum) / currentNum) * 100 : null;

  /* notes */
  async function addNote() {
    var text = (noteText || "").trim();
    if (!text) return;
    const notesCol = collection(db, "users", uid, "portfolios", effectivePid, "holdings", symbol, "notes");
    const refDoc = await addDoc(notesCol, { text, createdAt: serverTimestamp() });
    setNotes([{ id: refDoc.id, text, createdAt: new Date() }].concat(notes));
    setNoteText("");
  }

  /* thesis form */
  async function submitThesisForm() {
    var t = (thFormTitle || "").trim();
    var b = (thFormBody || "").trim();
    if (!t || !b) return;
    const thCol = collection(db, "users", uid, "portfolios", effectivePid, "holdings", symbol, "theses");
    const refDoc = await addDoc(thCol, { title: t, body: b, createdAt: serverTimestamp() });
    setTheses([{ id: refDoc.id, title: t, body: b, createdAt: new Date() }].concat(theses));
    setThFormTitle(""); setThFormBody("");
  }

  /* uploads */
  function sanitizeName(name) { return name.replace(/[#[\]*?]/g, "_"); }
  async function onFiles(e) {
    const input = e.target;
    const list = Array.from(input.files || []);
    if (!list.length) return;
    if (!uid) { setErr("Please sign in first."); input.value = ""; return; }
    if (!storage) { setErr("Storage not initialized"); input.value = ""; return; }

    setUploadBusy(true); setUploadProgress(0); setErr(null);
    try {
      for (var k = 0; k < list.length; k++) {
        const f = list[k];
        const safe = Date.now() + "_" + sanitizeName(f.name);
        const path = "users/" + uid + "/portfolios/" + effectivePid + "/holdings/" + symbol + "/" + safe;
        const r = ref(storage, path);
        const meta = { contentType: f.type || "application/octet-stream" };

        await new Promise(function (resolve, reject) {
          const task = uploadBytesResumable(r, f, meta);
          task.on("state_changed",
            function (snap) {
              const p = (snap.bytesTransferred / snap.totalBytes) * 100;
              setUploadProgress(Math.round(p));
            },
            function (error) { reject(error); },
            async function () {
              const url = await getDownloadURL(task.snapshot.ref);
              const fCol = collection(db, "users", uid, "portfolios", effectivePid, "holdings", symbol, "files");
              const docData = { name: f.name, size: f.size, contentType: meta.contentType, url, storagePath: path, createdAt: serverTimestamp() };
              const created = await addDoc(fCol, docData);
              setFiles(function (prev) { return [{ id: created.id, ...docData, createdAt: new Date() }].concat(prev); });
              resolve();
            }
          );
        });
      }
    } catch (e) {
      setErr(typeof e.message === "string" ? e.message : String(e));
    } finally {
      setUploadBusy(false); setUploadProgress(0); input.value = "";
    }
  }

  if (!uid) {
    return (
      <>
        <SiteHeader />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-12 text-center">
          <p className="text-gray-600">Please sign in to view holding details.</p>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />

      <div className="bg-gradient-to-br from-indigo-50 via-white to-purple-50 min-h-screen">
        {/* sticky toolbar */}
        <div className="sticky top-0 z-30 backdrop-blur bg-white/70 border-b border-indigo-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Link to="/insights" className="hover:underline">Portfolio</Link>
                <span>›</span>
                <span className="font-mono">{effectivePid}</span>
              </div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{symbol}</h1>
                {savedTick && (
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-semibold">Saved</span>
                )}
                {isDirty && !savedTick && (
                  <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 text-xs font-semibold">Unsaved changes</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={saveCore}
                disabled={saving || !isDirty}
                className={
                  "px-5 py-2 rounded-xl font-semibold text-white transition-all " +
                  (saving || !isDirty
                    ? "bg-indigo-300 cursor-not-allowed"
                    : "bg-indigo-600 hover:bg-indigo-700 shadow")
                }
                title="Ctrl/Cmd+S"
              >
                {saving ? "Saving…" : (isDirty ? "Save" : "Saved")}
              </button>
              <Link to="/insights" className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50">
                Back
              </Link>
            </div>
          </div>
        </div>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
          {err && (
            <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-800 text-sm">{err}</div>
          )}
          {loading && (
            <div className="flex items-center justify-center py-10 text-gray-500">Loading…</div>
          )}

          {/* Stats strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg bg-white border border-gray-200 p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Current</div>
              <div className="text-lg font-extrabold">₹{current ? Number(current).toLocaleString("en-IN") : "—"}</div>
            </div>
            <div className="rounded-lg bg-white border border-gray-200 p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Target</div>
              <div className="text-lg font-extrabold">₹{target ? Number(target).toLocaleString("en-IN") : "—"}</div>
            </div>
            <div className="rounded-lg bg-white border border-gray-200 p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Upside</div>
              <div className={"text-lg font-extrabold " + (upside != null && upside >= 0 ? "text-emerald-600" : "text-rose-600")}>
                {upside == null ? "—" : pct(upside)}
              </div>
            </div>
            <div className="rounded-lg bg-white border border-gray-200 p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Conviction</div>
              <div className="flex items-center gap-2 mt-1">
                <span className={"px-2 py-0.5 rounded-full text-xs font-semibold " + convictionColors[conviction]}>
                  {convictionLabels[conviction]}
                </span>
                <span className="text-sm text-gray-500">({conviction}/4)</span>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="grid md:grid-cols-5 gap-4">
            {/* Target */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <label className="text-xs font-semibold text-gray-600">Target Price</label>
              <div className="mt-2 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-semibold">₹</span>
                <input
                  type="number"
                  className="w-full rounded-lg pl-8 pr-3 py-2.5 text-lg font-semibold bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={target}
                  onChange={function (e) { setTarget(e.target.value); }}
                  placeholder="2400"
                />
              </div>
            </div>

            {/* Current */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <label className="text-xs font-semibold text-gray-600">Current Price</label>
              <div className="mt-2 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-semibold">₹</span>
                <input
                  type="number"
                  className="w-full rounded-lg pl-8 pr-3 py-2.5 text-lg font-semibold bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={current}
                  onChange={function (e) { setCurrent(e.target.value); }}
                  placeholder="Add current"
                />
              </div>
              <p className="text-[11px] text-gray-500 mt-1.5">You can override live quotes here.</p>
            </div>

            {/* Upside */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <label className="text-xs font-semibold text-gray-600">Upside</label>
              <div className="mt-2 flex items-end justify-between">
                <div className="text-2xl font-extrabold">{upside == null ? "—" : pct(upside)}</div>
                <div className="text-xs text-gray-500 font-mono">
                  {(targetNum && currentNum) ? "(" + targetNum + " / " + currentNum + ")" : ""}
                </div>
              </div>
              <div className="mt-3 h-2 w-full rounded bg-gray-100 overflow-hidden">
                <div
                  className={"h-2 " + (upside != null && upside >= 0 ? "bg-emerald-500" : "bg-rose-500")}
                  style={{ width: Math.min(Math.abs(upside || 0), 100) + "%" }}
                />
              </div>
            </div>

            {/* Conviction */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <label className="text-xs font-semibold text-gray-600">Conviction</label>
              <input
                type="range" min="1" max="4" step="1" value={conviction}
                onChange={function (e) { setConviction(parseInt(e.target.value, 10)); }}
                className="w-full mt-2 h-2 rounded-lg appearance-none cursor-pointer"
                style={{
                  background:
                    "linear-gradient(to right, rgb(79 70 229) 0%, rgb(79 70 229) " +
                    (((conviction - 1) / 3) * 100) + "%, rgb(229 231 235) " +
                    (((conviction - 1) / 3) * 100) + "%, rgb(229 231 235) 100%)"
                }}
              />
              <div className="flex items-center justify-between mt-2">
                <span className={"px-2.5 py-0.5 rounded-full text-xs font-semibold " + convictionColors[conviction]}>
                  {convictionLabels[conviction]}
                </span>
                <span className="text-xs text-gray-500">{conviction}/4</span>
              </div>
            </div>

            {/* Tags */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <label className="text-xs font-semibold text-gray-600">Tags</label>
              <div className="flex flex-wrap gap-2 mt-2 min-h-[32px]">
                {tags.map(function (t) {
                  return (
                    <span key={t} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-indigo-200 text-indigo-700 bg-indigo-50">
                      {t}
                      <button className="ml-1" onClick={function(){ removeTag(t); }} title="Remove">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
                      </button>
                    </span>
                  );
                })}
              </div>
              <input
                type="text" onKeyDown={onTagKey}
                className="mt-2 w-full rounded-lg px-3 py-2 bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                placeholder="Type and press Enter"
              />
            </div>
          </div>

          {/* Notes / Thesis / Files */}
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Notes */}
            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">Notes</h3>
                <span className="text-xs text-gray-400">{notes.length} saved</span>
              </div>
              <div className="flex gap-2">
                <input
                  value={noteText}
                  onChange={function (e) { setNoteText(e.target.value); }}
                  onKeyDown={function (e) { if (e.key === "Enter") addNote(); }}
                  className="flex-1 rounded-lg px-3 py-2 bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                  placeholder="Add a quick note (Enter to save)"
                />
                <button onClick={addNote} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
                  Add
                </button>
              </div>
              <ul className="mt-3 space-y-2 max-h-56 overflow-y-auto pr-1">
                {notes.map(function (n) {
                  return (
                    <li key={n.id} className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <div className="text-gray-800">{n.text}</div>
                      <div className="text-[11px] text-gray-500 mt-1">
                        {(n.createdAt && n.createdAt.toDate && n.createdAt.toDate().toLocaleString) ? n.createdAt.toDate().toLocaleString() : ""}
                      </div>
                    </li>
                  );
                })}
                {notes.length === 0 && <li className="text-sm text-gray-400">No notes yet.</li>}
              </ul>
            </section>

            {/* Thesis form */}
            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">Add Investment Thesis</h3>
                <span className="text-xs text-gray-400">Stored in DB</span>
              </div>
              <input
                value={thFormTitle}
                onChange={function (e) { setThFormTitle(e.target.value); }}
                className="w-full rounded-lg px-3 py-2 bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm mb-2"
                placeholder="Title (e.g., FY27 rerating on margin expansion)"
              />
              <textarea
                value={thFormBody}
                onChange={function (e) { setThFormBody(e.target.value); }}
                className="w-full h-28 rounded-lg px-3 py-2 bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                placeholder="Summary, bull case, risks, catalysts…"
              />
              <div className="mt-3 flex justify-end">
                <button onClick={submitThesisForm} className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700">
                  Save Thesis
                </button>
              </div>

              <div className="mt-4 space-y-3 max-h-40 overflow-y-auto pr-1">
                {theses.map(function (t) {
                  return (
                    <div key={t.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="font-semibold text-gray-900 truncate">{t.title}</h4>
                        <span className="text-[11px] text-gray-500">
                          {(t.createdAt && t.createdAt.toDate && t.createdAt.toDate().toLocaleDateString) ? t.createdAt.toDate().toLocaleDateString() : ""}
                        </span>
                      </div>
                      <div className="mt-2 text-sm text-gray-700 line-clamp-3">
                        <Preview md={t.body} />
                      </div>
                    </div>
                  );
                })}
                {theses.length === 0 && <p className="text-sm text-gray-400">No theses yet.</p>}
              </div>
            </section>

            {/* Files & Research */}
            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">Files & Research</h3>
                <div className="text-xs text-gray-500">{files.length} files</div>
              </div>

              <label className="block">
                <div className={"border-2 border-dashed rounded-xl p-4 text-center " + (uploadBusy ? "border-indigo-300" : "border-gray-300 hover:border-indigo-400")}>
                  <div className="text-sm text-gray-600">Drag & drop or click to upload (PDFs, images, notes)</div>
                  <input type="file" multiple onChange={onFiles} className="hidden" />
                </div>
              </label>

              {uploadBusy && (
                <div className="mt-3 h-2 w-full bg-gray-100 rounded">
                  <div className="h-2 bg-indigo-600 rounded" style={{ width: uploadProgress + "%" }} />
                </div>
              )}

              <ul className="mt-3 space-y-2 max-h-40 overflow-y-auto pr-1">
                {files.map(function (f) {
                  return (
                    <li key={f.id} className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <a href={f.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-indigo-700 hover:underline truncate block">
                          {f.name}
                        </a>
                        <div className="text-[11px] text-gray-500">{(f.contentType || "")} • {bytes(f.size)}</div>
                      </div>
                      <a href={f.url} target="_blank" rel="noreferrer" className="px-2 py-1 text-xs rounded border border-gray-300 hover:bg-gray-100">Open</a>
                    </li>
                  );
                })}
                {files.length === 0 && <li className="text-sm text-gray-400">No files yet.</li>}
              </ul>
            </section>
          </div>

          {/* Freeform Thesis + Preview */}
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-gray-600">Investment Thesis (Freeform)</label>
                <span className="text-xs text-gray-400">⌘/Ctrl + S</span>
              </div>
              <textarea
                className="w-full h-64 rounded-lg p-4 font-mono text-sm bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                value={thesis}
                onChange={function (e) { setThesis(e.target.value); }}
                placeholder={"# Why " + symbol + "?\n\n## Investment Case\n- Moat\n- Growth catalysts\n- Risks\n\n## Valuation\n- Target multiple\n- Comps"}
              />
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5 overflow-hidden">
              <div className="text-xs font-semibold text-gray-600 mb-2">Preview</div>
              <div className="h-64 overflow-y-auto pr-2">
                {thesis ? <Preview md={thesis} /> : <div className="h-full grid place-items-center text-gray-400 text-sm">Start typing to see preview</div>}
              </div>
            </div>
          </div>

          {/* Activity Timeline */}
          <details className="bg-white rounded-xl border border-gray-200" open>
            <summary className="list-none p-5 cursor-pointer flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                <h2 className="text-lg font-bold text-gray-900">Activity Timeline</h2>
              </div>
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">{timeline.length} events</span>
            </summary>
            <div className="p-5 pt-0">
              {timeline.length === 0 ? (
                <div className="py-8 text-center text-gray-600">No activity yet</div>
              ) : (
                <div className="relative pl-8 max-h-72 overflow-y-auto pr-2">
                  <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-gradient-to-b from-indigo-200 via-purple-200 to-indigo-200" />
                  {timeline.map(function (e, i) {
                    return (
                      <div key={i} className="relative mb-4 last:mb-0">
                        <div className={"absolute left-[-19px] mt-1 h-3 w-3 rounded-full " + (e.type === "DIV" ? "bg-green-500 ring-4 ring-green-100" : "bg-indigo-600 ring-4 ring-indigo-100")} />
                        <div className="bg-gray-50 rounded-lg p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{e.note}</p>
                              <p className="text-xs text-gray-500">
                                {e.date && e.date.toLocaleString ? e.date.toLocaleString("en-US", { year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" }) : String(e.date)}
                              </p>
                            </div>
                            <span className={"flex-shrink-0 px-2 py-1 rounded text-[11px] font-semibold " + (e.type === "DIV" ? "bg-green-100 text-green-700" : "bg-indigo-100 text-indigo-700")}>
                              {e.type}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </details>
        </main>
      </div>
    </>
  );
}
