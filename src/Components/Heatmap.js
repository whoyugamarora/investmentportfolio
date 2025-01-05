import React from "react";

const Heatmap = ({ data }) => {
  // Function to determine background color based on profit/loss percentage
  const getColor = (percentage) => {
    if (percentage > 0 && percentage > 10) return `rgba(34, 197, 94, ${Math.abs(percentage) / 40})`; // Green
    if (percentage < 0 && percentage < -10) return `rgba(239, 68, 68, ${Math.abs(percentage) / 40})`; // Red
    return "rgba(250, 170, 21, 0.9)"; // Yellow for break-even
  }; 

  return (
    <div className="grid lg:grid-cols-4 md:grid-cols-3 grid-cols-2 gap-4">
      {data.map((item, index) => (
        <div
          key={index}
          className="p-4 rounded-md shadow-sm text-center text-white font-semibold"
          style={{
            backgroundColor: getColor(item["PorLpercent"]),
          }}
        >
          <div className="text-sm">{item.Company}</div>
          <div className="text-xl">
            {item["PorLpercent"].toFixed(2)}%
          </div>
        </div>
      ))}
    </div>
  );
};

export default Heatmap;
