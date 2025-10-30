// src/App.tsx
import { useEffect, useRef } from "react";
//@ts-ignore
import * as d3 from "d3";

type Row = { artist: string; weeks: number };

const CSV_URL = new URL("./assets/bb_weeks.csv", import.meta.url); // file at src/assets/bb_weeks.csv

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let destroyed = false;

    (async () => {
      // 1) Load & parse CSV
      const text = await fetch(CSV_URL).then((r) => r.text());
      const parsed = d3.csvParse(text, (d) => ({
        artist: String(d.artist ?? "").trim(),
        weeks: +String(d.weeks ?? 0),
      })) as Row[];

      // Clean + take top 50
      const data = parsed
        .filter((d) => d.artist && Number.isFinite(d.weeks) && d.weeks > 0)
        .sort((a, b) => b.weeks - a.weeks)
        .slice(0, 50);

      if (destroyed || !mountRef.current || data.length === 0) return;

      // 2) Treemap layout (area ∝ weeks)
      const margin = { top: 88, right: 16, bottom: 16, left: 16 }; // increased top padding to clear legend axis
      const width = 1920;
      const height = 1080;
      const innerW = width - margin.left - margin.right;
      const innerH = height - margin.top - margin.bottom;

      const root = d3
        .hierarchy<{ children: Row[] }>({ children: data } as any)
        .sum((d: any) => d.weeks)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

      const treemap = d3
        .treemap<any>()
        .size([innerW, innerH])
        .paddingInner(2)
        .round(true)
        .tile(d3.treemapSquarify); // squarified rectangles (most "square-like")

      const leaves = treemap(root).leaves();

      const extent = d3.extent(data, (d) => d.weeks) as [number, number];
      const [vmin, vmax] = extent;
      const color = d3
        .scaleSequential(d3.interpolateRgbBasis([
          "#facc15", // yellow (low)
          "#34d399", // green (high)
        ]))
        .domain([vmin, vmax]);

      // 3) Draw
      const container = mountRef.current;
      container.innerHTML = "";

      const svg = d3
        .create<SVGSVGElement>("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("width", width)
        .attr("height", height)
        .attr(
          "style",
          "max-width:100%;height:auto;display:block;background:#ffffff; border:1px solid #e5e7eb; border-radius:12px;"
        );

      // Tooltip
      const tooltip = d3
        .select(container)
        .append("div")
        .style("position", "absolute")
        .style("z-index", "10")
        .style("pointer-events", "none")
        .style("background", "rgba(17,24,39,0.9)")
        .style("color", "#fff")
        .style("padding", "6px 8px")
        .style("font", "12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif")
        .style("border-radius", "6px")
        .style("box-shadow", "0 4px 16px rgba(0,0,0,0.15)")
        .style("opacity", "0");

      const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

      const nodes = g
        .selectAll("g.tile")
        .data(leaves)
        .join("g")
        .attr("class", "tile")
        .attr("transform", (d) => `translate(${d.x0},${d.y0})`);

      const rects = nodes
        .append("rect")
        .attr("rx", 6)
        .attr("ry", 6)
        .attr("width", (d) => Math.max(0, d.x1 - d.x0))
        .attr("height", (d) => Math.max(0, d.y1 - d.y0))
        .attr("fill", (d: any) => color(d.data.weeks))
        .attr("stroke", "#0b1a33")
        .attr("stroke-opacity", 0.15)
        .attr("cursor", "default")
        .on("pointerenter", function (event, d: any) {
          d3.select(this).attr("stroke-opacity", 0.6).attr("stroke-width", 1.5);
          d3.selectAll<SVGRectElement, any>(".tile rect").filter((n) => n !== d).attr("opacity", 0.85);
          tooltip
            .style("opacity", "1")
            .html(
              `<strong>${escapeHtml(d.data.artist)}</strong><br/>${d.data.weeks} week${d.data.weeks === 1 ? "" : "s"
              }`
            );
        })
        .on("pointermove", function (event) {
          const { pageX, pageY } = event;
          tooltip.style("left", pageX + 12 + "px").style("top", pageY + 12 + "px");
        })
        .on("pointerleave", function () {
          d3.select(this).attr("stroke-opacity", 0.15).attr("stroke-width", 1);
          d3.selectAll<SVGRectElement, any>(".tile rect").attr("opacity", 1);
          tooltip.style("opacity", "0");
        });

      // Labels (truncate to fit)
      nodes.each(function (d: any) {
        const group = d3.select(this);
        const w = Math.max(0, d.x1 - d.x0);
        const h = Math.max(0, d.y1 - d.y0);

        // Only label if there's room
        if (w < 48 || h < 28) return;

        const name = d.data.artist;
        const weeks = d.data.weeks;

        // rough character budget based on tile width
        const maxChars = Math.max(4, Math.floor((w - 10) / 7));
        const nameShort = name.length > maxChars ? name.slice(0, maxChars - 1) + "…" : name;

        group
          .append("text")
          .attr("x", 8)
          .attr("y", 16)
          .attr("fill", "#0b1a33")
          .attr("font-weight", 600)
          .attr("font-size", 18)
          .attr("font-family", "system-ui, -apple-system, Segoe UI, Roboto, sans-serif")
          .text(nameShort);

        if (h >= 44) {
          group
            .append("text")
            .attr("x", 8)
            .attr("y", 32)
            .attr("fill", "#1b2a4a")
            .attr("font-size", 15)
            .attr("font-family", "system-ui, -apple-system, Segoe UI, Roboto, sans-serif")
            .text(`${weeks} weeks`);
        }
      });

      // Title
      svg
        .append("text")
        .attr("x", margin.left)
        .attr("y", 40)
        .attr("fill", "#0b1a33")
        .attr("font-size", 32)
        .attr("font-weight", 600)
        .attr("font-family", "system-ui, -apple-system, Segoe UI, Roboto, sans-serif")
        .text("Billboard® Top 50 Artists by Weeks (1958-2021)");

      // Legend (optional mini gradient)
      const legendW = 220;
      const legendY = 12; // place legend within the top margin so it doesn't overlap tiles
      const legend = svg.append("g").attr("transform", `translate(${width - legendW - margin.right}, ${legendY})`);
      legend
        .append("text")
        .attr("fill", "#0b1a33")
        .attr("x", 0)
        .attr("y", 0)
        .attr("dy", "0.71em")
        .attr("font-size", 18)
        .attr("font-family", "system-ui, -apple-system, Segoe UI, Roboto, sans-serif")
        .text("Weeks");
      const lx = d3.scaleLinear().domain([vmin, vmax]).range([0, legendW]);
      const gradData = d3.ticks(vmin, vmax, 8).map((t) => ({ x: lx(t), t, c: color(t) }));
      legend
        .append("g")
        .attr("transform", "translate(0,16)")
        .selectAll("rect")
        .data(d3.pairs(gradData))
        .join("rect")
        .attr("x", (d) => d[0].x)
        .attr("y", 0)
        .attr("width", (d) => Math.max(0, d[1].x - d[0].x))
        .attr("height", 10)
        .attr("fill", (d) => d[0].c);
      const legendAxis = legend
        .append("g")
        .attr("transform", "translate(0,28)")
        .call(d3.axisBottom(lx).ticks(5).tickSize(4))
        .call((g) => g.select(".domain").remove());

      legendAxis
        .selectAll("text")
        .style("fill", "#0b1a33", "important")
        .attr("font-size", 12)
        .attr("font-family", "system-ui, -apple-system, Segoe UI, Roboto, sans-serif");

      legendAxis
        .selectAll("line")
        .style("stroke", "#0b1a33");

      // mount
      container.appendChild(svg.node()!);
    })();

    return () => {
      destroyed = true;
      if (mountRef.current) {
        mountRef.current.innerHTML = "";
      }
    };
  }, []);

  return (
    <div style={{ padding: 12, position: "relative" }}>
      <div className="flex flex-1">
        <div className="align-middle justify-center" ref={mountRef} />
      </div>
      <div className="mt-6 space-y-6 rounded-xl border border-slate-200 bg-white/70 p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">Analysis question</h2>
        <p className="text-slate-700">
          Among Billboard Hot 100 artists (1958–2021), which artists have the greatest cumulative “chart residency”
          (total weeks on the chart), and how concentrated is that longevity within the top 50?
        </p>

        <section id="visual-concept" className="space-y-3">
          <h3 className="text-lg font-semibold text-slate-900">Visual concept</h3>
          <ul className="list-disc pl-5 space-y-2 text-slate-700">
            <li>
              <strong className="font-semibold text-slate-900">Chart type:</strong>
              {" "}Treemap (squarified) where rectangle area ∝ weeks. This makes long-tenured artists visually dominant
              while still showing everyone in a compact, scannable layout.
            </li>
            <li>
              <strong className="font-semibold text-slate-900">Encoding:</strong>
              <ul className="list-[circle] pl-5 space-y-1">
                <li><strong className="font-semibold text-slate-900">Area:</strong> total weeks (primary quantity).</li>
                <li><strong className="font-semibold text-slate-900">Color:</strong> yellow → green sequential scale mapped to weeks (greener = more weeks)</li>
                <li><strong className="font-semibold text-slate-900">Ordering:</strong> value-sorted to keep big tiles top-left and improve first-glance ranking.</li>
              </ul>
            </li>
            <li>
              <strong className="font-semibold text-slate-900">Layout/labeling:</strong>
              Value labels appear when tiles are large enough; small tiles rely on hover tooltips to reduce clutter. Title and
              legend live in the top margin; borders are subtle to keep focus on area.
            </li>
            <li>
              <strong className="font-semibold text-slate-900">Scope:</strong>
              Top 50 artists by cumulative weeks—keeps the field readable while still revealing concentration.
            </li>
          </ul>
        </section>

        <section id="interaction-concept" className="space-y-3">
          <h3 className="text-lg font-semibold text-slate-900">Interaction concept</h3>
          <ul className="list-disc pl-5 space-y-2 text-slate-700">
            <li>
              <strong className="font-semibold text-slate-900">Currently implemented:</strong>
              <ul className="list-[circle] pl-5 space-y-1">
                <li><strong className="font-semibold text-slate-900">Hover:</strong> tooltip with artist + weeks.</li>
              </ul>
            </li>
          </ul>
        </section>

        <section id="linked-inspiration" className="space-y-3">
          <h3 className="text-lg font-semibold text-slate-900">Linked inspiration</h3>
          <ul className="list-disc pl-5 space-y-2 text-slate-700">
            <li>
              <a
                href="https://observablehq.com/@d3/treemap"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 hover:text-indigo-700 underline"
              >
                Observable Treemap (Mike Bostock)
              </a>
              — clean examples of squarified tiling, labeling, and interaction patterns.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

// small util to keep tooltip safe from stray chars
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));
}