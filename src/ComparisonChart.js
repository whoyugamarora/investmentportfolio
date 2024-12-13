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

const ComparisonChart = () => {
  const [data, setData] = useState([]);

  const GOOGLE_SHEET_URL = process.env.REACT_APP_HISTORICAL_PERFORMANCE_URL;

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await axios.get(GOOGLE_SHEET_URL);
        const rows = response.data; // Assume data is already formatted properly
        const normalizedData = rows.map((row) => ({
          Date: row.Date,
          Portfolio: (row["Value"] / rows[0]["Value"]) * 100,
          CNX500: (row["CNX500"] / rows[0]["CNX 500"]) * 100,
          CNXSmallcap:
            (row["CNX Smallcap"] / rows[0]["CNX Smallcap"]) * 100,
        }));
        setData(normalizedData);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };

    fetchData();
  }, []);

  return (
    <div style={{ width: "100%", height: "400px" }}>
      <h2>Portfolio vs CNX 500 vs CNX Smallcap</h2>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="Date" tickFormatter={(tick) => tick.slice(0, 7)} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Line type="monotone" dataKey="Portfolio" stroke="#FF6384" />
          <Line type="monotone" dataKey="CNX500" stroke="#36A2EB" />
          <Line type="monotone" dataKey="CNXSmallcap" stroke="#4CAF50" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default ComparisonChart;
