import React, { useEffect, useMemo, useRef, useState } from "react";
//@ts-ignore
import * as d3 from "d3";
// Load default dataset from assets
// @ts-ignore
import hot100Url from "./assets/hot-100-current.csv?url";

// Date helpers for weekly frames
const parseDate = d3.timeParse('%Y-%m-%d');
const fmtISO = d3.timeFormat('%Y-%m-%d');

type Row = {
  chart_week: string;     // e.g., "2024-08-17"
  current_week: string;   // rank as string in CSV (we cast to number)
  title: string;
  performer: string;
  last_week?: string | null;
  peak_pos?: string | null;
  wks_on_chart?: string | null;
};

type ParsedRow = {
  week: string;
  rank: number;
  title: string;
  artist: string;
  last_week: number | null;
  peak: number | null;
  weeks: number;
  id: string;   // stable key = title — performer
  value: number;// computed as 51 - rank (or points if you add)
};

type Frame = { week: string; entries: ParsedRow[] };

// ------------------------- Demo data (tiny sample) -------------------------
const DEMO_CSV = `chart_week,current_week,title,performer,last_week,peak_pos,wks_on_chart
2024-08-03,1,bad guy,Billie Eilish,2,1,34
2024-08-03,2,Blinding Lights,The Weeknd,1,1,60
2024-08-03,3,Firework,Katy Perry,5,1,12
2024-08-03,5,Teenage Dream,Katy Perry,7,1,20
2024-08-03,7,Shake It Off,Taylor Swift,6,1,40
2024-08-03,9,Roar,Katy Perry,8,1,25
2024-08-03,10,As It Was,Harry Styles,9,1,30
2024-08-10,1,Firework,Katy Perry,3,1,13
2024-08-10,3,Blinding Lights,The Weeknd,2,1,61
2024-08-10,4,bad guy,Billie Eilish,1,1,35
2024-08-10,5,Shake It Off,Taylor Swift,7,1,41
2024-08-10,8,Teenage Dream,Katy Perry,5,1,21
2024-08-10,9,Levitating,Dua Lipa,12,1,64
2024-08-10,11,Roar,Katy Perry,9,1,26
2024-08-10,14,Uptown Funk,Mark Ronson ft. Bruno Mars,15,1,50
2024-08-10,19,Someone Like You,Adele,-,1,10
2024-08-17,1,Firework,Katy Perry,2,1,14
2024-08-17,5,Blinding Lights,The Weeknd,3,1,62
2024-08-17,6,Shake It Off,Taylor Swift,5,1,42
2024-08-17,6,bad guy,Billie Eilish,4,1,36
2024-08-17,7,Teenage Dream,Katy Perry,8,1,22
2024-08-17,8,Levitating,Dua Lipa,9,1,65
2024-08-17,13,Uptown Funk,Mark Ronson ft. Bruno Mars,14,1,51
2024-08-17,15,Roar,Katy Perry,11,1,27
2024-08-17,16,As It Was,Harry Styles,13,1,31
2024-08-17,17,Someone Like You,Adele,19,1,11
`;

// ------------------------- Utilities -------------------------
function parseCsvText(text: string): Row[] {
  const rows = d3.csvParse(text.trim());
  return rows as unknown as Row[];
}

function coerceRows(rows: Row[]): ParsedRow[] {
  return rows.map((r) => {
    const rank = +r.current_week;
    const last =
      r.last_week && r.last_week !== "-" && r.last_week !== "" ? +r.last_week : null;
    const peak =
      r.peak_pos && r.peak_pos !== "-" && r.peak_pos !== "" ? +r.peak_pos : null;
    const weeks =
      r.wks_on_chart && r.wks_on_chart !== "-" && r.wks_on_chart !== "" ? +r.wks_on_chart : 0;
    const id = `${r.title} — ${normalizeArtist(r.performer)}`;
    return {
      week: r.chart_week,
      rank,
      title: r.title,
      artist: r.performer,
      last_week: last,
      peak,
      weeks,
      id,
      value: 51 - rank, // swap with "points" if you have them
    };
  }).filter(d => Number.isFinite(d.rank));
}

function extractYear(s: string): number {
  const m = s?.match?.(/([12]\d{3})/);
  return m ? +m[1] : NaN;
}

function normalizeArtist(s: string): string {
  if (!s) return "";
  let t = s.toLowerCase();
  // remove parenthetical features like (feat. X), (with X)
  t = t.replace(/\((feat\.?|featuring|with)[^)]+\)/gi, "");
  // unify feature separators
  t = t.replace(/\b(feat\.?|ft\.?|featuring|with)\b/gi, " feat ");
  t = t.replace(/\s*[×x]\s*/g, " feat ");
  // normalize ampersands and commas
  t = t.replace(/\s*&\s*/g, " & ");
  t = t.replace(/[,]/g, " ");
  // collapse whitespace
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

