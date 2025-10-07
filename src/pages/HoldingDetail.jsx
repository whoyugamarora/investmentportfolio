// src/pages/HoldingDetail.jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import SiteHeader from "../Components/SiteHeader";
import { auth, db, storage } from "../Authentication/firebase"; // <-- needs storage exported
import {
    collection, doc, getDoc, getDocs, orderBy, query, addDoc,
    serverTimestamp, setDoc, updateDoc, where
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { onSnapshot } from "firebase/firestore";


/* ---------- Auth uid hook ---------- */
function useAuthUid() {
    const [uid, setUid] = useState(null);
    useEffect(() => {
        const off = auth.onAuthStateChanged(u => setUid(u ? u.uid : null));
        return () => off();
    }, []);
    return uid;
}



/* ---------- Tiny Markdown Preview ---------- */
function Preview({ md }) {
    const html = useMemo(() => {
        if (!md) return "";
        let s = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        s = s.replace(/^### (.*)$/gm, "<h3 class='text-lg font-semibold mt-4 mb-2'>$1</h3>");
        s = s.replace(/^## (.*)$/gm, "<h2 class='text-xl font-bold mt-5 mb-3'>$1</h2>");
        s = s.replace(/^# (.*)$/gm, "<h1 class='text-2xl font-bold mt-6 mb-4'>$1</h1>");
        s = s.replace(/\*\*(.+?)\*\*/g, "<strong class='font-semibold'>$1</strong>");
        s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
        s = s.replace(/`([^`]+)`/g, "<code class='px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-sm font-mono'>$1</code>");
        s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a class="text-indigo-600 hover:text-indigo-700 underline decoration-indigo-300 hover:decoration-indigo-500 transition-colors" href="$2" target="_blank" rel="noopener noreferrer">$1</a>`);
        s = s.replace(/^(?:-|\*) (.*)$/gm, "<li class='mb-1'>$1</li>");
        s = s.replace(/(<li>.*<\/li>)/gs, "<ul class='list-disc pl-6 space-y-1 my-3'>$1</ul>");
        s = s.replace(/\n{2,}/g, "</p><p class='mb-3'>").replace(/\n/g, "<br/>");
        return `<div class='leading-relaxed'><p class='mb-3'>${s}</p></div>`;
    }, [md]);
    return <div className="prose prose-sm max-w-none break-words text-gray-700" dangerouslySetInnerHTML={{ __html: html }} />;
}

const convictionLabels = ["", "Low", "Medium", "High", "Very High"];
const convictionColors = ["", "bg-red-100 text-red-700", "bg-yellow-100 text-yellow-700", "bg-green-100 text-green-700", "bg-emerald-100 text-emerald-700"];

const pct = (x) => `${(x).toFixed(1)}%`;
const toNum = (v) => (v === "" || v == null ? null : Number(v));

export default function HoldingDetail({ pid = "default" }) {
    const { symbol } = useParams();
    const [sp] = useSearchParams();
    const pidFromUrl = sp.get("pid");
    const effectivePid = pidFromUrl || pid;

    const uid = useAuthUid();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState(null);
    const [savedTick, setSavedTick] = useState(false);

    // core fields
    const [thesis, setThesis] = useState("");
    const [target, setTarget] = useState("");                // string for input
    const [current, setCurrent] = useState("");              // NEW: current price input (if not fed elsewhere)
    const [conviction, setConviction] = useState(3);
    const [tags, setTags] = useState([]);

    // NEW: notes, theses list, files, uploads, timeline sources
    const [notes, setNotes] = useState([]);                  // [{id, text, createdAt}]
    const [noteText, setNoteText] = useState("");

    const [theses, setTheses] = useState([]);                // list to render below
    const [thFormTitle, setThFormTitle] = useState("");
    const [thFormBody, setThFormBody] = useState("");

    const [files, setFiles] = useState([]);                  // [{id, name, url, size, contentType, createdAt}]
    const [uploadBusy, setUploadBusy] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);

    const [trades, setTrades] = useState([]);
    const [dividends, setDividends] = useState([]);

    const docRef = useMemo(
        () => (uid ? doc(db, "users", uid, "portfolios", effectivePid, "holdings", symbol) : null),
        [uid, effectivePid, symbol]
    );

    useEffect(() => {
        if (!uid) return;
        const fCol = collection(db, "users", uid, "portfolios", effectivePid, "holdings", symbol, "files");
        const qy = query(fCol, orderBy("createdAt", "desc"));
        const off = onSnapshot(qy, snap => {
            setFiles(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }, err => setErr(err.message));
        return off;
    }, [uid, effectivePid, symbol, db]);

    const initialRef = useRef({ thesis: "", target: "", current: "", conviction: 3, tags: [] });
    const isDirty =
        thesis !== initialRef.current.thesis ||
        target !== initialRef.current.target ||
        current !== initialRef.current.current ||
        conviction !== initialRef.current.conviction ||
        JSON.stringify(tags) !== JSON.stringify(initialRef.current.tags);

    const load = useCallback(async () => {
        if (!docRef) return;
        setErr(null); setLoading(true);
        try {
            const snap = await getDoc(docRef);

            if (snap.exists()) {
                const d = snap.data();
                const init = {
                    thesis: d?.thesis ?? "",
                    target: d?.targetPrice != null ? String(d.targetPrice) : "",
                    current: d?.currentPrice != null ? String(d.currentPrice) : "",
                    conviction: typeof d?.conviction === "number" ? d.conviction : 3,
                    tags: Array.isArray(d?.tags) ? d.tags : [],
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

            // txn/dividends for timeline
            const txCol = collection(db, "users", uid, "portfolios", effectivePid, "transactions");
            const divCol = collection(db, "users", uid, "portfolios", effectivePid, "dividends");
            const txQ = query(txCol, where("symbol", "==", symbol), orderBy("date", "desc"));
            const divQ = query(divCol, where("symbol", "==", symbol), orderBy("date", "desc"));
            const [txSnap, divSnap] = await Promise.all([getDocs(txQ), getDocs(divQ)]);
            setTrades(txSnap.docs.map(d => ({ id: d.id, ...d.data() })));
            setDividends(divSnap.docs.map(d => ({ id: d.id, ...d.data() })));

            // notes
            const notesCol = collection(db, "users", uid, "portfolios", effectivePid, "holdings", symbol, "notes");
            const notesQ = query(notesCol, orderBy("createdAt", "desc"));
            const notesSnap = await getDocs(notesQ);
            setNotes(notesSnap.docs.map(d => ({ id: d.id, ...d.data() })));

            // theses list
            const thCol = collection(db, "users", uid, "portfolios", effectivePid, "holdings", symbol, "theses");
            const thQ = query(thCol, orderBy("createdAt", "desc"));
            const thSnap = await getDocs(thQ);
            setTheses(thSnap.docs.map(d => ({ id: d.id, ...d.data() })));

            // files list (we store metadata in a subcollection when uploaded)
            const fCol = collection(db, "users", uid, "portfolios", effectivePid, "holdings", symbol, "files");
            const fQ = query(fCol, orderBy("createdAt", "desc"));
            const fSnap = await getDocs(fQ);
            setFiles(fSnap.docs.map(d => ({ id: d.id, ...d.data() })));

            // if current price empty, try reasonable fallback from latest trade:
            if (!initialRef.current.current) {
                const latestTrade = txSnap.docs.at(0)?.data();
                if (latestTrade?.price != null) {
                    setCurrent(String(latestTrade.price));
                    initialRef.current.current = String(latestTrade.price);
                }
            }
        } catch (e) {
            setErr(String(e));
        } finally {
            setLoading(false);
        }
    }, [docRef, effectivePid, symbol, uid]);

    useEffect(() => { load(); }, [load]);

    const saveCore = async () => {
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
            setTimeout(() => setSavedTick(false), 1500);
        } catch (e) {
            setErr(String(e));
        } finally {
            setSaving(false);
        }
    };

    // Ctrl/Cmd+S to save
    useEffect(() => {
        const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                if (!saving && isDirty) saveCore();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [saving, isDirty, thesis, target, current, conviction, tags]);

    // tag helpers
    const onTagKey = (e) => {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            const v = e.currentTarget.value.trim();
            if (v && !tags.includes(v)) setTags([...tags, v]);
            e.currentTarget.value = "";
        }
    };
    const removeTag = (t) => setTags(tags.filter(x => x !== t));

    // timeline
    const timeline = useMemo(() => {
        const rows = [
            ...trades.map(t => ({ type: t.side || "TRADE", date: t.date?.toDate?.() || new Date(t.date), note: `${t.side} ${t.qty} @ ₹${t.price}` })),
            ...dividends.map(d => ({ type: "DIV", date: d.date?.toDate?.() || new Date(d.date), note: `Dividend ₹${d.amount}` })),
        ].filter(x => x.date && !isNaN(x.date));
        rows.sort((a, b) => b.date - a.date);
        return rows;
    }, [trades, dividends]);

    // upside calc
    const currentNum = toNum(current);
    const targetNum = toNum(target);
    const upside = (currentNum && targetNum) ? ((targetNum - currentNum) / currentNum) * 100 : null;

    // notes handlers
    const addNote = async () => {
        const text = noteText.trim();
        if (!text) return;
        const notesCol = collection(db, "users", uid, "portfolios", effectivePid, "holdings", symbol, "notes");
        const refDoc = await addDoc(notesCol, { text, createdAt: serverTimestamp() });
        setNotes([{ id: refDoc.id, text, createdAt: new Date() }, ...notes]);
        setNoteText("");
    };

    // thesis form submit
    const submitThesisForm = async () => {
        const t = thFormTitle.trim();
        const b = thFormBody.trim();
        if (!t || !b) return;
        const thCol = collection(db, "users", uid, "portfolios", effectivePid, "holdings", symbol, "theses");
        const refDoc = await addDoc(thCol, {
            title: t,
            body: b,
            createdAt: serverTimestamp(),
        });
        setTheses([{ id: refDoc.id, title: t, body: b, createdAt: new Date() }, ...theses]);
        setThFormTitle("");
        setThFormBody("");
    };

    const sanitizeName = (name) => name.replace(/[#[\]*?]/g, "_");

    const onFiles = async (e) => {
        const input = e.target;                 // don't rely on pooled event later
        const list = Array.from(input.files || []);
        if (!list.length) return;
        if (!uid) { setErr("Please sign in first."); input.value = ""; return; }
        if (!storage) { setErr("Storage not initialized"); input.value = ""; return; }

        setUploadBusy(true);
        setUploadProgress(0);
        setErr(null);

        try {
            for (const f of list) {
                const safeName = `${Date.now()}_${sanitizeName(f.name)}`;
                const path = `users/${uid}/portfolios/${effectivePid}/holdings/${symbol}/${safeName}`;
                const r = ref(storage, path);
                const meta = { contentType: f.type || "application/octet-stream" };

                await new Promise((resolve, reject) => {
                    const task = uploadBytesResumable(r, f, meta);
                    task.on(
                        "state_changed",
                        snap => {
                            const p = (snap.bytesTransferred / snap.totalBytes) * 100;
                            setUploadProgress(Math.round(p));
                        },
                        error => {
                            console.error("Upload error:", error);
                            reject(error);
                        },
                        async () => {
                            const url = await getDownloadURL(task.snapshot.ref);
                            // write a metadata doc to Firestore
                            const fCol = collection(db, "users", uid, "portfolios", effectivePid, "holdings", symbol, "files");
                            const docData = {
                                name: f.name,
                                size: f.size,
                                contentType: meta.contentType,
                                url,
                                storagePath: path,
                                createdAt: serverTimestamp(),
                            };
                            const created = await addDoc(fCol, docData);

                            // optimistic add (use functional set to avoid stale closure)
                            setFiles(prev => [{ id: created.id, ...docData, createdAt: new Date() }, ...prev]);
                            resolve();
                        }
                    );
                });
            }
        } catch (e) {
            setErr(typeof e?.message === "string" ? e.message : String(e));
        } finally {
            setUploadBusy(false);
            setUploadProgress(0);
            input.value = ""; // reset file input
        }
    };

    if (!uid) {
        return (
            <>
                <SiteHeader />
                <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
                    <div className="text-center py-12">
                        <p className="text-gray-600">Please sign in to view holding details.</p>
                    </div>
                </main>
            </>
        );
    }

    return (
        <>
            <SiteHeader />

            <div className="bg-gradient-to-br from-indigo-50 via-white to-purple-50 min-h-screen">
                <div className="h-1 w-full bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600" />

                <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
                    {/* Header */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                            <div className="space-y-2 min-w-0">
                                <div className="flex items-center gap-3">
                                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700">
                                        HOLDING
                                    </span>
                                    <span className="text-xs text-gray-500 font-mono truncate">
                                        {effectivePid}
                                    </span>
                                </div>
                                <h1 className="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent break-words">
                                    {symbol}
                                </h1>
                            </div>

                            <div className="flex items-center gap-3">
                                {savedTick && (
                                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm font-medium animate-in fade-in slide-in-from-top-2 duration-300">
                                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                        </svg>
                                        Saved
                                    </div>
                                )}
                                <button
                                    onClick={saveCore}
                                    disabled={saving || !isDirty}
                                    className="px-6 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 shadow-lg shadow-indigo-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                                    title="Ctrl/Cmd+S"
                                >
                                    {saving ? (
                                        <span className="flex items-center gap-2">
                                            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                            </svg>
                                            Saving
                                        </span>
                                    ) : isDirty ? "Save Changes" : "Saved"}
                                </button>
                                <Link
                                    to="/insights"
                                    className="px-5 py-2.5 rounded-xl font-medium border-2 border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all"
                                >
                                    Back
                                </Link>
                            </div>
                        </div>
                    </div>

                    {err && (
                        <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-800 text-sm flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
                            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                            </svg>
                            {err}
                        </div>
                    )}

                    {loading && (
                        <div className="flex items-center justify-center py-12">
                            <div className="flex items-center gap-3 text-gray-500">
                                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                Loading...
                            </div>
                        </div>
                    )}

                    {/* === Controls: Target, Current, Upside, Conviction, Tags === */}
                    <div className="grid md:grid-cols-5 gap-4">
                        {/* Target */}
                        <div className="group bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md hover:border-indigo-200 transition-all md:col-span-1">
                            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
                                <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                </svg>
                                Target Price
                            </label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-semibold">₹</span>
                                <input
                                    type="number"
                                    className="w-full rounded-lg pl-8 pr-3 py-3 text-lg font-semibold bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                                    value={target}
                                    onChange={(e) => setTarget(e.target.value)}
                                    placeholder="2400"
                                />
                            </div>
                        </div>

                        {/* Current */}
                        <div className="group bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md hover:border-indigo-200 transition-all md:col-span-1">
                            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
                                <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 1.343-3 3v6h6v-6c0-1.657-1.343-3-3-3z" />
                                </svg>
                                Current Price
                            </label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-semibold">₹</span>
                                <input
                                    type="number"
                                    className="w-full rounded-lg pl-8 pr-3 py-3 text-lg font-semibold bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                                    value={current}
                                    onChange={(e) => setCurrent(e.target.value)}
                                    placeholder="Add current"
                                />
                            </div>
                            <p className="text-xs text-gray-500 mt-2">If you have live quotes elsewhere, you can still override here.</p>
                        </div>

                        {/* Upside */}
                        <div className="group bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md hover:border-indigo-200 transition-all md:col-span-1">
                            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
                                <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                                </svg>
                                Upside
                            </label>
                            <div className="flex items-end justify-between">
                                <div className="text-2xl font-extrabold">
                                    {upside == null ? "—" : pct(upside)}
                                </div>
                                <div className="text-xs text-gray-500 font-mono">
                                    {targetNum && currentNum ? `(${targetNum} / ${currentNum})` : ""}
                                </div>
                            </div>
                            <div className="mt-3 h-2 w-full rounded bg-gray-100 overflow-hidden">
                                <div
                                    className={`h-2 ${upside != null && upside >= 0 ? "bg-emerald-500" : "bg-rose-500"}`}
                                    style={{ width: `${Math.min(Math.abs(upside || 0), 100)}%` }}
                                />
                            </div>
                        </div>

                        {/* Conviction */}
                        <div className="group bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md hover:border-indigo-200 transition-all md:col-span-1">
                            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
                                <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Conviction
                            </label>
                            <input
                                type="range"
                                min="1"
                                max="4"
                                step="1"
                                value={conviction}
                                onChange={(e) => setConviction(parseInt(e.target.value, 10))}
                                className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                                style={{
                                    background: `linear-gradient(to right, rgb(79 70 229) 0%, rgb(79 70 229) ${((conviction - 1) / 3) * 100}%, rgb(229 231 235) ${((conviction - 1) / 3) * 100}%, rgb(229 231 235) 100%)`
                                }}
                            />
                            <div className="flex items-center justify-between mt-3">
                                <span className={`px-3 py-1 rounded-full text-sm font-semibold ${convictionColors[conviction]}`}>
                                    {convictionLabels[conviction]}
                                </span>
                                <span className="text-sm text-gray-500 font-medium">{conviction} / 4</span>
                            </div>
                        </div>

                        {/* Tags */}
                        <div className="group bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md hover:border-indigo-200 transition-all md:col-span-1">
                            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
                                <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                                </svg>
                                Tags
                            </label>
                            <div className="flex flex-wrap gap-2 mb-3 min-h-[32px]">
                                {tags.map((t) => (
                                    <span
                                        key={t}
                                        className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border-2 border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
                                    >
                                        {t}
                                        <button
                                            className="ml-1 hover:text-indigo-900 transition-colors"
                                            onClick={() => removeTag(t)}
                                            title="Remove"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                            </svg>
                                        </button>
                                    </span>
                                ))}
                            </div>
                            <input
                                type="text"
                                onKeyDown={onTagKey}
                                className="w-full rounded-lg px-3 py-2 bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all text-sm"
                                placeholder="Type and press Enter"
                            />
                        </div>
                    </div>

                    {/* === Notes + Thesis Form + Files === */}
                    <div className="grid lg:grid-cols-3 gap-6">
                        {/* Quick Notes */}
                        <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-600">Notes</h3>
                                <span className="text-xs text-gray-400">{notes.length} saved</span>
                            </div>

                            <div className="flex gap-2">
                                <input
                                    value={noteText}
                                    onChange={(e) => setNoteText(e.target.value)}
                                    className="flex-1 rounded-lg px-3 py-2 bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                                    placeholder="Add a quick note (Enter to save)"
                                    onKeyDown={(e) => { if (e.key === "Enter") addNote(); }}
                                />
                                <button
                                    onClick={addNote}
                                    className="px-3 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700"
                                >
                                    Add
                                </button>
                            </div>

                            <ul className="mt-4 space-y-2 max-h-56 overflow-y-auto pr-1">
                                {notes.map(n => (
                                    <li key={n.id} className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                                        <div className="text-gray-800">{n.text}</div>
                                        <div className="text-[11px] text-gray-500 mt-1">
                                            {n.createdAt?.toDate?.()?.toLocaleString?.() || ""}
                                        </div>
                                    </li>
                                ))}
                                {notes.length === 0 && <li className="text-sm text-gray-400">No notes yet.</li>}
                            </ul>
                        </section>

                        {/* Investment Thesis – Structured Form */}
                        <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-600">Add Investment Thesis</h3>
                                <span className="text-xs text-gray-400">Stored in DB</span>
                            </div>

                            <input
                                value={thFormTitle}
                                onChange={(e) => setThFormTitle(e.target.value)}
                                className="w-full rounded-lg px-3 py-2 bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm mb-2"
                                placeholder="Title (e.g., FY27 rerating on margin expansion)"
                            />
                            <textarea
                                value={thFormBody}
                                onChange={(e) => setThFormBody(e.target.value)}
                                className="w-full h-32 rounded-lg px-3 py-2 bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                                placeholder={`Summary, Bull case, Risks, Catalysts...`}
                            />
                            <div className="mt-3 flex justify-end">
                                <button
                                    onClick={submitThesisForm}
                                    className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700"
                                >
                                    Save Thesis
                                </button>
                            </div>

                            {/* List saved theses */}
                            <div className="mt-5 space-y-3 max-h-48 overflow-y-auto pr-1">
                                {theses.map(t => (
                                    <div key={t.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <h4 className="font-semibold text-gray-900">{t.title}</h4>
                                            <span className="text-[11px] text-gray-500">{t.createdAt?.toDate?.()?.toLocaleDateString?.()}</span>
                                        </div>
                                        <div className="mt-2 text-sm text-gray-700 line-clamp-4">
                                            <Preview md={t.body} />
                                        </div>
                                    </div>
                                ))}
                                {theses.length === 0 && <p className="text-sm text-gray-400">No theses yet.</p>}
                            </div>
                        </section>

                        
                    </div>

                    {/* === Freeform Investment Thesis (kept from before) with Preview side-by-side === */}
                    <div className="grid lg:grid-cols-2 gap-6">
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                            <div className="flex items-center justify-between mb-4">
                                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                                    <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                    Investment Thesis (Freeform)
                                </label>
                                <span className="text-xs text-gray-400 font-medium">⌘S to save</span>
                            </div>
                            <textarea
                                className="w-full h-64 rounded-lg p-4 font-mono text-sm bg-gray-50 border-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none"
                                value={thesis}
                                onChange={(e) => setThesis(e.target.value)}
                                placeholder={`# Why ${symbol}?\n\n## Investment Case\n- Competitive moat\n- Growth catalysts\n- Key risks\n\n## Valuation\n- Target multiple\n- Comparable analysis`}
                            />
                        </div>
                        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 overflow-hidden">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">
                                <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                                Preview
                            </div>
                            <div className="h-64 overflow-y-auto pr-2">
                                {thesis ? (
                                    <Preview md={thesis} />
                                ) : (
                                    <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                                        Start typing to see preview
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* === Activity Timeline (Shrunk/Collapsible) === */}
                    <details className="bg-white rounded-xl shadow-sm border border-gray-100">
                        <summary className="list-none p-6 cursor-pointer flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <h2 className="text-lg font-bold text-gray-900">Activity Timeline</h2>
                            </div>
                            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">{timeline.length} events</span>
                        </summary>

                        <div className="p-6 pt-0">
                            {timeline.length === 0 ? (
                                <div className="py-8 text-center">
                                    <p className="text-gray-600 mb-1">No activity yet</p>
                                    <p className="text-sm text-gray-500 max-w-md mx-auto">
                                        Import transactions and dividends to see your activity timeline
                                    </p>
                                </div>
                            ) : (
                                <div className="relative pl-8 max-h-72 overflow-y-auto pr-2">
                                    <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-gradient-to-b from-indigo-200 via-purple-200 to-indigo-200" />
                                    {timeline.map((e, i) => (
                                        <div key={i} className="relative mb-4 last:mb-0">
                                            <div className={`absolute left-[-19px] mt-1 h-3 w-3 rounded-full ${e.type === 'DIV' ? 'bg-green-500 ring-4 ring-green-100' : 'bg-indigo-600 ring-4 ring-indigo-100'}`} />
                                            <div className="bg-gray-50 rounded-lg p-3">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium text-gray-900 truncate">{e.note}</p>
                                                        <p className="text-xs text-gray-500">
                                                            {e.date.toLocaleString?.('en-US', {
                                                                year: 'numeric', month: 'short', day: 'numeric',
                                                                hour: '2-digit', minute: '2-digit'
                                                            }) || e.date}
                                                        </p>
                                                    </div>
                                                    <span className={`flex-shrink-0 px-2 py-1 rounded text-[11px] font-semibold ${e.type === 'DIV' ? 'bg-green-100 text-green-700' : 'bg-indigo-100 text-indigo-700'}`}>
                                                        {e.type}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </details>
                </main>
            </div>
        </>
    );
}
