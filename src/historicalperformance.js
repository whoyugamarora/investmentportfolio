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

const HISTORICAL_PERFORMANCE_URL = process.env.REACT_APP_HISTORICAL_PERFORMANCE_URL;

const HistoricalPerformance = () => {
  const [data, setData] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await axios.get(HISTORICAL_PERFORMANCE_URL);

        // Filter the data to include only every 7th entry
        const filteredData = response.data.filter((_, index) => index % 5 === 0);

        setData(filteredData);
        console.log(filteredData);
        console.log("Data Fetched");
      } catch (error) {
        console.error("Error fetching data:", error);
        console.log("Can't fetch data");
      }
    };

    fetchData();
  }, []);

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const date = payload[0].payload.Date.slice(0, 10); // Format the Date
      const value = `₹${payload[0].value.toLocaleString()}`; // Format the Value
  
      return (
        <div style={{ backgroundColor: "#fff", padding: "10px", borderRadius: "5px", border: "1px solid #ccc" }}>
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
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone" // Use 'monotone' for smoother curves
            dataKey="Value"
            stroke="#4F46E5"
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default HistoricalPerformance;