const LABEL_ELLIPSIS = "…";
const LABEL_INNER_OFFSET = 8;
const LABEL_INNER_PADDING = LABEL_INNER_OFFSET * 2;
const LABEL_MIN_VISIBLE_WIDTH = 18;

const InfoTip: React.FC<{ message: string }> = ({ message }) => (
  <span className="relative inline-flex group">
    <span
      className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-slate-500 bg-slate-800 text-[10px] font-semibold text-slate-200"
      role="button"
      tabIndex={0}
      aria-label="More info"
    >
      ?
    </span>

    <span
      role="tooltip"
      className="
        pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-52 -translate-x-1/2
        rounded-md border border-slate-600 bg-slate-900/95 px-2 py-1 text-xs font-normal
        leading-snug text-slate-100 shadow-lg
        whitespace-pre-line               /* 👈 enables \\n line breaks */
        group-hover:block group-focus-within:block  /* show on hover OR keyboard focus */
      "
    >
      {message}
    </span>
  </span>
);

function ensureLabelSpans(textSel: d3.Selection<SVGTextElement, any, any, any>) {
  let titleSpan = textSel.select<SVGTSpanElement>("tspan.label-title");
  if (titleSpan.empty()) {
    titleSpan = textSel
      .append("tspan")
      .attr("class", "label-title")
      .attr("font-weight", 600);
  }

  let artistSpan = textSel.select<SVGTSpanElement>("tspan.label-artist");
  if (artistSpan.empty()) {
    artistSpan = textSel
      .append("tspan")
      .attr("class", "label-artist")
      .attr("font-weight", 400)
      .attr("font-size", 11);
  }

  let titleNode = textSel.select("title");
  if (titleNode.empty()) {
    titleNode = textSel.append("title");
  }

  return { titleSpan, artistSpan, titleNode };
}

function formatLabelText(node: SVGTextElement, datum: any, availableWidth: number) {
  const textSel = d3.select(node);
  const { titleSpan, artistSpan, titleNode } = ensureLabelSpans(textSel);
  const title = datum?.title ?? "";
  const artist = datum?.artist ?? "";
  const tooltip = artist ? `${title} by ${artist}` : title;

  titleNode.text(tooltip);

  if (!Number.isFinite(availableWidth) || availableWidth <= LABEL_MIN_VISIBLE_WIDTH) {
    textSel.attr("display", "none");
    return;
  }

  textSel.attr("display", null).attr("text-anchor", "start").attr("x", LABEL_INNER_OFFSET);
  titleSpan.text(title);
  artistSpan.text(artist ? ` by ${artist}` : "");

  const labelNode = textSel.node();
  if (!labelNode) return;

  if (labelNode.getComputedTextLength() <= availableWidth) {
    return;
  }

  if (artist) {
    let truncatedArtist = artist;
    while (truncatedArtist.length > 1 && labelNode.getComputedTextLength() > availableWidth) {
      truncatedArtist = truncatedArtist.slice(0, -1).trimEnd();
      artistSpan.text(truncatedArtist ? ` by ${truncatedArtist}${LABEL_ELLIPSIS}` : "");
    }

    if (labelNode.getComputedTextLength() > availableWidth) {
      artistSpan.text("");
    }
  }

  let truncatedTitle = title;
  while (truncatedTitle.length > 1 && labelNode.getComputedTextLength() > availableWidth) {
    truncatedTitle = truncatedTitle.slice(0, -1).trimEnd();
    titleSpan.text(`${truncatedTitle}${LABEL_ELLIPSIS}`);
  }

  if (labelNode.getComputedTextLength() > availableWidth) {
    titleSpan.text(LABEL_ELLIPSIS);
  }
}

// Helper to compute carry-in weeks per song from the last N weeks before the chosen start year
function computeCarryIn(parsedAll: ParsedRow[], startYear: number | null, rollingWeeks: number | null): Map<string, number> {
  const result = new Map<string, number>();
  if (startYear == null || !Number.isFinite(startYear) || !Number.isFinite(rollingWeeks as number) || (rollingWeeks as number) <= 0) {
    return result; // no carry-in
  }
  const end = new Date(`${startYear}-01-01`);                 // exclusive upper bound
  const start = d3.timeWeek.offset(end, -(rollingWeeks as number)); // inclusive lower bound (N weeks prior)
  for (const r of parsedAll) {
    const dt = parseDate?.(r.week) ?? new Date(r.week);
    if (!(dt instanceof Date) || isNaN(+dt)) continue;
    if (+dt >= +start && +dt < +end) {
      result.set(r.id, (result.get(r.id) ?? 0) + 1);
    }
  }
  return result;
}

