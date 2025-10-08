// src/components/SiteHeader.jsx
import React, { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faSun, faMoon, faHome, faSignOut, faFlask, faBars, faXmark,
    faArrowTrendUp,
    faBullseye,
    faShare,
    faNewspaper,
} from "@fortawesome/free-solid-svg-icons";

export default function SiteHeader({
    title = "Portfolio Tracker",
    darkMode,
    onToggleDarkMode,
    onLogout,
}) {
    const [open, setOpen] = useState(false);
    const panelRef = useRef(null);
    const toggleRef = useRef(null); // NEW: ref to the hamburger/X button

    // Close on outside click (but ignore clicks on the toggle button)
    useEffect(() => {
        const onDocMouseDown = (e) => {
            if (!open) return;
            const panel = panelRef.current;
            const toggle = toggleRef.current;
            const target = e.target;
            if (panel && panel.contains(target)) return; // clicked inside panel
            if (toggle && toggle.contains(target)) return; // clicked the toggle btn
            setOpen(false);
        };
        document.addEventListener("mousedown", onDocMouseDown);
        return () => document.removeEventListener("mousedown", onDocMouseDown);
    }, [open]);

    // Close on ESC
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, []);

    const navLinkBase = "px-3 py-2 rounded-lg text-sm font-medium transition-colors";
    const active = "bg-indigo-600 text-white hover:bg-indigo-700";
    const inactive = darkMode ? "text-gray-300 hover:bg-white/10" : "text-gray-700 hover:bg-gray-100";

    return (
        <header
            className={`sticky top-0 z-40 mb-4 border-b ${darkMode ? "border-white/10 bg-gray-900/80" : "border-black/10 bg-white/80"
                } backdrop-blur`}
            role="banner"
        >
            <div className="mx-auto max-w-7xl px-3 sm:px-4 lg:px-8">
                <div className="h-16 flex items-center justify-between">
                    {/* Left: Brand */}
                    <Link to="/dashboard" className="flex items-center gap-2 group">
                        <div className={`h-9 w-9 rounded-xl grid place-items-center shadow-sm ${darkMode ? "bg-white/10" : "bg-gray-100"}`}>
                            <div className={`h-2.5 w-2.5 rounded-full ${darkMode ? "bg-indigo-400" : "bg-indigo-600"}`} />
                        </div>
                        <div className="leading-tight">
                            <div className="text-lg sm:text-xl font-extrabold">{title}</div>
                            <div className={`text-[11px] uppercase tracking-wide ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                                Insights • Research • Tracking
                            </div>
                        </div>
                    </Link>

                    {/* Center: Desktop Nav */}
                    <nav className="hidden md:flex items-center gap-2">
                        <NavLink to="/dashboard" className={({ isActive }) => `${navLinkBase} ${isActive ? active : inactive}`}>
                            <FontAwesomeIcon icon={faHome} className="mr-2" />
                            Dashboard
                        </NavLink>
                        <NavLink to="/research" className={({ isActive }) => `${navLinkBase} ${isActive ? active : inactive}`}>
                            <FontAwesomeIcon icon={faFlask} className="mr-2" />
                            Research
                        </NavLink>
                        <NavLink to="/xirr" className={({ isActive }) => `${navLinkBase} ${isActive ? active : inactive}`}>
                            <FontAwesomeIcon icon={faArrowTrendUp} className="mr-2" />
                            XIRR
                        </NavLink>
                        <NavLink to="/goals" className={({ isActive }) => `${navLinkBase} ${isActive ? active : inactive}`}>
                            <FontAwesomeIcon icon={faBullseye} className="mr-2" />
                            Goals
                        </NavLink>
                        <NavLink to="/news" className={({ isActive }) => `${navLinkBase} ${isActive ? active : inactive}`}>
                            <FontAwesomeIcon icon={faNewspaper} className="mr-2" />
                            News
                        </NavLink>
                    </nav>

                    {/* Right: Actions */}
                    <div className="hidden md:flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onToggleDarkMode}
                            className={`px-3 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors ${darkMode ? "bg-yellow-500 hover:bg-yellow-600 text-white" : "bg-gray-900 hover:bg-black text-white"
                                }`}
                            aria-label="Toggle dark mode"
                            title="Toggle theme"
                        >
                            <FontAwesomeIcon icon={darkMode ? faSun : faMoon} />
                        </button>

                        <NavLink to="/share" className={({ isActive }) => `${navLinkBase} ${isActive ? active : inactive}`}>
                            <FontAwesomeIcon icon={faShare} className="" />
                        </NavLink>

                        <button
                            type="button"
                            onClick={onLogout}
                            className="px-3 py-2 rounded-lg text-sm font-medium shadow-sm bg-red-600 hover:bg-indigo-700 text-white"
                            aria-label="Sign out"
                            title="Sign out"
                        >
                            <FontAwesomeIcon icon={faSignOut} className="" />
                        </button>
                    </div>

                    {/* Mobile: Hamburger / X */}
                    <button
                        ref={toggleRef}
                        type="button"
                        onClick={() => setOpen((v) => !v)}
                        className={`md:hidden inline-flex items-center justify-center h-10 w-10 rounded-lg border transition-colors ${darkMode ? "border-white/15 text-gray-200 hover:bg-white/10" : "border-black/10 text-gray-800 hover:bg-gray-100"
                            }`}
                        aria-label={open ? "Close menu" : "Open menu"}
                        aria-expanded={open ? "true" : "false"}
                        aria-controls="mobile-nav"
                    >
                        <FontAwesomeIcon icon={open ? faXmark : faBars} />
                    </button>
                </div>
            </div>

            {/* Mobile Menu */}
            <div
                id="mobile-nav"
                ref={panelRef}
                className={`md:hidden transition-[max-height,opacity] duration-200 overflow-hidden ${open ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                    }`}
            >
                <div className="mx-auto max-w-7xl px-3 sm:px-4 lg:px-8 pb-3">
                    <nav
                        className={`rounded-xl p-2 border ${darkMode ? "bg-gray-900/90 border-white/10" : "bg-white/90 border-black/10"
                            }`}
                    >
                        <MobileItem to="/dashboard" icon={faHome} darkMode={darkMode} onClick={() => setOpen(false)}>
                            Dashboard
                        </MobileItem>
                        <MobileItem to="/research" icon={faFlask} darkMode={darkMode} onClick={() => setOpen(false)}>
                            Research
                        </MobileItem>
                        <MobileItem to="/xirr" icon={faArrowTrendUp} darkMode={darkMode} onClick={() => setOpen(false)}>
                            XIRR
                        </MobileItem>
                        <MobileItem to="/goals" icon={faBullseye} darkMode={darkMode} onClick={() => setOpen(false)}>
                            Goals
                        </MobileItem>
                        <MobileItem to="/news" icon={faNewspaper} darkMode={darkMode} onClick={() => setOpen(false)}>
                            News
                        </MobileItem>

                        <div className="mt-2 grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={onToggleDarkMode}
                                className={`w-full px-3 py-2 rounded-lg text-sm font-medium shadow-sm ${darkMode ? "bg-yellow-500 hover:bg-yellow-600 text-white" : "bg-gray-900 hover:bg-black text-white"
                                    }`}
                            >
                                <FontAwesomeIcon icon={darkMode ? faSun : faMoon} className="mr-2" />
                                Theme
                            </button>

                            <MobileItem to="/share" icon={faShare} darkMode={darkMode}  onClick={() => setOpen(false)}>
                                Share
                            </MobileItem>

                            <button
                                type="button"
                                onClick={onLogout}
                                className="w-full px-3 py-2 rounded-lg text-sm font-medium shadow-sm bg-red-600 hover:bg-red-700 text-white"
                            >
                                <FontAwesomeIcon icon={faSignOut} className="mr-2" />
                                Sign out
                            </button>
                        </div>
                    </nav>
                </div>
            </div>
        </header>
    );
}

function MobileItem({ to, icon, children, darkMode, onClick }) {
    const base = "flex  items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium";
    const rest = darkMode ? "text-gray-200 hover:bg-white/10" : "text-gray-800 hover:bg-gray-100";
    return (
        <NavLink
            to={to}
            onClick={onClick}
            className={({ isActive }) =>
                `${base} ${rest} ${isActive ? "bg-indigo-200 text-white hover:bg-indigo-700" : ""}`
            }
        >
            <FontAwesomeIcon icon={icon} />
            {children}
        </NavLink>
    );
}
