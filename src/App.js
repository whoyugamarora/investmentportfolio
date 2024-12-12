import React, { useState, useEffect } from "react";
import axios from "axios";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Grid, Paper, Typography } from "@mui/material";
import PieChart from "./PieChart";
import GoogleSheetChart from "./GoogleSheetChart";
import { Scale, scales } from "chart.js";

const COLORS = ["#4F46E5", "#10B981", "#F59E0B", "#EF4444"];

const App = () => {
  const [data, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTimeframe, setSelectedTimeframe] = useState("6M");
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });

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

  const portfolioHistory = [
    { date: "2023-01", value: 10000 },
    { date: "2023-02", value: 11200 },
    { date: "2023-03", value: 10800 },
    { date: "2023-04", value: 12500 },
    { date: "2023-05", value: 13100 },
    { date: "2023-06", value: 12800 },
  ];

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

  console.log("Spreadsheet URL:", process.env.REACT_APP_SPREADSHEET_URL);
  console.log("Google Sheet Chart URL:", process.env.REACT_APP_GOOGLESHEETCHART);


  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Portfolio Tracker</h1>

        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <div className="text-xl text-gray-600">Loading...</div>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-white p-6 rounded-xl shadow-sm">
                <h3 className="text-sm font-medium text-gray-500">Total Portfolio Value</h3>
                <p className="text-2xl font-bold text-gray-900">
                  ₹{calculateTotalValue("Current Value")}
                </p>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-sm">
                <h3 className="text-sm font-medium text-gray-500">Total Profit/Loss</h3>
                <p
                  className={`text-2xl font-bold ${calculateTotalValue("Profit/Loss") >= 0
                    ? "text-green-600"
                    : "text-red-600"
                    }`}
                >
                  ₹{calculateTotalValue("Profit/Loss")}
                </p>
              </div>
              <div className="bg-white p-6 rounded-xl shadow-sm">
                <h3 className="text-sm font-medium text-gray-500">Total Return</h3>
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
            <div className="bg-white p-6 rounded-xl shadow-sm">
              <h2 className="text-xl font-semibold text-gray-900 mb-6 sm:text-lg md:text-xl">
                Holdings
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      {[
                        { label: "Asset", key: "Company" },
                        { label: "Price", key: "Buy Price" },
                        { label: "Value", key: "Current Value" },
                        { label: "Profit/Loss", key: "Profit/Loss" },
                        { label: "P/L %", key: "PorLpercent" },
                      ].map((header) => (
                        <th
                          key={header.key}
                          onClick={() => handleSort(header.key)}
                          className="text-left pb-3 text-sm sm:text-xs md:text-sm font-medium text-gray-500 cursor-pointer"
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
                        <td className="py-4 text-xs sm:text-xs md:text-sm font-medium text-gray-900">
                          {row.Company}
                        </td>
                        <td className="py-4 px-3 text-xs sm:text-xs md:text-sm text-gray-500 text-right">
                          ₹{row["Buy Price"].toFixed(2)}
                        </td>
                        <td className="py-4 px-3 text-xs sm:text-xs md:text-sm text-gray-900 font-medium text-right">
                          ₹{row["Current Value"].toFixed(2)}
                        </td>
                        <td
                          className={`py-4 px-3 text-xs sm:text-xs md:text-sm font-medium text-right ${row["Profit/Loss"] >= 0 ? "text-green-600" : "text-red-600"
                            }`}
                        >
                          ₹{row["Profit/Loss"].toFixed(2)}
                        </td>
                        <td
                          className={`py-4 text-xs sm:text-xs md:text-sm font-medium text-right ${row["PorLpercent"] >= 0 ? "text-green-600" : "text-red-600"
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
            <br />

            {/* Combined Chart Section and Asset Allocation */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Google Sheet Chart */}
              <div className="bg-white p-6 rounded-xl shadow-sm">
                <GoogleSheetChart />
              </div>

              {/* Asset Allocation */}
              <div>
                <Grid item xs={12} lg={6}>
                  <Paper
                    elevation={4}
                    style={{
                      padding: "2rem",
                      borderRadius: "15px",
                      boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.1)",
                      textAlign: "center",
                    }}
                  >
                    <h2 className="text-xl font-semibold text-gray-900 mb-6 sm:text-lg md:text-xl text-left">
                      Portfolio Distribution
                    </h2>
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        maxHeight: "400px",
                        overflow: "hidden",
                      }}
                    >
                      <PieChart data={data} />
                    </div>
                  </Paper>
                </Grid>
              </div>
            </div>


          </>
        )}
      </div>
    </div>
  );
};

export default App;
