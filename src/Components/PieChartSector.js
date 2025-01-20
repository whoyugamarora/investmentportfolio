import React from "react";
import { Pie } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";

ChartJS.register(ArcElement, Tooltip, Legend);

const PieChartSector = ({ data, darkMode }) => {
    // Consolidate data by sector
    const consolidatedData = data.reduce((acc, item) => {
        const { Sector, "Current Value": currentValue } = item;

        // Check if the sector already exists in the accumulator
        if (acc[Sector]) {
            acc[Sector] += currentValue; // Add to the existing value
        } else {
            acc[Sector] = currentValue; // Initialize the sector with the current value
        }

        return acc;
    }, {});

    const totalValue = Object.values(consolidatedData).reduce((sum, value) => sum + value, 0);

    // Convert the consolidated object into chart data
    const chartData = {
        labels: Object.keys(consolidatedData), // Sectors
        datasets: [
            {
                label: "Current Value Distribution",
                data: Object.values(consolidatedData), // Summed up values
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
                callbacks: {
                    label: function (tooltipItem) {
                        const value = tooltipItem.raw; // Current value
                        const percentage = ((value / totalValue) * 100).toFixed(2); // Calculate percentage
                        return `Value: INR ${value.toLocaleString()} (${percentage}%)`;
                    },
                },
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

export default PieChartSector;