// Helper to compute lifetime weeks per song within the loaded CSV
function computeLifetime(parsedAll: ParsedRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of parsedAll) {
    m.set(r.id, (m.get(r.id) ?? 0) + 1);
  }
  return m;
}

function makeFrames(
  parsed: ParsedRow[],
  topN: number,
  carryIn?: Map<string, number>,
  lifetimeMap?: Map<string, number>,
  metricMode: 'ytd' | 'window' | 'lifetime' = 'window',
  poolMode: 'year' | 'file' = 'year',
  parsedAllForMeta?: ParsedRow[]
): Frame[] {
  // Group rows by week string
  const byWeek = d3.group(parsed, (d) => d.week);

  // All IDs & display metadata across the filtered dataset
  const metaAll = new Map<string, { title: string; artist: string }>();
  const metaSource = parsedAllForMeta ?? parsed;
  metaSource.forEach((r) => {
    if (!metaAll.has(r.id)) metaAll.set(r.id, { title: r.title, artist: r.artist });
  });

  // Build sorted list of observed week dates
  const weekDates: Date[] = Array.from(byWeek.keys())
    .map((s) => parseDate?.(s) ?? new Date(s))
    .filter((d): d is Date => d instanceof Date && !isNaN(+d))
    .sort(d3.ascending);
  if (weekDates.length === 0) return [];

  // Create uniform weekly timeline (fill gaps)
  const uniformDates: Date[] = [];
  for (let i = 0; i < weekDates.length; i++) {
    const start = weekDates[i];
    uniformDates.push(start);
    if (i < weekDates.length - 1) {
      let d = start;
      while (true) {
        const next = d3.timeWeek.offset(d, 1);
        if (+next < +weekDates[i + 1]) {
          uniformDates.push((d = next));
        } else {
          break;
        }
      }
    }
  }

  // Year-to-date counters and last known ranks
  const yearCounts = new Map<string, number>();
  const lastRank = new Map<string, number>();
  const meta = new Map<string, { title: string; artist: string }>();

  const frames: Frame[] = [];
  let currentYear: number | null = null;

  for (const date of uniformDates) {
    const y = date.getFullYear();
    const iso = fmtISO(date);

    // Reset YTD counts at year boundary
    if (currentYear === null || y !== currentYear) {
      yearCounts.clear();
      lastRank.clear();
      currentYear = y;
    }

    // Rows for this real week (may be empty if we filled a gap)
    const rows = (byWeek.get(iso) ?? []).slice().sort((a, b) => d3.ascending(a.rank, b.rank));
    const rowMap = new Map(rows.map((r) => [r.id, r]));

    // Update counters/metadata for songs present this week
    for (const r of rows) {
      if (!meta.has(r.id)) meta.set(r.id, { title: r.title, artist: r.artist });
      lastRank.set(r.id, r.rank);
      yearCounts.set(r.id, (yearCounts.get(r.id) ?? 0) + 1);
    }

    // Candidate pool
    const ids = new Set<string>();
    if (poolMode === 'file') {
      metaAll.forEach((_, id) => ids.add(id)); // all songs in filtered CSV
    } else {
      // this year only, but include carry-in so baselines can show up at Week 1
      yearCounts.forEach((_, id) => ids.add(id));
      carryIn?.forEach((_, id) => ids.add(id));
    }

    // Build candidates
    const candidates: any[] = [];
    ids.forEach((id) => {
      let displayMeta = meta.get(id) ?? metaAll.get(id);
      if (!displayMeta) {
        // Fallback: derive from the normalized id "<title> — <artistNormalized>"
        const parts = id.split(" — ");
        displayMeta = { title: parts[0] ?? id, artist: parts[1] ?? "" };
      }

      const inThisWeek = rowMap.has(id);
      const rankThisWeek = inThisWeek ? rowMap.get(id)!.rank : null;
      const rankForTie = inThisWeek ? (rankThisWeek as number) : (lastRank.get(id) ?? Number.POSITIVE_INFINITY);

      const valYTD = yearCounts.get(id) ?? 0; // weeks THIS year so far
      const base = carryIn?.get(id) ?? 0;     // weeks in rolling window before Jan 1
      const valWindow = base + valYTD;        // window total (display when metric=window)
      const valLifetime = lifetimeMap?.get(id) ?? (base + valYTD);

      const value =
        metricMode === 'ytd' ? valYTD : metricMode === 'lifetime' ? valLifetime : valWindow;

      candidates.push({
        week: iso,
        rank: rankForTie,
        rankThisWeek,
        title: displayMeta.title,
        artist: displayMeta.artist,
        last_week: null,
        peak: null,
        weeks: 0,
        id,
        value,               // drives width + sorting
        valueYear: valYTD,   // YTD
        valueWindow: valWindow,
        valueLifetime: valLifetime,
      });
    });

    // Sort by selected metric desc, tie-break by rank asc
    candidates.sort((a, b) => d3.descending(a.value, b.value) || d3.ascending(a.rank, b.rank));

    frames.push({ week: iso, entries: candidates.slice(0, topN) });
  }

  return frames;
}

