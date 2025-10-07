// src/pages/ShareManager.jsx
import React, { useEffect, useState } from "react";
import { auth, db } from "../Authentication/firebase";
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp,
  updateDoc, where, getDocs
} from "firebase/firestore";
import axios from "axios";
import SiteHeader from "../Components/SiteHeader";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid
} from "recharts";
import { xirr } from "../utils/xirr";

const PF_URL = process.env.REACT_APP_COMPARISON_CHART;
const HOLDINGS_URL = process.env.REACT_APP_SPREADSHEET_URL;

async function computeCombinedXirrForUser(uid) {
  const pSnap = await getDocs(collection(db, "users", uid, "portfolios"));
  const portfolios = pSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const flows = [];
  let terminal = 0;
  for (const p of portfolios) {
    const cfSnap = await getDocs(collection(db, "users", uid, "portfolios", p.id, "cashflows"));
    cfSnap.forEach(cfDoc => {
      const r = cfDoc.data();
      const d = r.date?.toDate ? r.date.toDate() : new Date(r.date);
      flows.push({ date: d, amount: Number(r.amount) });
    });
    terminal += Number(p.currentValue || 0);
  }
  if (terminal > 0) flows.push({ date: new Date(), amount: terminal });

  const uniqueDates = new Set(flows.map(f => new Date(f.date).toDateString()));
  if (flows.length < 2 || uniqueDates.size < 2) return null;

  return xirr(flows) * 100;
}

async function buildAnonymizedHoldings() {
  if (!HOLDINGS_URL) return [];
  try {
    const { data } = await axios.get(HOLDINGS_URL);
    return (Array.isArray(data) ? data : [])
      .filter(r => r?.Company && r?.PorLpercent != null)
      .map(r => ({ name: String(r.Company), plPct: Number(r.PorLpercent) || 0 }));
  } catch {
    return [];
  }
}

const dayKey = (s) => String(s).slice(0, 10);

async function copyTextRobust(text) {
  try {
    if (navigator.clipboard && window.isSecureContext && document.hasFocus()) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function useAuthUid() {
  const [uid, setUid] = useState(auth.currentUser?.uid || null);
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(u => setUid(u?.uid || null));
    return () => unsub?.();
  }, []);
  return uid;
}

