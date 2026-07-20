(function initialiseChartData(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NHLTrackerChartData = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createChartData() {
  "use strict";

  const plain = value => String(value ?? "").replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, "").trim();
  const titleText = title => plain(typeof title === "string" ? title : title?.text || "");
  const valueAt = (value, index) => Array.isArray(value) ? value[index] : value;

  const rowsForChart = (traces = [], layout = {}) => {
    const xUnit = titleText(layout.xaxis?.title) || "X value";
    const yUnit = titleText(layout.yaxis?.title) || "Y value";
    const rows = [];
    traces.forEach((trace, traceIndex) => {
      const series = plain(trace.name || `Series ${traceIndex + 1}`);
      if (Array.isArray(trace.z) && trace.z.some(Array.isArray)) {
        trace.z.forEach((row, yIndex) => row.forEach((value, xIndex) => rows.push({
          series,
          category: plain(`${valueAt(trace.y, yIndex) ?? yIndex + 1} · ${valueAt(trace.x, xIndex) ?? xIndex + 1}`),
          x: plain(valueAt(trace.x, xIndex) ?? xIndex + 1),
          y: plain(value),
          xUnit,
          yUnit: titleText(layout.coloraxis?.colorbar?.title || trace.colorbar?.title) || yUnit,
        })));
        return;
      }
      if (trace.link && Array.isArray(trace.link.value)) {
        trace.link.value.forEach((value, index) => rows.push({
          series,
          category: plain(valueAt(trace.link.label, index) || `Flow ${index + 1}`),
          x: plain(valueAt(trace.link.source, index)),
          y: plain(value),
          xUnit: "Source node",
          yUnit: "Flow value",
        }));
        return;
      }
      const length = Math.max(trace.x?.length || 0, trace.y?.length || 0, trace.values?.length || 0, trace.r?.length || 0);
      for (let index = 0; index < length; index += 1) {
        rows.push({
          series,
          category: plain(valueAt(trace.labels, index) ?? valueAt(trace.theta, index) ?? valueAt(trace.x, index) ?? index + 1),
          x: plain(valueAt(trace.x, index) ?? valueAt(trace.r, index) ?? ""),
          y: plain(valueAt(trace.y, index) ?? valueAt(trace.values, index) ?? ""),
          xUnit,
          yUnit,
        });
      }
    });
    return rows;
  };

  const csvForRows = rows => {
    const fields = ["series", "category", "x", "y", "xUnit", "yUnit"];
    const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
    return [fields.join(","), ...rows.map(row => fields.map(field => quote(row[field])).join(","))].join("\n");
  };

  return Object.freeze({ rowsForChart, csvForRows });
}));
