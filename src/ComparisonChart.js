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

  const GOOGLE_SHEET_URL = process.env.REACT_APP_COMPARISON_CHART;

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await axios.get(GOOGLE_SHEET_URL);
        const initialClose = response.data[0]?.Close;
        const initialPFValue = response.data[0]?.["PF Value"];

        const formattedData = response.data.map((item) => ({
          Date: item.Date,
          "PF Value": ((item["PF Value"] / initialPFValue) * 100).toFixed(2),
          Close: ((item.Close / initialClose) * 100).toFixed(2),
        }));

        setData(formattedData);
        console.log(formattedData);
        console.log("Data Fetched Comparison");
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };

    fetchData();
  }, []);

  // Find min and max for the Y-axis domain
  const yMin = Math.min(...data.map((d) => Math.min(d["PF Value"], d.Close)));
  const yMax = Math.max(...data.map((d) => Math.max(d["PF Value"], d.Close)));

  return (
    <div style={{ width: "100%", height: "400px" }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="4 4" />
          <XAxis dataKey="Date" tickFormatter={(tick) => new Date(tick).toLocaleDateString()} />
          <YAxis
            tick={{ fontSize: 12 }}
            label={{
              value: "Performance (%)",
              angle: -90,
              position: "insideLeft",
            }}
            domain={[Math.floor(yMin), Math.ceil(yMax)]} // Dynamic domain
          />
          <Tooltip
            formatter={(value, name) => [`${value}%`, name]}
            labelFormatter={(label) => `Date: ${new Date(label).toLocaleDateString()}`}
          />
          <Line type="monotone" strokeWidth={2} dataKey="PF Value" stroke="#FF6384" name="Portfolio (%)" />
          <Line type="monotone" strokeWidth={2} dataKey="Close" stroke="#36A2EB" name="CNX 500 (%)" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default ComparisonChart;
