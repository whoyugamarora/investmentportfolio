import React, { useState, useEffect } from "react";
import { format as formatIndianNumber } from "indian-number-format";


const TodayLosers = ({ data, darkMode }) => {
    const [sortConfig, setSortConfig] = useState({ key: "daygain", direction: "asc" });
    const [topLosers, setTopLosers] = useState([]);

    const handleSort = (key) => {
        const direction = sortConfig.key === key && sortConfig.direction === "asc" ? "desc" : "asc";
        const sortedData = [...topLosers].sort((a, b) => {
            const aValue = a[key] || 0; // Default to 0 if undefined
            const bValue = b[key] || 0; // Default to 0 if undefined
            if (aValue < bValue) return direction === "asc" ? -1 : 1;
            if (aValue > bValue) return direction === "asc" ? 1 : -1;
            return 0;
        });
        setTopLosers(sortedData);
        setSortConfig({ key, direction });
    };

    useEffect(() => {
        // Process all incoming data to find the top 7 losers
        const processedData = data
            .map((item) => ({
                ...item,
                daygain: item["Day Gain"] || 0, // Ensure numeric value for sorting
                pctchangetoday: item.pctchangetoday || 0, // Ensure numeric value for sorting
            }))
            .sort((a, b) => a["Day Gain"] - b["Day Gain"]) // Sort by "daygain" in ascending order
            .slice(0, 7); // Select the top 7 losers

        setTopLosers(processedData);
    }, [data]);

    return (
        <div className="gainers-losers">
            <table className="w-full">
                <thead>
                    <tr className="border-b border-gray-200">
                        {[
                            { label: "Asset", key: "Company" },
                            { label: "Day Loss", key: "daygain" },
                            { label: "Pct Change", key: "pctchangetoday" },
                        ].map((header) => (
                            <th
                                key={header.key}
                                onClick={() => handleSort(header.key)}
                                className={`text-center pb-3 text-sm font-medium cursor-pointer ${
                                    darkMode ? "text-gray-300" : "text-gray-500"
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
                    {topLosers.map((row, index) => (
                        <tr key={index} className="border-b border-gray-100">
                            <td className="py-4 text-sm font-medium">{row.Company || "N/A"}</td>
                            <td
                                className={`py-4 px-3 text-sm font-medium text-center ${
                                    row["Day Gain"] < 0 ? "text-red-600" : "text-green-600"
                                }`}
                            >
                                ₹{(formatIndianNumber(row["Day Gain"].toFixed(0)))}
                            </td>
                            <td
                                className={`py-4 px-3 text-sm font-medium text-center ${
                                    row.pctchangetoday < 0 ? "text-red-600" : "text-green-600"
                                }`}
                            >
                                {row.pctchangetoday.toFixed(2)}%
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default TodayLosers;
