import React, { useState } from "react";

const GoalSection = ({ currentPortfolioValue, darkMode }) => {
  const [goals, setGoals] = useState([]);
  const [goalName, setGoalName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [initialInvestment, setInitialInvestment] = useState("");

  // Add a new goal
  const addGoal = (e) => {
    e.preventDefault();
    const newGoal = {
      goalName,
      targetAmount: parseFloat(targetAmount),
      timeframe: parseFloat(timeframe),
      initialInvestment: parseFloat(initialInvestment),
    };
    setGoals([...goals, newGoal]);
    setGoalName("");
    setTargetAmount("");
    setTimeframe("");
    setInitialInvestment("");
  };

  // Calculate CAGR
  const calculateCAGR = (startValue, endValue, years) => {
    return ((endValue / startValue) ** (1 / years) - 1) * 100;
  };

  return (
    <div className={`p-3 ${darkMode ? "bg-gray-800" : "bg-white"
  }`}>
      {/* Add Goal Form */}
      <form onSubmit={addGoal} className={`p-4 mb-6 rounded-lg ${darkMode ? "bg-gray-800" : "bg-white"
  }`}>
        <h2 className="text-xl font-semibold mb-4">Set a New Goal</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={`block text-md font-semibold ${darkMode} ? "text-white" : "text-gray-600" `}>Goal Name</label>
            <input
              type="text"
              value={goalName}
              onChange={(e) => setGoalName(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-gray-900 font-semibold"
              required
            />
          </div>
          <div>
            <label className={`block text-md font-semibold ${darkMode} ? "text-white" : "text-gray-600" `}>Target Amount (₹)</label>
            <input
              type="number"
              value={targetAmount}
              onChange={(e) => setTargetAmount(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-gray-900 font-semibold"
              required
            />
          </div>
          <div>
            <label className={`block text-md font-semibold ${darkMode} ? "text-white" : "text-gray-600" `}>Timeframe (Years)</label>
            <input
              type="number"
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-gray-900 font-semibold"
              required
            />
          </div>
          <div>
            <label className={`block text-md font-semibold ${darkMode} ? "text-white" : "text-gray-600" `}>Initial Investment (₹)</label>
            <input
              type="number"
              value={initialInvestment}
              onChange={(e) => setInitialInvestment(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-gray-900 font-semibold"
              required
            />
          </div>
        </div>
        <button
          type="submit"
          className="mt-4 px-4 py-2 font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
        >
          Add Goal
        </button>
      </form>

      {/* Goal Display Section */}
      {goals.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Your Goals</h2>
          <div className="grid grid-cols-1 md:grid-cols-1 gap-6">
            {goals.map((goal, index) => {
              const remainingInvestment = goal.targetAmount - currentPortfolioValue;
              const requiredCAGR = calculateCAGR(
                goal.initialInvestment,
                goal.targetAmount,
                goal.timeframe
              );
              const progress =
                (currentPortfolioValue / goal.targetAmount) * 100;

              return (
                <div key={index} className={`p-8 w-3/4 rounded-lg shadow-md ${darkMode ? "bg-gray-900 text-white" : "bg-white"}`} style={{ margin: "0 auto" }}>
                  <h3 className="text-xl font-bold mb-4">{goal.goalName}</h3>
                  <p className={`text-md ${darkMode} ? "text-white" : "text-gray-600"`}>Target Amount: ₹{goal.targetAmount.toLocaleString()}</p>
                  <p className={`text-md ${darkMode} ? "text-white" : "text-gray-600"`}>Timeframe: {goal.timeframe} years</p>
                  <p className={`text-md ${darkMode} ? "text-white" : "text-gray-600"`}>Initial Investment: ₹{goal.initialInvestment.toLocaleString()}</p>
                  <p className={`text-md ${darkMode} ? "text-white" : "text-gray-600"`}>Remaining Investment: ₹{remainingInvestment.toLocaleString()}</p>
                  <p className={`text-md ${darkMode} ? "text-white" : "text-gray-600"`}>Required CAGR: {requiredCAGR.toFixed(2)}%</p>
                  <div className="w-full bg-gray-200 rounded-full h-4 mt-4">
                    <div
                      className="bg-indigo-600 h-4 rounded-full"
                      style={{ width: `${progress}%` }}
                    ></div>
                  </div>
                  <p className={`text-sm mt-1  ${darkMode} ? "text-white" : "text-gray-600"`}>Progress: {progress.toFixed(2)}%</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default GoalSection;
