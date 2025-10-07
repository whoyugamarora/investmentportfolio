// src/pages/XirrPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { auth, db } from "../Authentication/firebase";
import {
    addDoc, collection, deleteDoc, doc, onSnapshot,
    orderBy, query, serverTimestamp, updateDoc
} from "firebase/firestore";
import { xirr } from "../utils/xirr";
import { format as inr } from "indian-number-format";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPencil, faTrash, faFileImport, faFileExport, faPlus } from "@fortawesome/free-solid-svg-icons";
import SiteHeader from "../Components/SiteHeader";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import EmptyState from "../Components/EmptyState";
import TableSkeleton from "../Components/ui/TableSkeleton";


/* ---------- Firestore helpers ---------- */
const uidPath = (uid) => ["users", uid];
const pCol = (uid) => collection(db, ...uidPath(uid), "portfolios");
const pDoc = (uid, pid) => doc(db, ...uidPath(uid), "portfolios", pid);
const cfCol = (uid, pid) => collection(db, ...uidPath(uid), "portfolios", pid, "cashflows");
const cfDoc = (uid, pid, cid) => doc(db, ...uidPath(uid), "portfolios", pid, "cashflows", cid);

function useAuthUid() {
    const [uid, setUid] = useState(auth.currentUser?.uid || null);
    useEffect(() => {
        const unsub = auth.onAuthStateChanged((u) => setUid(u?.uid || null));
        return () => unsub();
    }, []);
    return uid;
}

// inside XirrPage component, above return()
const addPortfolio = async () => {
    if (!uidPath) return;
    const name = prompt("Portfolio name?");
    if (!name) return;

    await addDoc(pCol(uidPath), {
        name,
        currentValue: 0,
        currentValueAsOf: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
};


/* ---------- UI primitives ---------- */
function Modal({ open, onClose, title, children, actions, maxWidth = "max-w-lg" }) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/40" onClick={onClose} />
            <div className="absolute inset-0 grid place-items-center p-4">
                <div className={`w-full ${maxWidth} rounded-xl bg-white dark:bg-gray-800 border border-black/10 dark:border-white/10 shadow-xl overflow-hidden`}>
                    <div className="px-4 sm:px-6 py-4 border-b border-black/10 dark:border-white/10">
                        <h3 className="text-lg font-semibold text-black">{title}</h3>
                    </div>
                    <div className="px-4 sm:px-6 py-4 text-gray-900">{children}</div>
                    <div className="px-4 sm:px-6 py-3 flex items-center justify-end gap-2 border-t border-black/10 dark:border-white/10">
                        {actions}
                        <button
                            onClick={onClose}
                            className="px-3 py-2 text-gray-800 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 dark:bg-white/10 dark:hover:bg-white/15"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Confirm({ open, onClose, title, message, onConfirm }) {
    return (
        <Modal
            open={open}
            onClose={onClose}
            title={title}
            actions={
                <button
                    onClick={onConfirm}
                    className="px-3 py-2 rounded-lg text-sm font-medium bg-rose-600 text-white hover:bg-rose-700"
                >
                    Confirm
                </button>
            }
        >
            <p className="text-sm text-gray-600 dark:text-gray-300">{message}</p>
        </Modal>
    );
}

// Card that shrinks nicely in the grid
function Section({ title, right, children }) {
    return (
        <section className="rounded-xl bg-white dark:bg-gray-800 border border-black/10 dark:border-white/10 p-4 sm:p-6 min-w-0 overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 mb-4">
                <h2 className="order-1 flex-1 min-w-0 text-lg sm:text-xl font-semibold truncate text-gray-900 dark:text-gray-100">
                    {title}
                </h2>
                {right ? (
                    <div className="order-2 w-full md:w-auto flex items-center gap-2 flex-wrap justify-start md:justify-end">
                        {right}
                    </div>
                ) : null}
            </div>
            <div className="min-w-0">{children}</div>
        </section>
    );
}


/* ---------- CSV helpers ---------- */
// naive-but-robust-enough CSV splitter (handles quotes)
function splitCsvLine(line) {
    const out = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else { inQ = !inQ; }
        } else if (ch === "," && !inQ) {
            out.push(cur); cur = "";
        } else cur += ch;
    }
    out.push(cur);
    return out;
}

