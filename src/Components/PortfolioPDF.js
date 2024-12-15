import React from "react";
import { Page, Text, View, Document, StyleSheet, PDFDownloadLink } from "@react-pdf/renderer";

// PDF Styles
const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 12,
  },
  title: {
    fontSize: 18,
    marginBottom: 10,
    fontWeight: "bold",
  },
  section: {
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottom: "1px solid black",
    paddingBottom: 5,
  },
  tableRow: {
    flexDirection: "row",
    paddingTop: 5,
  },
  cell: {
    flex: 1,
    paddingHorizontal: 5,
  },
  bold: {
    fontWeight: "bold",
  },
});

// Portfolio PDF Document Component
const PortfolioPDF = ({ data }) => {
  const calculateTotalValue = (key) =>
    data.reduce((sum, item) => sum + item[key], 0).toFixed(2);

  return (
    <Document>
      <Page style={styles.page}>
        {/* Title */}
        <Text style={styles.title}>Monthly Portfolio Report</Text>
        <Text>Date: {new Date().toLocaleDateString()}</Text>

        {/* Portfolio Overview Section */}
        <View style={styles.section}>
          <Text style={styles.bold}>Portfolio Overview</Text>
          <Text>Total Portfolio Value: ₹{calculateTotalValue("Current Value")}</Text>
          <Text>Total Profit/Loss: ₹{calculateTotalValue("Profit/Loss")}</Text>
          <Text>
            Return Percentage:{" "}
            {(
              (calculateTotalValue("Current Value") /
                calculateTotalValue("Buy Value")) *
              100
            ).toFixed(2)}
            %
          </Text>
        </View>

        {/* Holdings Table Section */}
        <View style={styles.section}>
          <Text style={styles.bold}>Holdings Summary</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.cell, styles.bold]}>Asset</Text>
            <Text style={[styles.cell, styles.bold]}>Quantity</Text>
            <Text style={[styles.cell, styles.bold]}>Current Value</Text>
            <Text style={[styles.cell, styles.bold]}>Profit/Loss</Text>
          </View>
          {data.map((item, index) => (
            <View key={index} style={styles.tableRow}>
              <Text style={styles.cell}>{item.Company}</Text>
              <Text style={styles.cell}>{item.Quantity}</Text>
              <Text style={styles.cell}>₹{item["Current Value"].toFixed(2)}</Text>
              <Text style={styles.cell}>₹{item["Profit/Loss"].toFixed(2)}</Text>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
};

// Export PDFDownloadLink for Button
export const DownloadPDF = ({ data }) => (
  <PDFDownloadLink
    document={<PortfolioPDF data={data} />}
    fileName="Portfolio_Report.pdf"
    className=" flex items-center justify-center py-4 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700"
  >
    {({ loading }) => (loading ? "Generating PDF..." : "Download PDF")}
  </PDFDownloadLink>
);

export default DownloadPDF;
