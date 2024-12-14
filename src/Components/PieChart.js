import React from "react";
import { Pie } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";

ChartJS.register(ArcElement, Tooltip, Legend);

const PieChart = ({ data, darkMode }) => {
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
        hoverOffset: 10,
      },
    ],
  };

  const options = {
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          font: {
            size: 9,
          },
          color: darkMode ? "#FFFFFF" : "#000000", // Legend text color
        },
      },
      tooltip: {
        backgroundColor: darkMode ? "#333333" : "#FFFFFF", // Tooltip background color
        titleColor: darkMode ? "#FFFFFF" : "#000000", // Tooltip title color
        bodyColor: darkMode ? "#FFFFFF" : "#000000", // Tooltip body color
      },
    },
    maintainAspectRatio: false,
    layout: {
      padding: 2,
    },
    elements: {
      arc: {
        borderWidth: 0,
        borderColor: darkMode ? "#333333" : "#FFFFFF", // Adjust border for dark mode
      },
    },
  };

  return (
    <div
      style={{
        width: "100%",
        height: "500px",
        backgroundColor: darkMode ? "#1F2937" : "#FFFFFF", // Dark gray for dark mode, white for light mode
        color: darkMode ? "#FFFFFF" : "#000000", // Ensure text color matches the mode
        padding: "1rem",
        borderRadius: "10px",
      }}
    >
      <Pie data={chartData} options={options} />
    </div>
  );
};

export default PieChart;
