import React, { useMemo, useState } from "react";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { auth } from "../Authentication/firebase";
import { useNavigate, Link } from "react-router-dom";
import { useLocation } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEye, faEyeSlash, faEnvelope, faLock } from "@fortawesome/free-solid-svg-icons";

const provider = new GoogleAuthProvider();

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/dashboard";


  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Friendlier error messages
  const prettyError = useMemo(() => {
    if (!error) return "";
    if (error.includes("auth/invalid-email")) return "Please enter a valid email address.";
    if (error.includes("auth/user-not-found")) return "No account found with this email.";
    if (error.includes("auth/wrong-password")) return "Incorrect password. Try again.";
    if (error.includes("auth/too-many-requests")) return "Too many attempts. Please try again later.";
    if (error.includes("network-request-failed")) return "Network error. Check your connection.";
    return error;
  }, [error]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      // Optional: persist session based on "remember me"
      const { browserLocalPersistence, browserSessionPersistence, setPersistence } = await import("firebase/auth");
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);

      await signInWithEmailAndPassword(auth, email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err?.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="relative rounded-2xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-white/5 backdrop-blur shadow-xl">
          {/* Top accent */}
          <div className="absolute inset-x-0 -top-px h-[2px] bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-cyan-500 rounded-t-2xl" />
          <div className="p-6 sm:p-8">
            {/* Logo + Title */}
            <div className="flex items-center gap-3 mb-6">
              <div className="h-10 w-10 rounded-xl grid place-items-center bg-indigo-600 text-white">
                <span className="font-bold">PT</span>
              </div>
              <div>
                <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
                  Welcome Back
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Sign in to continue
                </p>
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleLogin} className="space-y-4">
              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-1.5">
                  Email
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <FontAwesomeIcon icon={faEnvelope} />
                  </span>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <FontAwesomeIcon icon={faLock} />
                  </span>
                  <input
                    id="password"
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-white"
                    aria-label={showPw ? "Hide password" : "Show password"}
                  >
                    <FontAwesomeIcon icon={showPw ? faEyeSlash : faEye} />
                  </button>
                </div>
              </div>

              {/* Row: remember + forgot */}
              <div className="flex items-center justify-between text-sm">
                <label className="inline-flex items-center gap-2 select-none cursor-pointer text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="h-4 w-4 rounded border-black/20 dark:border-white/20 text-indigo-600 focus:ring-indigo-500"
                  />
                  Remember me
                </label>
              </div>

              {/* Error / Info */}
              {prettyError && (
                <div
                  className={`text-sm text-center px-3 py-2 rounded-lg ${
                    prettyError.includes("sent")
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-rose-50 text-rose-700 border border-rose-200"
                  }`}
                >
                  {prettyError}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={busy}
                className="w-full inline-flex items-center justify-center rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold py-2.5 shadow-md transition-colors"
              >
                {busy ? (
                  <span className="inline-block animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  "Sign in"
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Tiny footer note */}
        <p className="mt-4 text-center text-xs text-slate-500">
          Secure SSL
        </p>
      </div>
    </div>
  );
};

export default Login;
