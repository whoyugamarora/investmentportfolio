import React from "react";
import {
  Page,
  Text,
  View,
  Document,
  StyleSheet,
  Image,
  PDFDownloadLink,
} from "@react-pdf/renderer";
import { format as formatIndianNumber } from "indian-number-format";

// Styles
const styles = StyleSheet.create({
  page: { padding: 30, fontSize: 12, backgroundColor: "#f8f9fa" },
  title: { fontSize: 24, marginBottom: 10, textAlign: "center", color: "#4F46E5" },
  section: { marginBottom: 20, padding: 10, backgroundColor: "#ffffff",borderRadius: 5},
  sectionTitle: { fontSize: 16, marginBottom: 8, borderBottom: "1px solid #4F46E5" },
  tableHeader: {flexDirection: "row", backgroundColor: "#4F46E5", color: "#ffffff", paddingVertical: 5, borderRadius: 5,},
  tableRow: { flexDirection: "row", borderBottom: "1px solid #ccc", paddingVertical: 5 },
  cell: { flex: 1, textAlign: "center", fontSize: 10 },
  chartContainer: {display: "flex", justifyContent: "center", alignItems: "center", rowGap: 20},
  chartImagePie: { width: "80%", height: "40%"},
  chartImageCompare: { width: "80%", height: "40%"}
});

// PDF Component
const PortfolioPDF = ({ data, chartImages }) => {
  const calculateTotalValue = (key) =>
    data.reduce((sum, item) => sum + item[key], 0).toFixed(2);

  return (
    <Document>
      {/* Page 1: Portfolio Overview */}
      <Page style={styles.page}>
        <Text style={styles.title}>Monthly Portfolio Report</Text>
        <Text style={styles.subtitle}>Date: {new Date().toLocaleDateString()}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Portfolio Overview</Text>
          <View style={styles.tableRow}>
            <Text style={styles.cell}>Total Portfolio Value</Text>
            <Text style={styles.cell}>INR {(formatIndianNumber(calculateTotalValue("Current Value")))}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.cell}>Total Profit/Loss</Text>
            <Text style={styles.cell}>INR {(formatIndianNumber(calculateTotalValue("Profit/Loss")))}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.cell}>Return Percentage</Text>
            <Text style={styles.cell}>
              {(
                (calculateTotalValue("Profit/Loss") /
                  calculateTotalValue("Buy Value")) *
                100
              ).toFixed(2)}%
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Holdings Summary</Text>
          <View style={styles.tableHeader}>
            <Text style={styles.cell}>Asset</Text>
            <Text style={styles.cell}>Quantity</Text>
            <Text style={styles.cell}>Buy Value</Text>
            <Text style={styles.cell}>Current Value</Text>
            <Text style={styles.cell}>Profit/Loss</Text>
            <Text style={styles.cell}>P/L %</Text>
          </View>
          {data.map((item, index) => (
            <View key={index} style={styles.tableRow}>
              <Text style={styles.cell}>{item.Company}</Text>
              <Text style={styles.cell}>{item.Quantity}</Text>
              <Text style={styles.cell}>INR {(formatIndianNumber(item["Buy Value"].toFixed(0)))}</Text>
              <Text style={styles.cell}>INR {(formatIndianNumber(item["Current Value"].toFixed(0)))}</Text>
              <Text style={styles.cell}>INR {(formatIndianNumber(item["Profit/Loss"].toFixed(0)))}</Text>
              <Text style={styles.cell}>{item["PorLpercent"].toFixed(0)}%</Text>
            </View>
          ))}
        </View>
      </Page>

      {/* Page 2: Charts */}
      <Page style={styles.page}>
      <View style={styles.chartContainer}>
        <Image src={chartImages.pie} style={styles.chartImage} />
        <Image src={chartImages.comparison} style={styles.chartImage} />
        </View>
      </Page>
    </Document>
  );
};

// Download PDF Button Component
export const DownloadPDF = ({ data, chartImages }) => (
  <PDFDownloadLink
    document={<PortfolioPDF data={data} chartImages={chartImages} />}
    fileName="Portfolio_Report.pdf"
    className="flex items-center justify-center py-4 px-6 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 shadow-md"
  >
    {({ loading }) => (loading ? "Generating PDF..." : "Download PDF")}
  </PDFDownloadLink>
);

export default DownloadPDF;