export default function ShareManager() {
  const uid = useAuthUid();
  const [darkMode, setDarkMode] = useState(false);
  const [shares, setShares] = useState([]);
  const [busy, setBusy] = useState(false);
  const [newLink, setNewLink] = useState(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, "publicShares"), where("ownerUid", "==", uid));
    return onSnapshot(q, (snap) => {
      const rows = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      setShares(rows);
    });
  }, [uid]);

  const createShare = async () => {
    if (!uid) return;
    if (!PF_URL) { alert("COMPARISON_CHART API URL missing."); return; }

    setBusy(true);
    try {
      const { data } = await axios.get(PF_URL);
      const rows = Array.isArray(data) ? data : [];

      const pf = rows
        .filter(r => r?.Date && r["PF Value"] != null)
        .map(r => ({ d: dayKey(r.Date), v: Number(r["PF Value"]) || 0 }));

      if (pf.length < 2) { alert("Not enough PF points to share."); return; }

      const base = pf[0].v || 1;
      const pSeries = pf.map(p => ({ d: p.d, p: Number(((p.v / base) * 100).toFixed(2)) }));

      let bench = null;
      if (rows.some(r => r.Close != null)) {
        const b = rows
          .filter(r => r?.Date && r.Close != null)
          .map(r => ({ d: dayKey(r.Date), v: Number(r.Close) || 0 }));
        const bBase = b[0]?.v;
        if (bBase) bench = b.map(x => ({ d: x.d, b: Number(((x.v / bBase) * 100).toFixed(2)) }));
      }

      const mergedMap = new Map(pSeries.map(x => [x.d, { d: x.d, p: x.p }]));
      if (bench) bench.forEach(x => {
        const cur = mergedMap.get(x.d) || { d: x.d };
        cur.b = x.b;
        mergedMap.set(x.d, cur);
      });
      const merged = Array.from(mergedMap.values()).sort((a, b) => a.d.localeCompare(b.d));

      const totalReturnPct = ((pf[pf.length - 1].v / pf[0].v) - 1) * 100;
      const xirrPct = await computeCombinedXirrForUser(uid);
      const holdings = await buildAnonymizedHoldings();

      const title = window.prompt("Share title (shown on public page)", "My Performance") || "My Performance";
      const docRef = await addDoc(collection(db, "publicShares"), {
        ownerUid: uid,
        title,
        isPublic: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        curve: merged,
        meta: { hasBenchmark: !!bench, source: "COMPARISON_CHART" },
        holdings,
        summary: {
          totalReturnPct: Number(totalReturnPct.toFixed(2)),
          xirrPct: xirrPct == null ? null : Number(xirrPct.toFixed(2)),
        },
      });

      const link = `${window.location.origin}/s/${docRef.id}`;
      setNewLink(link);
      setToast("Share link created");
    } catch (e) {
      console.error(e);
      alert("Failed to create share.");
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async (text) => {
    const ok = await copyTextRobust(text);
    setToast(ok ? "Copied to clipboard" : "Copy failed — tap and copy manually");
    setTimeout(() => setToast(""), 2000);
  };

  const togglePublic = async (s) => {
    try {
      await updateDoc(doc(db, "publicShares", s.id), {
        isPublic: !s.isPublic,
        updatedAt: serverTimestamp(),
      });
      setToast(s.isPublic ? "Made private" : "Made public");
    } catch (e) {
      console.error(e);
      alert("Permission error toggling visibility. Check Firestore rules and doc.ownerUid.");
    }
  };

  const revoke = async (s) => {
    if (!window.confirm("Revoke & delete this share link?")) return;
    try {
      await deleteDoc(doc(db, "publicShares", s.id));
      setToast("Share revoked");
    } catch (e) {
      console.error(e);
      alert("Permission error deleting link. Check Firestore rules and doc.ownerUid.");
    }
  };

  return (
    <div className={`min-h-screen ${darkMode ? "bg-gray-900 text-gray-100" : "bg-gray-50 text-gray-900"} `}>
        <div className="">
            <SiteHeader
            title="Portfolio Tracker"
            darkMode={darkMode}
            onToggleDarkMode={() => setDarkMode(v => !v)}
            />
        </div>
        

      {newLink && (
        <div className={`max-w-5xl mx-auto mb-4 p-2 md:p-4 lg:p-8 rounded-xl border p-3 ${darkMode ? "bg-gray-800 border-white/10 text-gray-100" : "bg-white border-black/10 text-gray-900"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium mr-2">Public link ready:</span>
            <input
              value={newLink}
              readOnly
              onFocus={(e) => e.target.select()}
              className={`flex-1 min-w-0 px-2 py-1 rounded border text-sm ${darkMode ? "bg-gray-900 border-white/10 text-gray-100" : "bg-white border-black/10 text-gray-900"}`}
            />
            <button
              onClick={() => handleCopy(newLink)}
              className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-sm"
            >
              Copy
            </button>
            <button
              onClick={() => setNewLink(null)}
              className={`px-3 py-1.5 rounded border text-sm ${darkMode ? "border-white/10 bg-white/10 hover:bg-white/15" : "border-black/10 bg-white hover:bg-gray-50"}`}
            >
              Close
            </button>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl md:text-3xl font-extrabold">Public Shares</h1>
          <button
            onClick={createShare}
            disabled={busy}
            className={`px-3 py-2 rounded-lg text-sm font-medium ${busy ? "opacity-50 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700"} text-white`}
          >
            {busy ? "Working…" : "Create Share Link"}
          </button>
        </div>

        {shares.length === 0 ? (
          <div className={`${darkMode ? "text-gray-300" : "text-gray-600"}`}>No shares yet.</div>
        ) : (
          <ul className="space-y-4">
            {shares.map((s) => {
              const vals = (Array.isArray(s.curve) ? s.curve : [])
                .flatMap(r => [r.p, s?.meta?.hasBenchmark ? r.b : undefined])
                .filter((n) => Number.isFinite(n));
              const min = vals.length ? Math.min(...vals) : 0;
              const max = vals.length ? Math.max(...vals) : 100;
              const pad = Math.max((max - min) * 0.06, 1);
              const yMin = Math.floor(min - pad);
              const yMax = Math.ceil(max + pad);

              return (
                <li key={s.id} className={`rounded-xl border ${darkMode ? "border-white/10 bg-gray-800" : "border-black/10 bg-white"} p-4`}>
                  <div className="flex flex-wrap items-center gap-3 justify-between">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{s.title || "Untitled share"}</div>
                      <div className={`text-xs ${darkMode ? "text-gray-300" : "text-gray-600"}`}>
                        {s.isPublic ? "Public" : "Private"} • ID: {s.id}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopy(`${window.location.origin}/s/${s.id}`)}
                        className={`px-3 py-1.5 rounded border ${darkMode ? "border-white/10 bg-white/10 hover:bg-white/15" : "border-black/10 bg-white hover:bg-gray-50"} text-sm`}
                      >
                        Copy link
                      </button>
                      <button
                        onClick={() => togglePublic(s)}
                        className={`px-3 py-1.5 rounded ${s.isPublic ? "bg-amber-500 hover:bg-amber-600 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white"} text-sm`}
                      >
                        {s.isPublic ? "Make Private" : "Make Public"}
                      </button>
                      <button
                        onClick={() => revoke(s)}
                        className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-700 text-white text-sm"
                      >
                        Revoke
                      </button>
                    </div>
                  </div>

                  {Array.isArray(s.curve) && s.curve.length > 1 && (
                    <div className="mt-4 h-40">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={s.curve}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke={darkMode ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)"}
                          />
                          <XAxis
                            dataKey="d"
                            tickFormatter={(t) => String(t).slice(5)}
                            tick={{ fontSize: 12, fill: darkMode ? "#cbd5e1" : "#475569" }}
                          />
                          <YAxis
                            domain={[yMin, yMax]}
                            width={56}
                            tick={{ fontSize: 12, fill: darkMode ? "#cbd5e1" : "#475569" }}
                            label={{
                              value: "Normalized (100 = start)",
                              angle: -90,
                              position: "insideLeft",
                              fill: darkMode ? "#cbd5e1" : "#334155",
                              fontSize: 12,
                            }}
                          />
                          <Tooltip
                            formatter={(val, name) => [`${Number(val).toFixed(2)}%`, name]}
                            labelFormatter={(l) => l}
                            contentStyle={{
                              background: darkMode ? "rgba(17,24,39,.95)" : "#fff",
                              border: `1px solid ${darkMode ? "rgba(255,255,255,.15)" : "rgba(0,0,0,.1)"}`,
                              borderRadius: 8,
                            }}
                          />
                          <Line type="monotone" dataKey="p" name="Portfolio" stroke="#6366f1" dot={false} strokeWidth={2} />
                          {s?.meta?.hasBenchmark && (
                            <Line type="monotone" dataKey="b" name="Benchmark" stroke="#10b981" dot={false} strokeWidth={2} />
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-3 py-2 rounded-lg bg-black/80 text-white text-sm">
          {toast}
        </div>
      )}
    </div>
  );
}
