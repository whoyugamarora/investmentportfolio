import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "./Authentication/firebase";

const Home = () => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut(auth);
    alert("Logged out!");
    navigate("/login");
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <h1 className="text-3xl font-bold mb-8">Choose a Page</h1>
      <Link
        to="/dashboard"
        className="mb-4 px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Go to Dashboard
      </Link>
      <Link
        to="/research"
        className="px-6 py-2 mb-8 bg-green-600 text-white rounded hover:bg-green-700"
      >
        Go to Research
      </Link>
      <button
        onClick={handleLogout}
        className="px-6 py-2 my-2 bg-red-600 text-white rounded hover:bg-red-700"
      >
        Logout
      </button>
    </div>
  );
};

export default Home;