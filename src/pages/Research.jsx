import { faSun, faMoon, faHome, faSignOut, faChartLine, faChartSimple } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../Authentication/firebase";
import axios from "axios";
import SiteHeader from "../Components/SiteHeader";

const Research = () => {
    const [darkMode, setDarkMode] = useState(false);
    const [data, setData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });
    const navigate = useNavigate();

    const RESEARCH_URL = process.env.REACT_APP_RESEARCH_URL;

    useEffect(() => {
        const fetchData = async () => {
            try {
                const response = await axios.get(RESEARCH_URL);
                setData(response.data);
                setIsLoading(false);
            } catch (err) {
                setError("Failed to fetch research data.");
                setIsLoading(false);
            }
        };
        fetchData();
    }, [RESEARCH_URL]);

    const handleLogout = async () => {
        await signOut(auth);
        alert("Logged out!");
        navigate("/login");
    };

    // Get table headers dynamically if data exists
    const headers = data && data.length > 0 ? Object.keys(data[0]) : [];

    // Conditional formatting for cell values
    const getCellStyle = (header, value) => {
        // Only apply color scale to "Star Rating" column
        if (header.toLowerCase().includes("star") && typeof value === "number") {
            // Assuming Star Rating is between 0 and 5
            if (value >= 4) return "bg-green-300 text-green-900 font-semibold";
            if (value >= 3) return "bg-green-200 text-green-900 font-semibold";
            if (value >= 2) return "bg-yellow-200 text-yellow-900 font-semibold";
            if (value >= 1) return "bg-orange-200 text-orange-900 font-semibold";
            return "bg-red-200 text-red-900 font-bold";
        }

        if (header.toLowerCase().includes("in portfolio?") && typeof value === "string") {
            // Assuming Star Rating is between 0 and 5
            if (value === "Yes") return "bg-green-200 text-green-900 font-semibold";
            if (value === "No") return "bg-orange-200 text-orange-900 font-semibold";
        }

        if (header.toLowerCase().includes("is current price lower?") && typeof value === "string") {
            // Assuming Star Rating is between 0 and 5
            if (value === "Yes") return "bg-green-200 text-green-900 font-semibold";
            if (value === "No") return "bg-orange-200 text-orange-900 font-semibold";
        }
        // No formatting for other columns
        return "";
    };

    // Format cell value for "Current Allocation" column
    const formatCellValue = (header, value) => {
        if (header.toLowerCase().includes("current allocation") && typeof value === "number") {
            // Multiply by 100 and add % sign, show 2 decimals
            return `${(value * 100).toFixed(2)}%`;
        }
        if (typeof value === "number") {
            return value.toLocaleString("en-IN");
        }
        return value;
    };

    // Sorting logic
    const sortedData = React.useMemo(() => {
        if (!sortConfig.key) return data;
        const sorted = [...data].sort((a, b) => {
            const aValue = a[sortConfig.key];
            const bValue = b[sortConfig.key];

            // Numeric sort if both values are numbers
            if (typeof aValue === "number" && typeof bValue === "number") {
                return sortConfig.direction === "asc" ? aValue - bValue : bValue - aValue;
            }
            // String sort
            if (typeof aValue === "string" && typeof bValue === "string") {
                return sortConfig.direction === "asc"
                    ? aValue.localeCompare(bValue)
                    : bValue.localeCompare(aValue);
            }
            // Fallback
            return 0;
        });
        return sorted;
    }, [data, sortConfig]);

    const handleSort = (header) => {
        setSortConfig((prev) => {
            if (prev.key === header) {
                // Toggle direction
                return { key: header, direction: prev.direction === "asc" ? "desc" : "asc" };
            }
            return { key: header, direction: "asc" };
        });
    };

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

            <div className="max-w-7xl mx-auto py-4">

            {isLoading ? (
                <div className="flex justify-center items-center h-64">
                    <span className="text-xl font-semibold">Loading...</span>
                </div>
            ) : error ? (
                <div className="text-red-600 text-center">{error}</div>
            ) : (
                <div className="overflow-x-auto rounded-2xl shadow-lg border border-gray-200">
                    <table className={`min-w-full rounded-2xl ${darkMode ? "bg-gray-800" : "bg-white"}`}>
                        <thead className="sticky top-0 z-10">
                            <tr>
                                {headers.map((header) => (
                                    <th
                                        key={header}
                                        onClick={() => handleSort(header)}
                                        className={`px-6 py-3 text-left text-xs font-bold uppercase tracking-wider border-b cursor-pointer select-none ${darkMode ? "bg-gray-700 text-gray-200 hover:bg-gray-600" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                                    >
                                        <span className="flex items-center gap-1">
                                            {header}
                                            {sortConfig.key === header && (
                                                <span>
                                                    {sortConfig.direction === "asc" ? "▲" : "▼"}
                                                </span>
                                            )}
                                        </span>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {sortedData.map((row, idx) => (
                                <tr
                                    key={idx}
                                    className={`transition-colors duration-150 hover:bg-yellow-50 dark:hover:bg-gray-700 ${idx % 2 === 0
                                        ? darkMode ? "bg-gray-900" : "bg-white"
                                        : darkMode ? "bg-gray-800" : "bg-gray-50"
                                        }`}
                                >
                                    {headers.map((header) => (
                                        <td
                                            key={header}
                                            className={`px-6 py-4 whitespace-nowrap text-sm border-b ${getCellStyle(header, row[header])}`}
                                        >

                                            {formatCellValue(header, row[header])}
                                        </td>
                                    ))}
                                    <div className="flex items-center justify-center px-6 py-4">
                                        <a href={`https://www.tradingview.com/chart/?symbol=${row["Company Code"]}`} target="_blank" rel="noreferrer" className="px-1"><FontAwesomeIcon icon={faChartLine} /> </a>
                                        <a href={`https://www.screener.in/company//${row["Company Code"].replace("NSE:", "")}/consolidated/`} target="_blank" rel="noreferrer" className="px-1"> <FontAwesomeIcon icon={faChartSimple} className="text-green-700" /> </a>
                                    </div>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
        </div >
    );
};

export default Research;