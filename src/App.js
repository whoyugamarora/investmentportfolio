import React, { useState, useEffect } from "react";
import axios from "axios";
import { Paper } from "@mui/material";
import PieChart from "./PieChart";
import GoogleSheetChart from "./GoogleSheetChart";
import Heatmap from "./Heatmap";
import HistoricalPerformance from "./historicalperformance";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSun, faMoon } from "@fortawesome/free-solid-svg-icons";

const App = () => {
  const [data, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });
  const [darkMode, setDarkMode] = useState(false); // State for dark mode

  const GOOGLE_SHEETS_URL = process.env.REACT_APP_SPREADSHEET_URL;

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await axios.get(GOOGLE_SHEETS_URL);
        setData(response.data);
        setIsLoading(false);
      } catch (error) {
        console.error("Error fetching data:", error);
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  const calculateTotalValue = (key) => {
    return data.reduce((sum, item) => sum + item[key], 0).toFixed(2);
  };

  const calculateProfitPercentage = () => {
    const totalProfit = parseFloat(calculateTotalValue("Profit/Loss"));
    const totalCurrentValue = parseFloat(calculateTotalValue("Current Value"));
    if (totalCurrentValue === 0) return 0; // Prevent division by zero
    return ((totalProfit / totalCurrentValue) * 100).toFixed(2);
  };

  const handleSort = (key) => {
    const direction =
      sortConfig.key === key && sortConfig.direction === "asc" ? "desc" : "asc";
    const sortedData = [...data].sort((a, b) => {
      if (a[key] < b[key]) return direction === "asc" ? -1 : 1;
      if (a[key] > b[key]) return direction === "asc" ? 1 : -1;
      return 0;
    });
    setData(sortedData);
    setSortConfig({ key, direction });
  };

  return (
    <div
      className={`min-h-screen ${darkMode ? "bg-gray-900 text-gray-100" : "bg-gray-50 text-gray-900"
        } p-8`}
    >
      <div className="max-w-7xl mx-auto">
        {/* Header with Toggle */}
        <div className="flex justify-between items-center w-full">
          <h1 className="text-3xl font-bold mb-8">Portfolio Tracker</h1>
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="text-xl focus:outline-none mb-8"
          >
            <FontAwesomeIcon icon={darkMode ? faSun : faMoon} size="lg" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <div className="text-2xl font-bold">Loading...</div>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div
                className={`p-6 rounded-xl shadow-sm ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"
                  }`}
              >
                <h3 className="text-sm font-medium">Total Portfolio Value</h3>
                <p className="text-2xl font-bold">
                  ₹{calculateTotalValue("Current Value")}
                </p>
              </div>
              <div
                className={`p-6 rounded-xl shadow-sm ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"
                  }`}
              >
                <h3 className="text-sm font-medium">Total Profit/Loss</h3>
                <p
                  className={`text-2xl font-bold ${calculateTotalValue("Profit/Loss") >= 0
                    ? "text-green-600"
                    : "text-red-600"
                    }`}
                >
                  ₹{calculateTotalValue("Profit/Loss")}
                </p>
              </div>
              <div
                className={`p-6 rounded-xl shadow-sm ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"
                  }`}
              >
                <h3 className="text-sm font-medium">Total Return</h3>
                <p
                  className={`text-2xl font-bold ${calculateProfitPercentage() >= 0
                    ? "text-green-600"
                    : "text-red-600"
                    }`}
                >
                  {calculateProfitPercentage()}%
                </p>
              </div>
            </div>

            {/* Holdings Table */}
            <div
              className={`p-6 rounded-xl shadow-sm ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"
                }`}
            >
              <h2 className="text-xl font-semibold mb-6 sm:text-lg md:text-xl">
                Holdings
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      {[
                        { label: "Asset", key: "Company" },
                        { label: "Quantity", key: "Quantity" },
                        { label: "Price", key: "Buy Price" },
                        { label: "Value", key: "Current Value" },
                        { label: "Profit/Loss", key: "Profit/Loss" },
                        { label: "P/L %", key: "PorLpercent" },
                      ].map((header) => (
                        <th
                          key={header.key}
                          onClick={() => handleSort(header.key)}
                          className={`text-center pb-3 text-sm font-medium cursor-pointer ${darkMode ? "text-gray-300" : "text-gray-500"
                            }`}
                        >
                          {header.label}
                          {sortConfig.key === header.key &&
                            (sortConfig.direction === "asc" ? " ▲" : " ▼")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row, index) => (
                      <tr key={index} className="border-b border-gray-100">
                        <td className="py-4 text-sm font-medium">{row.Company}</td>
                        <td className="py-4 px-3 text-sm text-center">
                          {row["Quantity"]}
                        </td>
                        <td className="py-4 px-3 text-sm text-center">
                          ₹{row["Buy Price"].toFixed(2)}
                        </td>
                        <td className="py-4 px-3 text-sm font-medium text-center">
                          ₹{row["Current Value"].toFixed(2)}
                        </td>
                        <td
                          className={`py-4 px-3 text-sm font-medium text-center ${row["Profit/Loss"] >= 0
                            ? "text-green-600"
                            : "text-red-600"
                            }`}
                        >
                          ₹{row["Profit/Loss"].toFixed(2)}
                        </td>
                        <td
                          className={`py-4 text-sm font-medium text-center ${row["PorLpercent"] >= 0
                            ? "text-green-600"
                            : "text-red-600"
                            }`}
                        >
                          {row["PorLpercent"].toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Combined Chart Section and Asset Allocation */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 my-4">
              {/* Google Sheet Chart */}
              <div
                className={`p-6 rounded-xl shadow-md ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"
                  }`}
              >
                <GoogleSheetChart />
              </div>

              {/* Asset Allocation */}
              <div
                className={`rounded-xl shadow-md ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"}`}
              >
                <Paper
                  elevation={4}
                  style={{
                    padding: "1rem",
                    borderRadius: "15px",
                    boxShadow: darkMode
                      ? "0px 4px 12px rgba(255, 255, 255, 0.2)"
                      : "0px 4px 12px rgba(0, 0, 0, 0.1)",
                    textAlign: "center",
                    backgroundColor: darkMode ? "#1F2937" : "#FFFFFF", // Dynamically set background color
                  }}
                >
                  <h2
                    className={`text-xl font-semibold pb-6 text-left ${darkMode ? "text-gray-100" : "text-gray-900"
                      }`}
                  >
                    Portfolio Distribution
                  </h2>
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      maxHeight: "400px",
                      overflow: "hidden",
                      backgroundColor: darkMode ? "#1F2937" : "#FFFFFF", // Match chart container to dark mode
                      borderRadius: "10px",
                    }}
                  >
                    <PieChart data={data} darkMode={darkMode} />
                  </div>
                </Paper>
              </div>
            </div>

            {/* Additional Components */}
            <div
              className={`p-6 rounded-xl shadow-lg my-4 ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"
                }`}
            >
              <h1 className="text-3xl font-bold mb-8">Profit/Loss Heatmap</h1>
              <Heatmap data={data} />
            </div>

            <div
              className={`p-6 rounded-xl shadow-lg my-4 ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"
                }`}
            >
              <h1 className="text-3xl font-bold mb-8">
                Weekly Historical Performance
              </h1>
              <HistoricalPerformance />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default App;