// ------------------------- Bar Race Component -------------------------
type RaceProps = {
  frames: Frame[];
  width?: number;
  height?: number;
  frameMs?: number; // ms per frame
  autoplay?: boolean;
};

const BillboardBarRace: React.FC<RaceProps> = ({
  frames,
  width = 960,
  height = 540,
  frameMs = 1000,
  autoplay = true,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const priorAutoplayRef = useRef<boolean>(autoplay);

  // Determine end index for the first calendar year present in frames
  const yearStart = useMemo(() => (frames.length ? extractYear(frames[0].week) : NaN), [frames]);
  const endIdx = useMemo(() => {
    if (!frames.length || !Number.isFinite(yearStart)) return Math.max(0, frames.length - 1);
    let idx = frames.length - 1;
    for (let i = 0; i < frames.length; i++) {
      const y = extractYear(frames[i].week);
      if (Number.isFinite(y) && y !== yearStart) {
        idx = i - 1; // last frame that still belongs to the first year
        break;
      }
      if (i === frames.length - 1) idx = i;
    }
    return Math.max(0, idx);
  }, [frames, yearStart]);

  // autoplay tick (halts at end of first year)
  useEffect(() => {
    if (!autoplay || frames.length === 0 || isScrubbing) return;
    if (frameIdx >= endIdx) {
      setFrameIdx(0);
    }
    const id = setInterval(() => {
      setFrameIdx((prev) => {
        if (prev >= endIdx) {
          clearInterval(id); // halt on last frame of the year
          return prev;
        }
        return prev + 1;
      });
    }, frameMs);
    return () => clearInterval(id);
  }, [autoplay, frameMs, frames, endIdx, isScrubbing]);

  useEffect(() => {
    const div = document.createElement("div");
    div.style.position = "absolute";
    div.style.pointerEvents = "none";
    div.style.padding = "8px 10px";
    div.style.font = "12px/1.35 system-ui, sans-serif";
    div.style.background = "rgba(255,255,255,0.98)";
    div.style.border = "1px solid #d1d5db";
    div.style.borderRadius = "6px";
    div.style.boxShadow = "0 4px 12px rgba(0,0,0,0.12)";
    div.style.color = "#111827";
    div.style.zIndex = "9999";
    div.style.display = "none";
    document.body.appendChild(div);
    tooltipRef.current = div;
    return () => {
      tooltipRef.current = null;
      div.remove();
    };
  }, []);

  useEffect(() => {
    if (!svgRef.current || !gRef.current || frames.length === 0) return;

    const margin = { top: 32, right: 140, bottom: 28, left: 180 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = d3
      .select(svgRef.current)
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", "Billboard bar chart race");

    const g = d3
      .select(gRef.current)
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const cur = frames[frameIdx];
    const prev = frames[(frameIdx - 1 + frames.length) % frames.length];

    const prevMap = new Map(prev.entries.map((d) => [d.id, d]));
    const yearMaxValue = Math.max(
      1,
      d3.max(frames.slice(0, endIdx + 1), (f) => d3.max(f.entries, (d: any) => d.value) as number) || 1
    );
    const x = d3.scaleLinear().domain([0, yearMaxValue]).range([0, innerW]);

    const y = d3
      .scaleBand<string>()
      .domain(cur.entries.map((d) => d.id))
      .range([0, innerH])
      .padding(0.12);

    // Build a per-frame palette with unique colors per BAR (song id), not per artist.
    // Guarantees at least 30 distinct colors; extends palette with Sinebow sampling if needed.
    const curIDs = cur.entries.map((d: any) => d.id);
    const BASE = Array.from(new Set([
      ...d3.schemeTableau10,
      ...d3.schemeSet3,
      ...d3.schemePaired,
      ...d3.schemeSet2,
      ...d3.schemeDark2,
    ]));
    let needed = Math.max(30, curIDs.length);
    let palette = BASE.slice(0, Math.min(BASE.length, needed));
    if (palette.length < needed) {
      const extraN = needed - palette.length;
      const extra = d3.range(extraN).map((i) => d3.interpolateSinebow((i + 1) / (extraN + 1)));
      palette = palette.concat(extra);
    }
    const color = d3
      .scaleOrdinal<string, string>(palette as string[])
      .domain(curIDs)
      .unknown('#9CA3AF');

    const tooltipSel = tooltipRef.current ? d3.select(tooltipRef.current) : null;
    const positionTooltip = (event: MouseEvent) => {
      if (!tooltipSel) return;
      const node = tooltipSel.node() as HTMLDivElement | null;
      const tooltipWidth = node?.offsetWidth ?? 0;
      const tooltipHeight = node?.offsetHeight ?? 0;
      const margin = 16;
      const x = Math.min(window.scrollX + window.innerWidth - tooltipWidth - margin, event.pageX + 16);
      const y = Math.min(window.scrollY + window.innerHeight - tooltipHeight - margin, event.pageY + 12);
      tooltipSel
        .style("left", `${Math.max(window.scrollX + 8, x)}px`)
        .style("top", `${Math.max(window.scrollY + 8, y)}px`);
    };

    const formatTooltipHtml = (datum: any) => {
      const title = escapeHtml(datum?.title ?? "");
      const artist = escapeHtml(datum?.artist ?? "");
      const vy = datum?.valueYear ?? 0;
      const vw = datum?.valueWindow ?? 0;
      const vl = datum?.valueLifetime ?? 0;
      const rk = datum?.rankThisWeek;
      const lines: string[] = [
        `<div><strong>This year:</strong> ${vy} week${vy === 1 ? "" : "s"}</div>`,
        `<div><strong>Window:</strong> ${vw} week${vw === 1 ? "" : "s"}</div>`,
        `<div><strong>Lifetime:</strong> ${vl} week${vl === 1 ? "" : "s"}</div>`
      ];
      if (rk != null && Number.isFinite(rk)) {
        lines.push(`<div><strong>Rank this week:</strong> #${rk}</div>`);
      }
      const artistRow = artist ? `<div style="color:#4b5563;margin-bottom:6px;">${artist}</div>` : "";
      return `
        <div style="font-weight:600;font-size:13px;margin-bottom:2px;">${title}</div>
        ${artistRow}
        <div style="font-size:12px;color:#111827;display:grid;gap:2px;">${lines.join("")}</div>
      `;
    };

    const showTooltip = (event: MouseEvent, datum: any) => {
      if (!tooltipSel) return;
      tooltipSel
        .style("display", "block")
        .style("opacity", "1")
        .html(formatTooltipHtml(datum));
      positionTooltip(event);
    };

    const hideTooltip = () => {
      if (!tooltipSel) return;
      tooltipSel.style("opacity", "0").style("display", "none");
    };

    const updateLabelSelection = (sel: d3.Selection<SVGTextElement, any, any, any>) => {
      sel.each(function (d: any) {
        const availableWidth = Math.max(0, x(d.value) - LABEL_INNER_PADDING);
        formatLabelText(this as SVGTextElement, d, availableWidth);
      });
    };

    // X axis
    const axisX = g.selectAll<SVGGElement, unknown>("g.x-axis").data([0]);
    axisX
      .join((enter) =>
        enter.append("g").attr("class", "x-axis").attr("transform", `translate(0,0)`)
      )
      .transition()
      .duration(Math.max(200, Math.min(frameMs - 100, 800)))
      .call(d3.axisTop(x).ticks(width < 700 ? 4 : 8).tickSizeOuter(0));

    // Y grid
    const gridY = g.selectAll<SVGGElement, unknown>("g.y-grid").data([0]);
    gridY
      .join((enter) => enter.append("g").attr("class", "y-grid"))
      .transition()
      .duration(Math.max(200, Math.min(frameMs - 100, 800)))
      .call(
        d3
          .axisLeft(y)
          .tickFormat(() => "")
          .tickSize(-innerW)
          .tickSizeOuter(0)
      )
      .selectAll("line")
      .attr("stroke", "#e5e7eb");

    // JOIN rows
    const rowSel = g.selectAll<SVGGElement, any>("g.row").data(cur.entries, (d: any) => d.id);

    // ENTER
    const rowEnter = rowSel
      .enter()
      .append("g")
      .attr("class", "row")
      .attr("width", (d: any) => {
        const p = prevMap.get(d.id);
        const w = p ? x((p as any).value) : 0;
        return Math.max(0.001, Number.isFinite(w) ? w : 0);
      });

    rowEnter
      .append("rect")
      .attr("height", y.bandwidth())
      .attr("fill", (d: any) => color(d.id))
      .attr("rx", 6)
      .attr("width", (d: any) => {
        const p = prevMap.get(d.id);
        return p ? x((p as any).value) : 2;
      });

    // Combined title + artist with tspans: Title (bold) + " by Artist" (smaller, thinner)
    const labelEnter = rowEnter
      .append("text")
      .attr("class", "label-main")
      .attr("x", 8)
      .attr("y", y.bandwidth() / 2)
      .attr("dy", "0.35em")
      .attr("font-size", 12)
      .attr("fill", "#111");

    updateLabelSelection(labelEnter);

    // UPDATE + ENTER merge
    const rowMerge = rowEnter.merge(rowSel as any);

    rowMerge
      .transition()
      .duration(Math.max(200, Math.min(frameMs - 100, 800)))
      .ease(d3.easeCubicInOut)
      .attr("transform", (d: any) => `translate(0,${y(d.id) ?? 0})`);

    rowMerge
      .select("rect")
      .transition()
      .duration(Math.max(200, Math.min(frameMs - 100, 800)))
      .ease(d3.easeCubicInOut)
      .attr("fill", (d: any) => color(d.id))
      .attr("width", (d: any) => x(d.value))
      .attr("height", y.bandwidth());

    updateLabelSelection(rowMerge.select<SVGTextElement>("text.label-main"));

    rowMerge
      .on("mouseenter.tooltip", function (event: MouseEvent, datum: any) {
        showTooltip(event, datum);
      })
      .on("mousemove.tooltip", function (event: MouseEvent) {
        positionTooltip(event);
      })
      .on("mouseleave.tooltip", function () {
        hideTooltip();
      });
    // EXIT
    rowSel
      .exit()
      .transition()
      .duration(500)
      .style("opacity", 0)
      .remove();

    // Week caption
    const caption = svg.selectAll("text.week-caption").data([cur.week]);
    caption
      .join(
        (enter) =>
          enter
            .append("text")
            .attr("class", "week-caption")
            .attr("x", width - 10)
            .attr("y", height - 10)
            .attr("text-anchor", "end")
            .attr("font", "600 12px system-ui, sans-serif")
            .attr("fill", "#E5E7EB")
            .attr("opacity", 0)
            .text((d) => d)
            .transition()
            .duration(400)
            .attr("opacity", 1),
        (update) => update.transition().duration(400).text((d) => d)
      );

    return () => {
      hideTooltip();
    };
  }, [frameIdx, frames, width, height]);

  if (frames.length === 0) {
    return <div style={{ padding: 12 }}>No frames found.</div>;
  }

  return (
    <div style={{ width: "100%", maxWidth: width, margin: "0 auto" }}>
      <svg ref={svgRef} style={{ width: "100%", height }}>
        <g ref={gRef} />
      </svg>
      <div className="mt-2 flex items-center gap-3 text-xs text-slate-100 sm:text-sm">
        <label className="flex flex-1 items-center gap-2">
          <span className="flex items-center gap-1">
            Week
            <InfoTip message="Drag to scrub through frames. Release to continue animation from the chosen point." />
          </span>
          <input
            type="range"
            min={0}
            max={endIdx}
            value={Math.min(frameIdx, endIdx)}
            className="flex-1 accent-indigo-400"
            onMouseDown={() => {
              priorAutoplayRef.current = autoplay;
              setIsScrubbing(true);
            }}
            onChange={(e) => setFrameIdx(Math.max(0, Math.min(endIdx, Number(e.target.value))))}
            onMouseUp={() => {
              setIsScrubbing(false);
              // If autoplay is enabled, the interval effect will restart automatically
            }}
            onTouchStart={() => {
              priorAutoplayRef.current = autoplay;
              setIsScrubbing(true);
            }}
            onTouchEnd={() => setIsScrubbing(false)}
          />
        </label>
        <span className="whitespace-nowrap text-slate-200" title="Current frame in the year range">
          {`Week ${Math.min(frameIdx + 1, endIdx + 1)} / ${endIdx + 1} — ${frames[Math.min(frameIdx, endIdx)]?.week}`}
        </span>
      </div>
    </div>
  );
};

// ------------------------- App -------------------------
export default function App() {
  const [rawRows, setRawRows] = useState<Row[] | null>(null);
  const [topN, setTopN] = useState(15);
  const [frameMs, setFrameMs] = useState(900);
  const [autoplay, setAutoplay] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [startYear, setStartYear] = useState<number | null>(null);
  const [rollingWeeks, setRollingWeeks] = useState<number>(52);
  const [metricMode, setMetricMode] = useState<'ytd' | 'window' | 'lifetime'>('window');
  const [poolMode, setPoolMode] = useState<'year' | 'file'>('year');
  const [raceKey, setRaceKey] = useState(0);
  const triggerRemount = React.useCallback(() => setRaceKey((k) => k + 1), []);

  // Helper to pause and restart autoplay after a short delay (for control changes)
  const restartTimerRef = useRef<number | null>(null);
  const pauseAndRestart = React.useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    const shouldResume = autoplay;
    // pause playback and reset position
    setAutoplay(false);
    // allow React to flush state; then restart if it was running
    restartTimerRef.current = window.setTimeout(() => {
      if (shouldResume) setAutoplay(true);
    }, 600);
  }, [autoplay]);

  useEffect(() => () => {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
  }, []);

  // Load Hot 100 CSV by default (fallback to demo if fetch fails)
  useEffect(() => {
    (async () => {
      try {
        const rows = await d3.csv<Row>(hot100Url);
        setRawRows(rows);
        setLoadError(null);
      } catch (e: any) {
        console.warn("Failed to load assets/hot-100-current.csv, falling back to DEMO_CSV", e);
        try {
          const rows = parseCsvText(DEMO_CSV);
          setRawRows(rows);
          setLoadError(null);
        } catch (ee: any) {
          setLoadError(String(ee));
        }
      }
    })();
  }, []);

  const parsed = useMemo(() => (rawRows ? coerceRows(rawRows) : []), [rawRows]);

  // derive year range from data
  const years = useMemo(() => parsed.map((r) => extractYear(r.week)).filter((y) => Number.isFinite(y)) as number[], [parsed]);
  const minYear = useMemo(() => (years.length ? d3.min(years)! : undefined), [years]);
  const maxYear = useMemo(() => (years.length ? d3.max(years)! : undefined), [years]);

  // initialize/reset startYear to minYear when data changes or if out of range
  useEffect(() => {
    if (minYear != null && (startYear == null || startYear < minYear || (maxYear != null && startYear > maxYear))) {
      setStartYear(maxYear);
    }
  }, [minYear, maxYear]);

  // filter rows by starting year (inclusive)
  const parsedFiltered = useMemo(
    () =>
      parsed.filter((d) => {
        const y = extractYear(d.week);
        return startYear == null || !Number.isFinite(y) ? true : y >= startYear;
      }),
    [parsed, startYear]
  );

  const carryIn = useMemo(() => computeCarryIn(parsed, startYear, rollingWeeks), [parsed, startYear, rollingWeeks]);
  const lifetime = useMemo(() => computeLifetime(parsed), [parsed]);
  const frames = useMemo(
    () => makeFrames(parsedFiltered, topN, carryIn, lifetime, metricMode, poolMode, parsed),
    [parsedFiltered, topN, carryIn, lifetime, metricMode, poolMode, parsed]
  );

  const handleFile = async (file: File) => {
    const text = await file.text();
    try {
      const rows = parseCsvText(text);
      setRawRows(rows);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(String(e));
    }
  };

  const controlLabelClass = "flex items-center gap-2 text-sm text-slate-100";
  const selectClass =
    "ml-2 h-7 rounded-md border border-slate-600 bg-slate-800/80 px-2 text-sm text-slate-100 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400";
  const checkboxClass =
    "h-4 w-4 rounded border-slate-500 bg-slate-800 text-indigo-400 focus:ring-indigo-400 focus:ring-offset-0";

  return (
    <div className="p-4 font-sans text-slate-100">
      <h1 className="mb-2 text-2xl font-semibold text-white sm:text-3xl">
        Longest Charting Billboard Hot 100™ Songs Anually (Top {topN})
      </h1>
      <p className="mb-3  text-sm leading-relaxed text-slate-200 ">
        Bars use the selected metric for <strong>length &amp; sorting</strong> — choose <em>YTD</em>, <em>Window total (carry‑in + YTD)</em>, or <em>Lifetime (in this CSV)</em>. <strong>Pool</strong> controls which songs are considered: <em>This year only</em> (appearing this year or with carry‑in) or <em>Whole file</em> (all rows in the CSV). Artist names are normalized (feat./ft./with/x) so lifetime isn’t split across credit variants. X‑axis auto‑scales to the maximum value within the selected year.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-slate-100">
        <label className={controlLabelClass}>
          <input
            type="checkbox"
            checked={autoplay}
            className={checkboxClass}
            onChange={(e) => {
              setAutoplay(e.target.checked);
              triggerRemount();
            }}
          />
          <span className="flex items-center gap-1">
            Autoplay
            <InfoTip message="Automatically advance frames across the selected year." />
          </span>
        </label>

        <label className={controlLabelClass}>
          <span className="flex items-center gap-1">
            Animation Speed
            <InfoTip message="Milliseconds each frame remains on screen while autoplay runs." />
          </span>
          <select
            value={frameMs}
            className={selectClass}
            onChange={(e) => {
              setFrameMs(Number(e.target.value));
              pauseAndRestart();
              triggerRemount();
            }}
          >
            {[300, 500, 700, 900, 1200, 1500, 2000].map(ms => (
              <option key={ms} value={ms}>{ms} ms</option>
            ))}
          </select>
        </label>

        <label className={controlLabelClass}>
          <span className="flex items-center gap-1">
            Show Top
            <InfoTip message="Controls how many songs appear in each frame." />
          </span>
          <select
            value={topN}
            className={selectClass}
            onChange={(e) => {
              const n = Number(e.target.value);
              setTopN(n);
              triggerRemount(); // 🚀 force BillboardBarRace remount to avoid artifacts
              pauseAndRestart();         // ⏸️ brief pause then resume autoplay
            }}
          >
            {[5, 10, 15, 20, 25, 30].map(n => (
              <option key={n} value={n}>{n + " Songs"}</option>
            ))}
          </select>
        </label>

        <label className={controlLabelClass}>
          <span className="flex items-center gap-1">
            Year
            <InfoTip message="Select calendar year to be included in the animation timeline." />
          </span>
          <select
            value={startYear ?? ''}
            className={selectClass}
            onChange={(e) => {
              const v = Number(e.target.value);
              setStartYear(Number.isFinite(v) ? v : null);
              pauseAndRestart();
              triggerRemount();
            }}
            disabled={minYear == null || maxYear == null}
          >
            {minYear != null && maxYear != null &&
              Array.from({ length: (maxYear - minYear + 1) }, (_, i) => maxYear - i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
          </select>
        </label>

        <label className={controlLabelClass}>
          <span className="flex items-center gap-1">
            Carry‑in
            <InfoTip message="Weeks counted before Jan 1 of selected year to add a rolling baseline. Use 0 for pure Year-to-date (YTD) totals." />
          </span>
          <select
            value={rollingWeeks}
            className={selectClass}
            onChange={(e) => {
              setRollingWeeks(Number(e.target.value));
              pauseAndRestart();
              triggerRemount();
            }}
          >
            {[0, 13, 26, 52, 104, 520].map(w => (
              <option key={w} value={w}>{w} weeks</option>
            ))}
          </select>
        </label>

        <label className={controlLabelClass}>
          <span className="flex items-center gap-1">
            Visualization Metric
            <InfoTip
              message={`Defines the value that ranks songs and sizes bars:\n1. Selected YTD: Weeks in ${startYear ?? 'the selected year'} only.
2. Window total: Carry-in (${rollingWeeks} weeks) + selected year's weeks.
3. Lifetime: Include every week from 1958 onward (ignores selected year & carry-in).`}
            />             </span>
          <select
            value={metricMode}
            className={selectClass}
            onChange={(e) => {
              setMetricMode(e.target.value as 'ytd' | 'window' | 'lifetime');
              triggerRemount();
            }}
          >
            <option value="ytd">Selected YTD</option>
            <option value="window">Window Total</option>
            <option value="lifetime">Lifetime</option>
          </select>
        </label>

        <label className={controlLabelClass}>
          <span className="flex items-center gap-1">
            Pool
            <InfoTip
              message={`Defines which songs are included in the race:\n1. Selected Year: Limit entries to songs active in ${startYear ?? 'the selected year.'}.\n2. Lifetime: Include every song from 1958 onward.`}
            />          </span>
          <select
            value={poolMode}
            className={selectClass}
            onChange={(e) => {
              setPoolMode(e.target.value as 'year' | 'file');
              triggerRemount();
            }}
          >
            <option value="year">Selected Year</option>
            <option value="file">Lifetime</option>
          </select>
        </label>
        {loadError && <span className="text-xs font-medium text-rose-300">Failed to load CSV: {loadError}</span>}
      </div>

      <BillboardBarRace key={`race-${raceKey}`} frames={frames} frameMs={frameMs} autoplay={autoplay} />
    </div>
  );
}
