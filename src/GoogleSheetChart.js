import React from "react";

const GoogleSheetChart = () => {
  const chartUrl = process.env.REACT_APP_GOOGLESHEETCHART;

  return (
    <div
      style={{
        width: "100%",
        height: "100%", // Ensures it fills the grid space
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden", // Prevents scrollbars
      }}
    >
      <iframe
        src={chartUrl}
        style={{
          border: "none",
          width: "100%",
          overflow: 'hidden',
          height: "100%", // Ensures iframe matches the parent div's dimensions
        }}
        title="Google Sheet Chart"
      />
    </div>
  );
};

export default GoogleSheetChart;
