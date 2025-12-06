import { useCallback } from "react";
import ExcelJS from "exceljs";
import Chart from "chart.js/auto";
import ChartDataLabels from "chartjs-plugin-datalabels";

// Register the datalabels plugin
Chart.register(ChartDataLabels);

export default function useChartExport() {
  const exportToExcel = useCallback(async (dailyLog) => {
    if (!dailyLog || dailyLog.length === 0) {
      alert("No data to export. Please submit daily work first.");
      return;
    }

    // 1. Aggregate data by date
    const aggregated = {};
    dailyLog.forEach((record) => {
      const date = record.date;
      if (!aggregated[date]) {
        aggregated[date] = {
          date,
          installed_panels: 0,
          workers: 0,
          subs: new Set(),
        };
      }
      aggregated[date].installed_panels += record.installed_panels || 0;
      aggregated[date].workers += record.workers || 0;
      if (record.subcontractor) {
        aggregated[date].subs.add(record.subcontractor);
      }
    });

    const sortedData = Object.values(aggregated)
      .map((row) => {
        const subsArr = Array.from(row.subs);
        const subcontractor = subsArr.join(", ");
        const subInitial = subsArr.length > 0
          ? subsArr[0].trim().slice(0, 2).toUpperCase()
          : "";
        return {
          ...row,
          subcontractor,
          subInitial,
          subsArr,
        };
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // 3. Create hidden canvas for chart
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 400;
    canvas.style.display = "none";
    document.body.appendChild(canvas);

    // 4. Create chart
    const ctx = canvas.getContext("2d");
    const chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: sortedData.map((d) => d.date),
        datasets: [
          {
            label: "Installed Panels",
            data: sortedData.map((d) => d.installed_panels),
            backgroundColor: "rgba(52, 152, 219, 0.7)",
            borderColor: "rgba(52, 152, 219, 1)",
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: "Daily Installation Progress",
            font: { size: 16 },
          },
          datalabels: {
            display: true,
            align: "top",
            anchor: "end",
            formatter: (value, context) => {
              const row = sortedData[context.dataIndex];
              const label = row.subInitial ? `${row.subInitial}-${row.workers}` : `${row.workers}`;
              return label;
            },
            font: { size: 10 },
            color: "#333",
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: "Panels Installed",
            },
          },
          x: {
            title: {
              display: true,
              text: "Date",
            },
          },
        },
      },
      plugins: [ChartDataLabels],
    });

    // 5. Wait for chart to render and get PNG
    await new Promise((resolve) => setTimeout(resolve, 100));
    const chartImage = canvas.toDataURL("image/png");

    // 6. Destroy chart and remove canvas
    chart.destroy();
    document.body.removeChild(canvas);

    // 7. Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "MC4 Panel MVP";
    workbook.created = new Date();

    // Sheet 1: Data
    const dataSheet = workbook.addWorksheet("Daily Log");
    dataSheet.columns = [
      { header: "Date", key: "date", width: 15 },
      { header: "Installed Panels", key: "installed_panels", width: 18 },
      { header: "Workers", key: "workers", width: 12 },
      { header: "Subcontractor", key: "subcontractor", width: 25 },
    ];

    // Add header styling
    dataSheet.getRow(1).font = { bold: true };
    dataSheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF3498DB" },
    };
    dataSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

    // Add data rows
    sortedData.forEach((row) => {
      dataSheet.addRow({
        date: row.date,
        installed_panels: row.installed_panels,
        workers: row.workers,
        subcontractor: row.subcontractor,
      });
    });

    // Add totals row
    const totalRow = dataSheet.addRow({
      date: "TOTAL",
      installed_panels: sortedData.reduce((s, r) => s + r.installed_panels, 0),
      workers: sortedData.reduce((s, r) => s + r.workers, 0),
      subcontractor: "",
    });
    totalRow.font = { bold: true };

    // Sheet 2: Chart
    const chartSheet = workbook.addWorksheet("Chart");
    
    // Convert base64 to buffer
    const base64Data = chartImage.replace(/^data:image\/png;base64,/, "");
    const imageId = workbook.addImage({
      base64: base64Data,
      extension: "png",
    });

    chartSheet.addImage(imageId, {
      tl: { col: 0, row: 0 },
      ext: { width: 800, height: 400 },
    });

    // 8. Download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mc4-daily-log-${new Date().toISOString().split("T")[0]}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  return { exportToExcel };
}
