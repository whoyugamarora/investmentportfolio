// App.jsx
import React, { useEffect, useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./Authentication/firebase";
import Dashboard from "./pages/Dashboard";
import Research from "./pages/Research";
import Login from "./Authentication/Login";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner } from "@fortawesome/free-solid-svg-icons";
import XirrPage from "./pages/XirrPage";
import GoalProjections from "./pages/GoalProjections";
import ShareManager from "./pages/ShareManager";
import PublicShare from "./pages/PublicShare";
import HoldingDetail from "./pages/HoldingDetail";
import NewsPage from "./pages/NewsPage";
import WhatIf from "./pages/WhatIf";
import CompanyNotes from "./pages/CompanyNotes";
import InsightsPage from "./pages/Insights";

function RequireAuth({ user, children }) {
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

const App = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <FontAwesomeIcon icon={faSpinner} className="fa-spin" />
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        <Route
          path="/dashboard"
          element={
            <RequireAuth user={user}>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/research"
          element={
            <RequireAuth user={user}>
              <Research />
            </RequireAuth>
          }
        />
        <Route
          path="/xirr"
          element={
            <RequireAuth user={user}>
              <XirrPage />
            </RequireAuth>
          }
        />
        <Route
          path="/goals"
          element={
            <RequireAuth user={user}>
              <GoalProjections />
            </RequireAuth>
          }
        />
        <Route
          path="/insights"
          element={
            <RequireAuth user={user}>
              <InsightsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/holding/:symbol"
          element={
            <RequireAuth user={user}>
              <HoldingDetail pid="default" />
            </RequireAuth>
          } />
        <Route
          path="/news"
          element={
            <RequireAuth user={user}>
              <NewsPage pid="default" />
            </RequireAuth>
          } />
        <Route
          path="/whatif"
          element={
            <RequireAuth user={user}>
              <WhatIf />
            </RequireAuth>
          } />

        <Route path="/share" element={<ShareManager />} />
        <Route path="/s/:id" element={<PublicShare />} />

        <Route path="/notes" element={<CompanyNotes />} />
        <Route path="/notes/:code" element={<CompanyNotes />} />

        <Route
          path="/login"
          element={!user ? <Login /> : <Navigate to="/dashboard" replace />}
        />
        <Route
          path="/"
          element={user ? <Navigate to="/dashboard" replace /> : <Navigate to="/login" replace />}
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Router>
  );
};

export default App;
