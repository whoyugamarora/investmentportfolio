import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { Paper } from "@mui/material";
import PieChart from "./Components/PieChart";
import Heatmap from "./Components/Heatmap";
import HistoricalPerformance from "./Components/historicalperformance";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSun, faMoon, faSpinner, faChartLine, faChartSimple } from "@fortawesome/free-solid-svg-icons";
import ComparisonChart from "./Components/ComparisonChart";
import { signOut } from "firebase/auth";
import { auth } from "./Authentication/firebase";
import { useNavigate } from "react-router-dom";
import GoalSection from "./Components/GoalSection";
import DownloadPDF from "./Components/PortfolioPDF";
import { toPng } from "html-to-image";
import { format as formatIndianNumber } from "indian-number-format";
import TodayGainers from "./Components/Todaygainers";
import TodayLosers from "./Components/Todaylosers";
import PieChartSector from "./Components/PieChartSector";


const Dashboard = () => {
    const [data, setData] = useState([]);
    const [weightedPE, setWeightedPE] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });
    const [darkMode, setDarkMode] = useState(false); // State for dark mode
    const pieChartRef = useRef(null);
    const comparisonChartRef = useRef(null);
    const [chartImages, setChartImages] = useState({ pie: "", comparison: "" });
    const [totalProfitValue, setTotalProfitValue] = useState(0);
    const [totalLossValue, setTotalLossValue] = useState(0);
    const [selectedChart, setSelectedChart] = useState("Stocks"); // Default to "Stocks"

    const GOOGLE_SHEETS_URL = process.env.REACT_APP_SPREADSHEET_URL;
    const navigate = useNavigate(); // Initialize useNavigate


    useEffect(() => {
        const fetchData = async () => {
            try {
                const response = await axios.get(GOOGLE_SHEETS_URL);
                const cleanedData = response.data.map((item) => ({
                    ...item,
                    "Current Value": Number(item["Current Value"] || 0),
                    "Profit/Loss": Number(item["Profit/Loss"] || 0),
                    "Buy Value": Number(item["Buy Value"] || 0),
                    "Quantity": Number(item["Quantity"] || 0),
                    "PE": Number(item["PE"] || 0),
                    "PorLpercent": !isNaN(Number(item["PorLpercent"])) ? Number(item["PorLpercent"]) : 0, // Default invalid values to 0
                    "Day Gain": !isNaN(Number(item["Day Gain"])) ? Number(item["Day Gain"]) : 0, // Ensure valid numbers
                    // Ensure all other numeric fields are converted
                }));
                setData(cleanedData);
                calculateWeightedPE(cleanedData);
                calculatetotalprofit(cleanedData);
                calculatetotalloss(cleanedData);
                setIsLoading(false);
            } catch (error) {
                console.error("Error fetching data:", error);
                setIsLoading(false);
            }
        };

        fetchData();
    }, [GOOGLE_SHEETS_URL]);

    const calculateWeightedPE = (data) => {
        let totalWeightedPE = 0;
        let totalValue = 0;

        data.forEach((stock) => {
            const stockValue = stock["Current Value"]; // Current Value of the stock
            const stockPE = stock["PE"]; // Price/Earnings ratio
            if (stockValue && stockPE) {
                totalWeightedPE += stockPE * stockValue;
                totalValue += stockValue;
            }
        });

        // Calculate Weighted Average P/E
        const weightedPE = totalValue !== 0 ? totalWeightedPE / totalValue : 0;
        setWeightedPE(weightedPE.toFixed(2)); // Round to 2 decimal places
    };

    const calculatetotalprofit = (data) => {
        let totalValue = 0;
        data.forEach((stock) => {
            const stockProfit = Number(stock["Profit/Loss"] || 0);
            if (stockProfit >= 0) {
                totalValue += stockProfit;
            }
        });
        setTotalProfitValue(totalValue.toFixed(0));
    };

    const calculatetotalloss = (data) => {
        let totalValue = 0;
        data.forEach((stock) => {
            const stockLoss = stock["Profit/Loss"];
            if (stockLoss <= 0) {
                totalValue += stockLoss;
            }
        });
        setTotalLossValue((totalValue * -1).toFixed(0));
    };

    const calculateTotalValue = (key) => {
        return data.reduce((sum, item) => sum + Number(item[key] || 0), 0).toFixed(0);
    };


    const calculateProfitPercentage = () => {
        const totalProfit = parseFloat(calculateTotalValue("Profit/Loss"));
        const totalCurrentValue = parseFloat(calculateTotalValue("Buy Value"));
        if (totalCurrentValue === 0) return 0; // Prevent division by zero
        return ((totalProfit / totalCurrentValue) * 100).toFixed(2);
    };

    const generateChartImages = async () => {
        try {
            const pieImage = await toPng(pieChartRef.current, { cacheBust: true });
            const comparisonImage = await toPng(comparisonChartRef.current, {
                cacheBust: true,
            });
            setChartImages({ pie: pieImage, comparison: comparisonImage });
        } catch (error) {
            console.error("Error generating chart images:", error);
        }
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

    const handleLogout = async () => {
        await signOut(auth);
        alert("Logged out!");
        navigate("/login");
    };

    const comfortableCompanies = data.filter((company) => company.Valuation === "Comfortable");
    const uncomfortableCompanies = data.filter((company) => company.Valuation === "Uncomfortable");


    return (
        <div
            className={`min-h-screen ${darkMode ? "bg-gray-900 text-gray-100" : "bg-gray-50 text-gray-900"
                } p-2 md:p-4 lg:p-8`}
        >
            <div className="max-w-7xl mx-auto">
                {/* Header with Toggle */}
                <div className="flex justify-between items-center gap-1 mb-6 w-full">
                    <h1 className="text-2xl lg:text-3xl font-bold">Portfolio Tracker</h1>
                    <div className="w-30 lg:w-40 flex items-center justify-center gap-8">
                        <button
                            onClick={() => setDarkMode(!darkMode)}
                            className="text-xl focus:outline-none"
                        >
                            <FontAwesomeIcon icon={darkMode ? faSun : faMoon} size="lg" color={darkMode ? "yellow" : "orange"} />
                        </button>
                        <button className=" px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg shadow-md hover:bg-indigo-700 transition-all duration-200" onClick={handleLogout}>Logout</button>
                    </div>
                </div>

                {isLoading ? (
                    <div className="flex justify-center items-center h-64">
                        <div className="text-2xl font-bold"><FontAwesomeIcon icon={faSpinner} className="fa-spin" /></div>
                    </div>
                ) : (
                    <>
                        {/* Summary Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6 mb-8 text-center">
                            <div
                                className={`p-6 rounded-xl shadow-sm ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"
                                    }`}
                            >
                                <h3 className="text-sm font-medium">Total Portfolio Value</h3>
                                <p className="text-2xl font-bold">
                                    ₹{(formatIndianNumber(calculateTotalValue("Current Value")))}
                                </p>
                            </div>

                            <div
                                className={`p-6 rounded-xl shadow-sm ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"
                                    }`}
                            >
                                <h3 className="text-sm font-medium">Total Invested</h3>
                                <p
                                    className={`text-2xl font-bold`}
                                >
                                    ₹{(formatIndianNumber(calculateTotalValue("Buy Value")))}
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
                                    ₹{(formatIndianNumber(calculateTotalValue("Profit/Loss")))}
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

                            <div
                                className={`p-6 rounded-xl shadow-sm ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"
                                    }`}
                            >
                                <h3 className="text-sm font-medium">Today's Return</h3>
                                <p
                                    className={`text-2xl font-bold ${calculateTotalValue("Day Gain") >= 0
                                        ? "text-green-600"
                                        : "text-red-600"
                                        }`}
                                >
                                    {(formatIndianNumber(calculateTotalValue("Day Gain")))}
                                </p>
                            </div>

                            <div
                                className={`p-6 rounded-xl shadow-sm ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"
                                    }`}
                            >
                                <h3 className="text-sm font-medium">Today's Return %</h3>
                                <p
                                    className={`text-2xl font-bold ${calculateTotalValue("Day Gain") >= 0
                                        ? "text-green-600"
                                        : "text-red-600"
                                        }`}
                                >
                                    {(calculateTotalValue("Day Gain") / calculateTotalValue("Current Value") * 100).toFixed(2)}%
                                </p>
                            </div>

                            <div
                                className={`p-6 rounded-xl shadow-sm ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"
                                    }`}
                            >
                                <h3 className="text-sm font-medium">Weighted P/E</h3>
                                <p
                                    className={`text-2xl font-bold ${weightedPE >= 0 && weightedPE <= 50
                                        ? "text-green-600"
                                        : "text-red-600"}`}
                                >
                                    {weightedPE}
                                </p>
                            </div>
                            <div
                                className={`p-6 rounded-xl shadow-sm ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"
                                    }`}
                            >
                                <p
                                    onClick={generateChartImages}
                                    className={` font-bold ${weightedPE >= 0 && weightedPE <= 50
                                        ? "text-green-600"
                                        : "text-red-600"}`}
                                >
                                    <DownloadPDF data={data} chartImages={chartImages} />

                                </p>
                            </div>
                        </div>

                        <div className="my-6">
                            {/* Progress Bar Container */}
                            <div className="w-full bg-gray-200 rounded-full h-9 flex overflow-hidden">
                                {/* Green Bar for Profit */}
                                {totalProfitValue > 0 && (
                                    <div
                                        className={`h-full bg-green-500 flex items-center justify-center font-bold text-gray-100`}
                                        style={{
                                            width: `${(Number(totalProfitValue) / (Number(totalProfitValue) + Number(totalLossValue))) * 100}%`,
                                            transition: "width 0.3s ease",
                                        }}
                                    >{((Number(totalProfitValue) / (Number(totalProfitValue) + Number(totalLossValue))) * 100).toFixed(1)}%</div>
                                )}
                                {/* Red Bar for Loss */}
                                {totalLossValue > 0 && (
                                    <div
                                        className="h-full bg-red-500 flex items-center justify-center font-bold text-gray-100"
                                        style={{
                                            width: `${(Number(totalLossValue) / (Number(totalProfitValue) + Number(totalLossValue))) * 100}%`,
                                            transition: "width 0.3s ease",
                                        }}
                                    >{((Number(totalLossValue) / (Number(totalProfitValue) + Number(totalLossValue))) * 100).toFixed(1)}%</div>
                                )}
                            </div>
                        </div>


                        {/* Holdings Table */}
                        <div
                            className={`py-6 px-4 rounded-xl shadow-sm ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"
                                }`}
                        >
                            <h2 className="text-xl font-semibold mb-6 sm:text-lg md:text-2xl">
                                Holdings
                            </h2>
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-gray-200">
                                            {[
                                                { label: "Asset", key: "Company" },
                                                { label: "Quantity", key: "Quantity" },
                                                { label: "Buy Price", key: "Buy Price" },
                                                { label: "Current Price", key: "Current Price" },
                                                { label: "Buy Value", key: "Buy Value" },
                                                { label: "Current Value", key: "Current Value" },
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
                                            <tr key={index} className={` ${index % 2 === 0 ? darkMode ? "bg-gray-800" : "bg-white" : darkMode ? "bg-gray-900" : "bg-gray-50"}`}>
                                                <td className="py-4 text-sm font-medium">
                                                    <a href={`https://www.tradingview.com/chart/?symbol=${row["Company Code"]}`} target="_blank" rel="noreferrer" className="px-1"><FontAwesomeIcon icon={faChartLine} /> </a>
                                                    <a href={`https://www.screener.in/company//${row["Company Code"].replace("NSE:", "")}/consolidated/`} target="_blank" rel="noreferrer" className="px-1"> <FontAwesomeIcon icon={faChartSimple} className="text-green-700" /> </a>
                                                    {row.Company}</td>
                                                <td className="py-4 px-3 text-sm text-center">
                                                    {row["Quantity"]}
                                                </td>
                                                <td className="py-4 px-3 text-sm text-center">
                                                    ₹{Number(row["Buy Price"] || 0).toFixed(2)}
                                                </td>
                                                <td className="py-4 px-3 text-sm text-center">
                                                    ₹{Number(row["Current Price"] || 0).toFixed(2)}
                                                </td>
                                                <td className="py-4 px-3 text-sm font-medium text-center">
                                                    ₹{(formatIndianNumber(row["Buy Value"].toFixed(0)))}
                                                </td>
                                                <td className="py-4 px-3 text-sm font-medium text-center">
                                                    ₹{(formatIndianNumber(row["Current Value"].toFixed(0)))}
                                                </td>
                                                <td
                                                    className={`py-4 px-3 text-sm font-medium text-center ${row["Profit/Loss"] >= 0
                                                        ? "text-green-600"
                                                        : "text-red-600"
                                                        }`}
                                                >
                                                    ₹{(formatIndianNumber(row["Profit/Loss"].toFixed(0)))}
                                                </td>
                                                <td
                                                    className={`py-4 text-sm font-medium text-center ${Number(row["PorLpercent"]) >= 0
                                                        ? "text-green-600"
                                                        : "text-red-600"
                                                        }`}
                                                >
                                                    {Number(row.PorLpercent || 0).toFixed(2)}%
                                                </td>

                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Combined Chart Section and Asset Allocation */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 my-4">
                            <div
                                ref={comparisonChartRef}
                                className={`p-6 rounded-xl shadow-md ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"
                                    }`}
                            >
                                <h2
                                    className={`text-2xl font-semibold pb-6 text-left ${darkMode ? "text-gray-100" : "text-gray-900"
                                        }`}
                                >
                                    Portfolio vs CNX 500 (Normalized) - 3 Months
                                </h2>
                                <ComparisonChart />
                            </div>

                            {/* Asset Allocation */}
                            <div
                                className={`rounded-xl shadow-md ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"}`}
                            >
                                <Paper
                                    elevation={5}
                                    ref={pieChartRef}
                                    style={{
                                        padding: "1rem",
                                        borderRadius: "15px",
                                        boxShadow: "0px 0px 1px rgba(0, 0, 0, 0.1)",
                                        textAlign: "center",
                                        backgroundColor: darkMode ? "#1F2937" : "#FFFFFF", // Dynamically set background color
                                    }}
                                >
                                    <div className="flex justify-between items-center">
                                        <h2
                                            className={`text-2xl p-2 font-semibold self-center text-left ${darkMode ? "text-gray-100" : "text-gray-900"
                                                }`}
                                        >
                                            Portfolio Distribution
                                        </h2>
                                        <div className="flex justify-end gap-3 flex-grow">
                                            <button className={`py-2 px-3 md:px-6 shadow-lg rounded-md ${selectedChart === "Stocks" ? "bg-indigo-500 text-white" : "bg-gray-50"
                                                }`} onClick={() => setSelectedChart("Stocks")}>Stocks</button>
                                            <button className={`py-2 px-3 md:px-6 shadow-lg rounded-md ${selectedChart === "Sector" ? "bg-indigo-500 text-white" : "bg-gray-50"
                                                }`} onClick={() => setSelectedChart("Sector")}>Sector</button>
                                        </div>
                                    </div>
                                    <div
                                        style={{
                                            width: "100%",
                                            height: "100%",
                                            maxHeight: "600px",
                                            overflow: "hidden",
                                            backgroundColor: darkMode ? "#1F2937" : "#FFFFFF", // Match chart container to dark mode
                                            borderRadius: "10px",
                                        }}
                                    >
                                        {selectedChart === "Stocks" ? (
                                            <PieChart data={data} darkMode={darkMode} />
                                        ) : (
                                            <PieChartSector data={data} darkMode={darkMode} />
                                        )}
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

                        {/* Today Gainers */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 my-4">
                            <div
                                className={`p-6 rounded-xl shadow-md ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"
                                    }`}
                            >
                                <h2
                                    className={`text-2xl font-semibold pb-6 text-left ${darkMode ? "text-gray-100" : "text-gray-900"
                                        }`}
                                >
                                    Today's Gainers
                                </h2>
                                <TodayGainers data={data} darkMode={darkMode} />
                            </div>

                            {/* Today Losers */}
                            <div
                                className={`p-6 rounded-xl shadow-md ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"}`}
                            >
                                <h2
                                    className={`text-2xl pb-6 font-semibold text-left ${darkMode ? "text-gray-100" : "text-gray-900"
                                        }`}
                                >
                                    Today's Losers
                                </h2>
                                < TodayLosers data={data} darkMode={darkMode} />
                            </div>
                        </div>

                        <div className={`max-w-7xl mx-auto shadow-lg p-6 rounded-xl ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"}`}>
                            <h1 className="text-3xl font-bold mb-8">Company Valuation</h1>

                            {isLoading ? (
                                <div className="text-center text-xl">Loading data...</div>
                            ) : (
                                <div className="grid grid-cols-2 gap-8">
                                    {/* Comfortable Column */}
                                    <div className={`p-4 rounded-md shadow-md ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"}`}>
                                        <h2 className="text-xl font-bold mb-6">Comfortable</h2>
                                        {comfortableCompanies.length > 0 ? (
                                            <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {comfortableCompanies.map((company, index) => (
                                                    <li key={index} className={`py-2 px-4 ${darkMode ? "bg-green-700" : "bg-green-100"} rounded-md text-center font-medium`}>
                                                        {company.Company}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p>No companies in this category.</p>
                                        )}
                                    </div>

                                    {/* Uncomfortable Column */}
                                    <div className={`p-4 rounded-md shadow-md ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"}`}>
                                        <h2 className="text-xl font-bold mb-6">Uncomfortable</h2>
                                        {uncomfortableCompanies.length > 0 ? (
                                            <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {uncomfortableCompanies.map((company, index) => (
                                                    <li key={index} className={`py-2 px-4 ${darkMode ? "bg-red-700" : "bg-red-100"} rounded-md text-center font-medium`}>
                                                        {company.Company}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p>No companies in this category.</p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className={`p-6 rounded-xl shadow-lg my-4 ${darkMode ? "bg-gray-800 text-gray-100" : "bg-white"
                            }`}>
                            <h1 className="text-3xl font-bold mb-8">Goal Tracker</h1>

                            <GoalSection currentPortfolioValue={calculateTotalValue("Current Value")} darkMode={darkMode} />
                        </div>

                    </>
                )}
            </div>
        </div>
    );
};

export default Dashboard;
