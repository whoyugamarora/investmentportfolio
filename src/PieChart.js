import React from "react";
import { Pie } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";

ChartJS.register(ArcElement, Tooltip, Legend);

const PieChart = ({ data }) => {
  const chartData = {
    labels: data.map((item) => item.Company),
    datasets: [
      {
        label: "Current Value Distribution",
        data: data.map((item) => item["Current Value"]),
        backgroundColor: [
          "#FF6384",
          "#36A2EB",
          "#FFCE56",
          "#4CAF50",
          "#FFC107",
          "#673AB7",
          "#E91E63",
          "#00BCD4",
          "#9C27B0",
          "#009688",
        ],
        hoverOffset: 4,
      },
    ],
  };

  const options = {
    plugins: {
      legend: {
        position: "right",
      },
    },
    maintainAspectRatio: false,
  };

  return (
    <div style={{ width: "100%", height: "400px" }}>
      <Pie data={chartData} options={options} />
    </div>
  );
};

export default PieChart;


 