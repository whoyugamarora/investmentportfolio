// src/pages/HoldingDetail.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { auth, db } from "../Authentication/firebase";
import {
  addDoc, collection, doc, getDoc, getDocs, orderBy, query,
  serverTimestamp, setDoc, updateDoc, where
} from "firebase/firestore";

function useAuthUid() {
  const [uid, setUid] = useState(null);
  useEffect(() => {
    const off = auth.onAuthStateChanged(u => setUid(u ? u.uid : null));
    return () => off();
  }, []);
  return uid;
}

function Preview({ md }) {
  // ultra-light markdown preview (bold, italics, bullets, code, links, line breaks)
  const html = useMemo(() => {
    if (!md) return "";
    let s = md
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    s = s.replace(/^### (.*)$/gm, "<h3>$1</h3>");
    s = s.replace(/^## (.*)$/gm, "<h2>$1</h2>");
    s = s.replace(/^# (.*)$/gm, "<h1>$1</h1>");
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>`);
    // bullets
    s = s.replace(/^(?:-|\*) (.*)$/gm, "<li>$1</li>");
    s = s.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>");
    // line breaks
    s = s.replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br/>");
    return `<p>${s}</p>`;
  }, [md]);
  return <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function HoldingDetail({ pid = "default" }) {
  const { symbol } = useParams();
  const [sp] = useSearchParams();
  const pidFromUrl = sp.get("pid");
  if (pidFromUrl) pid = pidFromUrl;

  const uid = useAuthUid();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  // form state
  const [thesis, setThesis] = useState("");
  const [target, setTarget] = useState("");
  const [conviction, setConviction] = useState(3);
  const [tags, setTags] = useState([]);

  // timeline
  const [trades, setTrades] = useState([]);
  const [dividends, setDividends] = useState([]);

  const docRef = useMemo(() =>
    uid ? doc(db, "users", uid, "portfolios", pid, "holdings", symbol) : null
  , [uid, pid, symbol]);

  const load = useCallback(async () => {
    if (!docRef) return;
    setErr(null); setLoading(true);
    try {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const d = snap.data();
        setThesis(d?.thesis ?? "");
        setTarget(d?.targetPrice ? String(d.targetPrice) : "");
        setConviction(typeof d?.conviction === "number" ? d.conviction : 3);
        setTags(Array.isArray(d?.tags) ? d.tags : []);
      } else {
        // create a seed doc for convenience
        await setDoc(docRef, {
          symbol,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          thesis: "",
          conviction: 3,
          tags: []
        }, { merge: true });
      }

      // timeline pulls (optional collections)
      const txCol = collection(db, "users", uid, "portfolios", pid, "transactions");
      const divCol = collection(db, "users", uid, "portfolios", pid, "dividends");

      const txQ = query(txCol, where("symbol", "==", symbol), orderBy("date", "desc"));
      const divQ = query(divCol, where("symbol", "==", symbol), orderBy("date", "desc"));

      const [txSnap, divSnap] = await Promise.allSettled([getDocs(txQ), getDocs(divQ)]);
      if (txSnap.status === "fulfilled") {
        setTrades(txSnap.value.docs.map(d => ({ id: d.id, ...d.data() })));
      }
      if (divSnap.status === "fulfilled") {
        setDividends(divSnap.value.docs.map(d => ({ id: d.id, ...d.data() })));
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [docRef, pid, symbol, uid]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!docRef) return;
    setSaving(true); setErr(null);
    try {
      await updateDoc(docRef, {
        thesis,
        targetPrice: target === "" ? null : Number(target),
        conviction: Number(conviction),
        tags,
        updatedAt: serverTimestamp()
      });
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  const onTagKey = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const v = e.currentTarget.value.trim();
      if (v && !tags.includes(v)) setTags([...tags, v]);
      e.currentTarget.value = "";
    }
  };

  const removeTag = (t) => setTags(tags.filter(x => x !== t));

  // derived: combined timeline
  const timeline = useMemo(() => {
    const rows = [
      ...trades.map(t => ({ type: t.side || "TRADE", date: t.date?.toDate?.() || new Date(t.date), note: `${t.side} ${t.qty} @ ₹${t.price}`, meta: t })),
      ...dividends.map(d => ({ type: "DIV", date: d.date?.toDate?.() || new Date(d.date), note: `Dividend ₹${d.amount}`, meta: d })),
    ].filter(x => x.date && !isNaN(x.date));
    rows.sort((a,b) => b.date - a.date);
    return rows;
  }, [trades, dividends]);

  if (!uid) {
    return (
      <div className="container p-6">
        <p className="text-sm opacity-70">Please sign in to view holding notes.</p>
      </div>
    );
  }

  return (
    <div className="container max-w-5xl p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{symbol}</h1>
          <p className="text-sm opacity-70">Portfolio: <span className="font-mono">{pid}</span></p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={save} className="px-4 py-2 rounded-xl bg-black text-white disabled:opacity-60">
            {saving ? "Saving..." : "Save"}
          </button>
          <Link to="/insights" className="px-3 py-2 rounded-xl border">Back</Link>
        </div>
      </div>

      {err && <div className="p-3 rounded-lg bg-red-50 text-red-800 text-sm">{err}</div>}
      {loading && <div className="text-sm opacity-70">Loading…</div>}

      {/* Meta controls */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl border">
          <label className="block text-xs uppercase opacity-60 mb-1">Target Price (₹)</label>
          <input
            type="number"
            className="w-full border rounded-xl px-3 py-2"
            value={target}
            onChange={e => setTarget(e.target.value)}
            placeholder="e.g., 2400"
          />
        </div>

        <div className="p-4 rounded-2xl border">
          <label className="block text-xs uppercase opacity-60 mb-1">Conviction</label>
          <input
            type="range" min="1" max="5" step="1"
            value={conviction}
            onChange={e => setConviction(e.target.value)}
            className="w-full"
          />
          <div className="text-sm mt-1">{conviction} / 5</div>
        </div>

        <div className="p-4 rounded-2xl border">
          <label className="block text-xs uppercase opacity-60 mb-2">Tags</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {tags.map(t => (
              <span key={t} className="px-2 py-1 rounded-full text-xs border">
                {t} <button className="ml-1 opacity-60" onClick={() => removeTag(t)}>×</button>
              </span>
            ))}
          </div>
          <input
            type="text"
            onKeyDown={onTagKey}
            className="w-full border rounded-xl px-3 py-2"
            placeholder="Type a tag and press Enter"
          />
        </div>
      </div>

      {/* Thesis editor */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl border">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs uppercase opacity-60">Thesis (Markdown)</label>
            <button
              onClick={() => setThesis(s => s + (s.endsWith("\n")||s==="" ? "" : "\n") + "- ")}
              className="text-xs px-2 py-1 rounded-md border"
            >
              • bullet
            </button>
          </div>
          <textarea
            className="w-full h-64 border rounded-xl p-3 font-mono text-sm"
            value={thesis}
            onChange={e => setThesis(e.target.value)}
            placeholder={"# Why " + symbol + "\n- moat\n- triggers\n- risks\n- valuation"}
          />
        </div>
        <div className="p-4 rounded-2xl border bg-white">
          <div className="text-xs uppercase opacity-60 mb-2">Preview</div>
          <div className="min-h-[16rem]">
            <Preview md={thesis} />
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="p-4 rounded-2xl border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Timeline</h2>
          <div className="text-xs opacity-60">Trades & dividends (newest first)</div>
        </div>
        {timeline.length === 0 ? (
          <div className="text-sm opacity-70">
            No events yet. Import your broker CSV into
            <code className="mx-1">users/{uid}/portfolios/{pid}/transactions</code> and
            <code className="mx-1">dividends</code> (fields: <em>date, symbol, side, qty, price</em> / <em>date, symbol, amount</em>).
          </div>
        ) : (
          <ul className="space-y-2">
            {timeline.map((e, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className={`mt-1 h-2 w-2 rounded-full ${e.type === "DIV" ? "bg-green-500" : "bg-blue-500"}`}></span>
                <div>
                  <div className="text-sm">{e.note}</div>
                  <div className="text-xs opacity-60">{e.date.toLocaleString?.() || e.date}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Quick add note into thesis */}
      <div className="flex items-center gap-2">
        <button
          className="px-3 py-2 rounded-xl border"
          onClick={() => setThesis(t => `${t}${t.endsWith("\n") ? "" : "\n"}- ${new Date().toLocaleDateString()}: `)}
        >
          Add dated bullet
        </button>
        <button className="px-3 py-2 rounded-xl border" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save now"}
        </button>
      </div>
    </div>
  );
}