function toCsvValue(s) {
    const v = String(s ?? "");
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
}

/* ---------- Main Page ---------- */
export default function XirrPage() {
    const uid = useAuthUid();
    const [portfolios, setPortfolios] = useState([]);
    const [selectedIds, setSelectedIds] = useState([]);
    const [flowsByPid, setFlowsByPid] = useState({});
    const [loading, setLoading] = useState(true);
    const [darkMode, setDarkMode] = useState(false);
    const navigate = useNavigate();

    // Filters (apply to transactions views & export)
    const [filter, setFilter] = useState({
        start: "", end: "", type: "all", q: "", min: "", max: ""
    });

    // Modal state
    const [portModal, setPortModal] = useState({ open: false, mode: "add", portfolio: null });
    const [valueModal, setValueModal] = useState({ open: false, portfolio: null, value: "" });
    const [flowModal, setFlowModal] = useState({ open: false, mode: "add", pid: null, flow: null });
    const [confirmDel, setConfirmDel] = useState({ open: false, kind: "", pid: null, cf: null, name: "" });
    const [importModal, setImportModal] = useState({ open: false }); // single portfolio only

    /* ---- load portfolios ---- */
    useEffect(() => {
        if (!uid) return;
        const qy = query(pCol(uid), orderBy("createdAt", "asc"));
        const unsub = onSnapshot(qy, (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            setPortfolios(rows);
            setLoading(false);
        });
        return () => unsub();
    }, [uid]);

    /* ---- load cashflows for selected ---- */
    useEffect(() => {
        if (!uid) return;
        const unsubs = selectedIds.map((pid) => {
            const qy = query(cfCol(uid, pid), orderBy("date", "asc"));
            return onSnapshot(qy, (snap) => {
                setFlowsByPid((prev) => ({
                    ...prev,
                    [pid]: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
                }));
            });
        });
        return () => unsubs.forEach((u) => u && u());
    }, [uid, selectedIds]);

    const toggleSelected = (pid) =>
        setSelectedIds((prev) => (prev.includes(pid) ? prev.filter((x) => x !== pid) : [...prev, pid]));

    /* ---------- Portfolio CRUD (modals) ---------- */
    const openAddPortfolio = () => setPortModal({ open: true, mode: "add", portfolio: null });
    const openRenamePortfolio = (p) => setPortModal({ open: true, mode: "rename", portfolio: p });

    const savePortfolio = async (e) => {
        e.preventDefault();
        if (!uid) return;
        const form = new FormData(e.currentTarget);
        const name = String(form.get("name") || "").trim();
        if (!name) return;

        if (portModal.mode === "add") {
            await addDoc(pCol(uid), {
                name,
                currentValue: 0,
                currentValueAsOf: serverTimestamp(),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
        } else if (portModal.mode === "rename" && portModal.portfolio) {
            await updateDoc(pDoc(uid, portModal.portfolio.id), { name, updatedAt: serverTimestamp() });
        }
        setPortModal({ open: false, mode: "add", portfolio: null });
    };

    const openSetValue = (p) => {
        setValueModal({ open: true, portfolio: p, value: String(p.currentValue ?? "") });
    };
    const saveValue = async (e) => {
        e.preventDefault();
        if (!uid || !valueModal.portfolio) return;
        const form = new FormData(e.currentTarget);
        const n = Number(form.get("value"));
        if (!Number.isFinite(n)) return;
        await updateDoc(pDoc(uid, valueModal.portfolio.id), {
            currentValue: n,
            currentValueAsOf: new Date(),
            updatedAt: serverTimestamp(),
        });
        setValueModal({ open: false, portfolio: null, value: "" });
    };

    const confirmDeletePortfolio = (p) =>
        setConfirmDel({ open: true, kind: "portfolio", pid: p.id, name: p.name });

    const reallyDeletePortfolio = async () => {
        if (!uid || !confirmDel.pid) return;
        await deleteDoc(pDoc(uid, confirmDel.pid));
        setSelectedIds((prev) => prev.filter((id) => id !== confirmDel.pid));
        setConfirmDel({ open: false, kind: "", pid: null, cf: null, name: "" });
    };

    /* ---------- Cashflow CRUD (modals) ---------- */
    const openAddFlow = (pid) =>
        setFlowModal({ open: true, mode: "add", pid, flow: { date: new Date().toISOString().slice(0, 10), amount: "-10000", note: "" } });

    const openEditFlow = (pid, cf) => {
        const d = cf.date?.toDate ? cf.date.toDate() : new Date(cf.date);
        setFlowModal({
            open: true, mode: "edit", pid,
            flow: { id: cf.id, date: d.toISOString().slice(0, 10), amount: String(cf.amount), note: cf.note || "" }
        });
    };

    const saveFlow = async (e) => {
        e.preventDefault();
        if (!uid || !flowModal.pid) return;
        const form = new FormData(e.currentTarget);
        const dateStr = String(form.get("date"));
        const amount = Number(form.get("amount"));
        const note = String(form.get("note") || "");
        if (!dateStr || !Number.isFinite(amount)) return;

        const payload = {
            date: new Date(`${dateStr}T00:00:00`),
            amount,
            note,
            type: amount < 0 ? "outflow" : "inflow",
            updatedAt: serverTimestamp(),
        };

        if (flowModal.mode === "add") {
            await addDoc(cfCol(uid, flowModal.pid), {
                ...payload,
                createdAt: serverTimestamp(),
            });
        } else if (flowModal.mode === "edit" && flowModal.flow?.id) {
            await updateDoc(cfDoc(uid, flowModal.pid, flowModal.flow.id), payload);
        }
        setFlowModal({ open: false, mode: "add", pid: null, flow: null });
    };

    const confirmDeleteFlow = (pid, cf) =>
        setConfirmDel({ open: true, kind: "flow", pid, cf, name: "" });

    const reallyDeleteFlow = async () => {
        if (!uid || !confirmDel.pid || !confirmDel.cf) return;
        await deleteDoc(cfDoc(uid, confirmDel.pid, confirmDel.cf.id));
        setConfirmDel({ open: false, kind: "", pid: null, cf: null, name: "" });
    };

    /* ---------- CSV Import/Export ---------- */
    const onOpenImport = () => setImportModal({ open: true });
    const doImportCsv = async (file) => {
        if (!uid || selectedIds.length !== 1 || !file) return;
        const pid = selectedIds[0];
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
        if (!lines.length) return;

        // header
        const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
        const di = header.indexOf("date");
        const ai = header.indexOf("amount");
        const ni = header.indexOf("note");
        if (di === -1 || ai === -1) {
            alert('CSV must include "Date" and "Amount" headers (and optional "Note").');
            return;
        }

        const rows = lines.slice(1).map((ln) => {
            const cols = splitCsvLine(ln);
            return {
                date: cols[di]?.trim(),
                amount: Number((cols[ai] ?? "").toString().trim()),
                note: ni >= 0 ? (cols[ni] ?? "").toString().trim() : "",
            };
        }).filter((r) => r.date && Number.isFinite(r.amount));

        if (!rows.length) {
            alert("No valid rows found.");
            return;
        }

        // Upload sequentially (simple & safe)
        for (const r of rows) {
            await addDoc(cfCol(uid, pid), {
                date: new Date(`${r.date}T00:00:00`),
                amount: r.amount,
                note: r.note,
                type: r.amount < 0 ? "outflow" : "inflow",
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
        }
        setImportModal({ open: false });
    };

    const doExportCsv = () => {
        if (!selectedIds.length) return;

        // gather flows (with filters)
        const gather = selectedIds.flatMap((pid) => {
            const p = portfolios.find((pp) => pp.id === pid);
            const list = (flowsByPid[pid] || []).map((r) => ({ ...r, _pid: pid, _pname: p?.name || pid }));
            return list;
        });

        const filtered = applyFilters(gather, filter);

        const header = ["Date", "Portfolio", "Amount", "Note"];
        const rows = filtered.map((r) => {
            const d = r.date?.toDate ? r.date.toDate() : new Date(r.date);
            return [
                d.toISOString().slice(0, 10),
                r._pname || "",
                String(r.amount),
                r.note || "",
            ];
        });

        const csv = [header, ...rows]
            .map((row) => row.map(toCsvValue).join(","))
            .join("\n");

        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = selectedIds.length === 1 ? `cashflows_${(portfolios.find(p => p.id === selectedIds[0])?.name || "portfolio")}.csv` : "cashflows_combined.csv";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    /* ---------- XIRR ---------- */
    const computeXirr = (pids) => {
        const flows = [];
        let terminal = 0;

        pids.forEach((pid) => {
            const p = portfolios.find((x) => x.id === pid);
            const list = flowsByPid[pid] || [];
            list.forEach((r) => {
                const d = r.date?.toDate ? r.date.toDate() : new Date(r.date);
                flows.push({ date: d, amount: Number(r.amount) });
            });
            terminal += Number(p?.currentValue || 0);
        });

        if (terminal > 0) {
            flows.push({ date: new Date(), amount: terminal });
        }

        const dates = new Set(flows.map((f) => new Date(f.date).toDateString()));
        if (flows.length < 2 || dates.size < 2) return null;
        return xirr(flows);
    };

    const activeXirr = useMemo(() => computeXirr(selectedIds), [flowsByPid, portfolios, selectedIds]);

    /* ---------- Filters ---------- */
    function applyFilters(list, f) {
        return (list || []).filter((r) => {
            const d = r.date?.toDate ? r.date.toDate() : new Date(r.date);
            if (f.start && d < new Date(`${f.start}T00:00:00`)) return false;
            if (f.end && d > new Date(`${f.end}T23:59:59`)) return false;
            if (f.type !== "all") {
                const t = Number(r.amount) < 0 ? "outflow" : "inflow";
                if (t !== f.type) return false;
            }
            if (f.q && !(r.note || "").toLowerCase().includes(f.q.toLowerCase())) return false;
            if (f.min !== "" && Number(r.amount) < Number(f.min)) return false;
            if (f.max !== "" && Number(r.amount) > Number(f.max)) return false;
            return true;
        });
    }

    const handleLogout = async () => {
        await signOut(auth);
        navigate("/login");
    };

    /* ---------- Derived rows for tables ---------- */
    const singleRowsRaw = selectedIds.length === 1 ? (flowsByPid[selectedIds[0]] || []) : [];
    const singleRows = useMemo(() => applyFilters(singleRowsRaw, filter), [singleRowsRaw, filter]);

    const combinedRowsRaw = useMemo(() => {
        if (selectedIds.length <= 1) return [];
        return selectedIds.flatMap((pid) => {
            const p = portfolios.find((pp) => pp.id === pid);
            return (flowsByPid[pid] || []).map((r) => ({ ...r, _pid: pid, _pname: p?.name || pid }));
        }).sort((a, b) => {
            const ad = a.date?.toDate ? a.date.toDate() : new Date(a.date);
            const bd = b.date?.toDate ? b.date.toDate() : new Date(b.date);
            return +ad - +bd;
        });
    }, [selectedIds, flowsByPid, portfolios]);
    const combinedRows = useMemo(() => applyFilters(combinedRowsRaw, filter), [combinedRowsRaw, filter]);

    return (
        <div className={`min-h-screen ${darkMode ? "bg-gray-900 text-gray-100" : "bg-gray-50 text-gray-900"} `}>
            <div className="">
                <SiteHeader
                    title="Portfolio Tracker"
                    darkMode={darkMode}
                    onToggleDarkMode={() => setDarkMode((v) => !v)}
                    onLogout={handleLogout}
                />
            </div>

            <div className="mx-6 py-4">

            <div className="mb-6 flex items-center gap-3 flex-wrap justify-between">
                <h1 className="text-2xl md:text-3xl font-extrabold">XIRR</h1>
                <div className="w-full md:w-auto flex items-center gap-2">
                    <button
                        onClick={openAddPortfolio}
                        className="px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700"
                    >
                        <FontAwesomeIcon icon={faPlus} className="mr-1" />
                        Add Portfolio
                    </button>
                </div>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Portfolios */}
                <Section title="Portfolios">
                    {loading ? (
                        <TableSkeleton rows={5} />
                    ) : portfolios.length === 0 ? (
                        <EmptyState
                            dark={darkMode}
                            icon={faPlus}
                            title="Create your first portfolio"
                            subtitle="Add a portfolio and start recording cashflows to compute XIRR."
                            primaryText="+ Add Portfolio"
                            onPrimary={addPortfolio}
                        />
                    ) : portfolios.length === 0 ? (
                        <div className="text-sm text-gray-500 dark:text-gray-400">No portfolios yet.</div>
                    ) : (
                        <ul className="space-y-2">
                            {portfolios.map((p) => (
                                <li
                                    key={p.id}
                                    className="rounded-lg border border-black/10 dark:border-white/10 p-3 min-w-0
                                        text-gray-900 dark:text-gray-100"
                                >
                                    <div className="flex flex-wrap items-center gap-3">
                                        <label className="flex items-center gap-2 cursor-pointer min-w-0">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(p.id)}
                                                onChange={() => toggleSelected(p.id)}
                                            />
                                            <span className="font-medium truncate max-w-[12rem] sm:max-w-none">
                                                {p.name}
                                            </span>
                                        </label>

                                        <div className="flex flex-wrap gap-2 w-full md:w-auto md:ml-auto">
                                            <button
                                                className="text-xs px-2 py-1 rounded whitespace-nowrap
                                                    bg-gray-100 hover:bg-gray-200
                                                    dark:bg-white/10 dark:hover:bg-white/15 dark:text-gray-100"
                                                onClick={() => openRenamePortfolio(p)}
                                            >
                                                <FontAwesomeIcon icon={faPencil} />
                                            </button>

                                            <button
                                                className="text-xs px-2 py-1 rounded whitespace-nowrap
                                                    bg-gray-100 hover:bg-gray-200
                                                    dark:bg-white/10 dark:hover:bg-white/15 dark:text-gray-100"
                                                onClick={() => openSetValue(p)}
                                            >
                                                Set Value
                                            </button>

                                            <button
                                                className="text-xs px-2 py-1 rounded whitespace-nowrap
                                                    bg-rose-100 hover:bg-rose-200 text-rose-700
                                                    dark:bg-rose-500/15 dark:hover:bg-rose-500/20 dark:text-rose-300"
                                                onClick={() => confirmDeletePortfolio(p)}
                                            >
                                                <FontAwesomeIcon icon={faTrash} />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                                        Current Value: ₹{inr(Number(p.currentValue || 0).toFixed(0))}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </Section>

                {/* Transactions */}
                <Section
                    title={
                        selectedIds.length === 1
                            ? `Transactions — ${portfolios.find((p) => p.id === selectedIds[0])?.name || ""}`
                            : selectedIds.length > 1
                                ? "Transactions (combined selection)"
                                : "Transactions"
                    }
                    right={
                        <div className="flex text-black items-center gap-2">
                            <button
                                disabled={selectedIds.length < 1}
                                onClick={doExportCsv}
                                className={`px-3 py-2 rounded-lg text-sm font-medium border
                                ${selectedIds.length
                                        ? "bg-white hover:bg-gray-50 dark:bg-white/10 dark:hover:bg-white/15"
                                        : "opacity-50 cursor-not-allowed"
                                    }`}
                                title="Export CSV"
                            >
                                <FontAwesomeIcon icon={faFileExport} className="mr-2" />
                                Export
                            </button>

                            {selectedIds.length === 1 && (
                                <>
                                    <button
                                        onClick={() => openAddFlow(selectedIds[0])}
                                        className="px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700"
                                    >
                                        <FontAwesomeIcon icon={faPlus} className="mr-2" />
                                        Add
                                    </button>

                                    <button
                                        onClick={onOpenImport}
                                        className="px-3 py-2 rounded-lg text-sm font-medium border
                                            bg-white hover:bg-gray-50
                                            dark:bg-white/10 dark:hover:bg-white/15 dark:text-gray-100"
                                    >
                                        <FontAwesomeIcon icon={faFileImport} className="mr-2" />
                                        Import
                                    </button>
                                </>
                            )}
                        </div>
                    }
                >
                    {/* Filters */}
                    <div className="mb-3 grid grid-cols-2 md:grid-cols-6 gap-2">
                        <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Start</label>
                            <input
                                type="date"
                                value={filter.start}
                                onChange={(e) => setFilter({ ...filter, start: e.target.value })}
                                className="w-full px-2 py-1.5 rounded border border-black/10 dark:border-white/10
                                    bg-white dark:bg-gray-900
                                    text-gray-900 dark:text-gray-100
                                    placeholder:text-gray-400 dark:placeholder:text-gray-500
                                    focus:outline-none focus:ring-2 focus:ring-indigo-500/50 dark:focus:ring-indigo-400/40"
                            />
                        </div>

                        <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">End</label>
                            <input
                                type="date"
                                value={filter.end}
                                onChange={(e) => setFilter({ ...filter, end: e.target.value })}
                                className="w-full px-2 py-1.5 rounded border border-black/10 dark:border-white/10
                                    bg-white dark:bg-gray-900
                                    text-gray-900 dark:text-gray-100
                                    placeholder:text-gray-400 dark:placeholder:text-gray-500
                                    focus:outline-none focus:ring-2 focus:ring-indigo-500/50 dark:focus:ring-indigo-400/40"
                            />
                        </div>

                        <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Type</label>
                            <select
                                value={filter.type}
                                onChange={(e) => setFilter({ ...filter, type: e.target.value })}
                                className="w-full px-2 py-1.5 rounded border border-black/10 dark:border-white/10
                                    bg-white dark:bg-gray-900
                                    text-gray-900 dark:text-gray-100
                                    focus:outline-none focus:ring-2 focus:ring-indigo-500/50 dark:focus:ring-indigo-400/40"
                            >
                                <option value="all">All</option>
                                <option value="inflow">Inflow</option>
                                <option value="outflow">Outflow</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Min (₹)</label>
                            <input
                                type="number"
                                value={filter.min}
                                onChange={(e) => setFilter({ ...filter, min: e.target.value })}
                                className="w-full px-2 py-1.5 rounded border border-black/10 dark:border-white/10
                                    bg-white dark:bg-gray-900
                                    text-gray-900 dark:text-gray-100
                                    focus:outline-none focus:ring-2 focus:ring-indigo-500/50 dark:focus:ring-indigo-400/40"
                            />
                        </div>

                        <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Max (₹)</label>
                            <input
                                type="number"
                                value={filter.max}
                                onChange={(e) => setFilter({ ...filter, max: e.target.value })}
                                className="w-full px-2 py-1.5 rounded border border-black/10 dark:border-white/10
                                            bg-white dark:bg-gray-900
                                            text-gray-900 dark:text-gray-100
                                            focus:outline-none focus:ring-2 focus:ring-indigo-500/50 dark:focus:ring-indigo-400/40"
                            />
                        </div>

                        <div>
                            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Search Note</label>
                            <input
                                type="text"
                                placeholder="e.g. dividend"
                                value={filter.q}
                                onChange={(e) => setFilter({ ...filter, q: e.target.value })}
                                className="w-full px-2 py-1.5 rounded border border-black/10 dark:border-white/10
                                                bg-white dark:bg-gray-900
                                                text-gray-900 dark:text-gray-100
                                                placeholder:text-gray-400 dark:placeholder:text-gray-500
                                                focus:outline-none focus:ring-2 focus:ring-indigo-500/50 dark:focus:ring-indigo-400/40"
                            />
                        </div>
                    </div>

                    {/* Tables */}
                    {selectedIds.length === 0 ? (
                        <div className="text-sm text-gray-500 dark:text-black">Select 1 or more portfolios to view.</div>
                    ) : selectedIds.length === 1 ? (
                        <CashflowTable
                            rows={singleRows}
                            onEdit={(cf) => openEditFlow(selectedIds[0], cf)}
                            onDelete={(cf) => confirmDeleteFlow(selectedIds[0], cf)}
                        />
                    ) : (
                        <CombinedTable rows={combinedRows} />
                    )}
                </Section>

                {/* Summary */}
                <Section title="Summary">
                    <div className="space-y-3">
                        <div className="rounded-lg border border-black/10 dark:border-white/10 p-3">
                            <div className="text-sm text-gray-600 dark:text-gray-300">Selection</div>
                            <div className="font-semibold text-gray-900 dark:text-gray-100">
                                {selectedIds.length
                                    ? portfolios.filter((p) => selectedIds.includes(p.id)).map((p) => p.name).join(", ")
                                    : "—"}
                            </div>
                        </div>

                        <div className="rounded-lg border border-black/10 dark:border-white/10 p-3">
                            <div className="text-sm text-gray-600 dark:text-gray-300">XIRR</div>
                            <div className="text-2xl font-extrabold text-gray-900 dark:text-gray-100">
                                {activeXirr == null ? "—" : `${(activeXirr * 100).toFixed(2)}%`}
                            </div>
                            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                • Enter negatives for investments (buys), positives for proceeds (sells/dividends).<br />
                                • XIRR includes a positive terminal flow equal to the summed “Current Value” of selected portfolios as of today.
                            </div>
                        </div>
                    </div>
                </Section>
            </div>
        </div>

            {/* ---------- Modals ---------- */ }

    {/* Add/Rename Portfolio */ }
    <Modal
        open={portModal.open}
        onClose={() => setPortModal({ open: false, mode: "add", portfolio: null })}
        title={portModal.mode === "add" ? "Add Portfolio" : "Rename Portfolio"}
        actions={
            <button type="submit" form="portfolio-form"
                className="px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700">
                Save
            </button>
        }
    >
        <form id="portfolio-form" onSubmit={savePortfolio} className="space-y-3">
            <label className="block">
                <span className="text-sm text-gray-600">Name</span>
                <input
                    name="name"
                    required
                    defaultValue={portModal.portfolio?.name || ""}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-gray-900"
                    placeholder="e.g., Long-term PF"
                />
            </label>
        </form>
    </Modal>

    {/* Set Current Value */ }
    <Modal
        open={valueModal.open}
        onClose={() => setValueModal({ open: false, portfolio: null, value: "" })}
        title={`Set Current Value — ${valueModal.portfolio?.name || ""}`}
        actions={
            <button type="submit" form="value-form"
                className="px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700">
                Save
            </button>
        }
    >
        <form id="value-form" onSubmit={saveValue} className="space-y-3">
            <label className="block">
                <span className="text-sm text-gray-600">Current Value (₹)</span>
                <input
                    name="value"
                    type="number"
                    required
                    defaultValue={valueModal.value}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-gray-900"
                />
            </label>
        </form>
    </Modal>

    {/* Add/Edit Cashflow */ }
    <Modal
        open={flowModal.open}
        onClose={() => setFlowModal({ open: false, mode: "add", pid: null, flow: null })}
        title={flowModal.mode === "add" ? "Add Cashflow" : "Edit Cashflow"}
        actions={
            <button type="submit" form="flow-form"
                className="px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700">
                Save
            </button>
        }
    >
        <form id="flow-form" onSubmit={saveFlow} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
                <span className="text-sm text-gray-600">Date</span>
                <input
                    name="date"
                    type="date"
                    required
                    defaultValue={flowModal.flow?.date || new Date().toISOString().slice(0, 10)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-gray-900"
                />
            </label>
            <label className="block">
                <span className="text-sm text-gray-600">Amount (₹)</span>
                <input
                    name="amount"
                    type="number"
                    step="any"
                    required
                    defaultValue={flowModal.flow?.amount ?? ""}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-gray-900"
                />
            </label>
            <label className="block sm:col-span-2">
                <span className="text-sm text-gray-600">Note</span>
                <input
                    name="note"
                    type="text"
                    defaultValue={flowModal.flow?.note ?? ""}
                    placeholder="optional"
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-gray-900"
                />
            </label>
        </form>
    </Modal>

    {/* CSV Import (single portfolio) */ }
    <Modal
        open={importModal.open}
        onClose={() => setImportModal({ open: false })}
        title="Import Cashflows (CSV)"
        actions={null}
        maxWidth="max-w-xl"
    >
        <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
                CSV columns: <code className="px-1 rounded bg-gray-100 dark:bg-white/10">Date</code>,{" "}
                <code className="px-1 rounded bg-gray-100 dark:bg-white/10">Amount</code>,{" "}
                <code className="px-1 rounded bg-gray-100 dark:bg-white/10">Note</code> (optional).<br />
                Example:<br />
                <code className="text-xs">
                    Date,Amount,Note<br />
                    2024-04-01,-15000,Buy ABC<br />
                    2024-12-20,1200,Dividend
                </code>
            </p>
            <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => e.target.files?.[0] && doImportCsv(e.target.files[0])}
                className="block w-full text-sm"
            />
        </div>
    </Modal>

    {/* Delete confirmations */ }
            <Confirm
                open={confirmDel.open && confirmDel.kind === "portfolio"}
                onClose={() => setConfirmDel({ open: false, kind: "", pid: null, cf: null, name: "" })}
                title="Delete Portfolio"
                message={`Delete portfolio "${confirmDel.name}"? (Transactions remain in database but will be orphaned)`}
                onConfirm={reallyDeletePortfolio}
            />
            <Confirm
                open={confirmDel.open && confirmDel.kind === "flow"}
                onClose={() => setConfirmDel({ open: false, kind: "", pid: null, cf: null, name: "" })}
                title="Delete Cashflow"
                message="Are you sure you want to delete this cashflow?"
                onConfirm={reallyDeleteFlow}
            />
        </div >
    );
}

/* ---------- Tables ---------- */
function CashflowTable({ rows, onEdit, onDelete }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead className="bg-gray-50 text-black">
                    <tr>
                        <th className="text-left px-3 py-2">Date</th>
                        <th className="text-right px-3 py-2">Amount (₹)</th>
                        <th className="text-left px-3 py-2">Note</th>
                        <th className="px-3 py-2"></th>
                    </tr>
                </thead>
                <tbody className="text-black">
                    {rows.map((r) => {
                        const d = r.date?.toDate ? r.date.toDate() : new Date(r.date);
                        const amt = Number(r.amount || 0);
                        return (
                            <tr key={r.id} className="border-t">
                                <td className="px-3 py-2">{d.toISOString().slice(0, 10)}</td>
                                <td className={`px-3 py-2 text-right font-semibold ${amt < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                                    {inr(amt.toFixed(0))}
                                </td>
                                <td className="px-3 py-2">{r.note || ""}</td>
                                <td className="px-3 py-2 text-right whitespace-nowrap">
                                    <button className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 mr-2"
                                        onClick={() => onEdit(r)}>Edit</button>
                                    <button className="text-xs px-2 py-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-700"
                                        onClick={() => onDelete(r)}>Delete</button>
                                </td>
                            </tr>
                        );
                    })}
                    {rows.length === 0 && (
                        <tr><td colSpan="4" className="px-3 py-6 text-center text-gray-500">No transactions yet.</td></tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

function CombinedTable({ rows }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead className="bg-gray-50 text-black">
                    <tr>
                        <th className="text-left px-3 py-2">Date</th>
                        <th className="text-left px-3 py-2">Portfolio</th>
                        <th className="text-right px-3 py-2">Amount (₹)</th>
                        <th className="text-left px-3 py-2">Note</th>
                    </tr>
                </thead>
                <tbody className="text-black">
                    {rows.map((r, idx) => {
                        const d = r.date?.toDate ? r.date.toDate() : new Date(r.date);
                        const amt = Number(r.amount || 0);
                        return (
                            <tr key={`${r.id}-${idx}`} className="border-t">
                                <td className="px-3 py-2">{d.toISOString().slice(0, 10)}</td>
                                <td className="px-3 py-2">{r._pname || r._pid}</td>
                                <td className={`px-3 py-2 text-right font-semibold ${amt < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                                    {inr(amt.toFixed(0))}
                                </td>
                                <td className="px-3 py-2">{r.note || ""}</td>
                            </tr>
                        );
                    })}
                    {rows.length === 0 && (
                        <tr><td colSpan="4" className="px-3 py-6 text-center text-gray-500">No transactions in selection.</td></tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}
