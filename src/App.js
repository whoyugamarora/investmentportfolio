import React, { useEffect, useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./Authentication/firebase";
import Dashboard from "./Dashboard";
import Home from "./Home";
import Research from "./Research";
import Login from "./Authentication/Login";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner } from "@fortawesome/free-solid-svg-icons";

const App = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false); // Stop showing loader once auth state is resolved
    });

    return () => unsubscribe(); // Cleanup subscription
  }, []);

  if (loading) {
    // Show a loader while determining the auth state
    return <div className="flex justify-center items-center h-screen"><FontAwesomeIcon icon={faSpinner} className="fa-spin"/></div>;
  }

  return (
    <Router>
      <Routes>
        <Route
          path="/dashboard"
          element={user ? <Dashboard /> : <Navigate to="/login" />}
        />
        <Route
          path="/research"
          element={user ? <Research /> : <Navigate to="/login" />}
        />
        <Route
          path="/login"
          element={!user ? <Login /> : <Navigate to="/home" />}
        />
        {/* Home page for choosing Dashboard or Research */}
        <Route
          path="/home"
          element={user ? <Home /> : <Navigate to="/login" />}
        />
        {/* Redirect root to home or login based on auth */}
        <Route
          path="/"
          element={user ? <Navigate to="/home" /> : <Navigate to="/login" />}
        />
      </Routes>
    </Router>
  );
};

export default App;
