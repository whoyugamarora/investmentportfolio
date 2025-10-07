import React, { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import axios from "axios";
import { format as formatIndianNumber } from "indian-number-format";


const HISTORICAL_PERFORMANCE_URL = process.env.REACT_APP_HISTORICAL_PERFORMANCE_URL;

const HistoricalPerformance = () => {
  const [data, setData] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await axios.get(HISTORICAL_PERFORMANCE_URL);

        // Filter the data to include only every 5th entry
        const filteredData = response.data.filter((_, index) => index % 5 === 0);

        setData(filteredData);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };

    fetchData();
  }, []);

  if (data.length === 0) return null; // Handle case when no data is available

  // Calculate yMin and yMax with better padding logic
  const values = data.map((d) => d["Value"]); // Extract 'Value' from the data
  const rawYMin = Math.min(...values);
  const rawYMax = Math.max(...values);

  // Dynamically calculate padding as 10% of the range or a minimum fixed amount
  const range = rawYMax - rawYMin;
  const padding = Math.max(range * 0.1, 10); // At least 10 units of padding
  const yMin = Math.floor(rawYMin - padding);
  const yMax = Math.ceil(rawYMax + padding);


  const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const date = String(payload[0]?.payload?.Date ?? "").slice(0, 10);
    const raw = Number(payload[0]?.value ?? 0);
    const value = `₹${formatIndianNumber(raw.toFixed(0))}`; // use Indian format

    return (
      <div
        style={{
          backgroundColor: "#fff",
          padding: "10px",
          borderRadius: "5px",
          border: "1px solid #ccc",
        }}
      >
        <p style={{ color: "#4F46E5", fontWeight: "bold" }}>{`${date} : ${value}`}</p>
      </div>
    );
  }
  return null;
};


  return (
    <div style={{ width: "100%", height: "auto" }}>
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="Date"
            tickFormatter={(tick) => tick.slice(0, 10)} // Format Date to 'YYYY-MM'
          />
          <YAxis
            width={70} // Adjust width for Y-Axis labels
            tick={{ fontSize: 12 }} // Font size for Y-Axis labels
            domain={[yMin, yMax]} // Use dynamically calculated domain
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone" // Use 'monotone' for smoother curves
            dataKey="Value"
            stroke= "#4F46E5"
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default HistoricalPerformance;
