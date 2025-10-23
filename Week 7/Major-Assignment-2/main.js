
const CONFIG = {
  files: {
    townsTopo: "data/towns.topojson",
    countyGiniCSV: "data/gini_index.csv"
  },
  columns: {
    // Town fields from your topojson:
    townName: "TOWN",
    pop1980: "POP1980",
    pop2010: "POP2010",

    // Gini CSV is LONG format:
    countyName: "Geographic Area Name",
    countyFIPS: "id",
    giniValue: "Estimate!!Gini Index",
    giniYear: "year"
  },
  // Towns have FIPS_STCO — use that to build counties
  countyFipsInTown: "FIPS_STCO",

  projection: d3.geoAlbers(),
  width: 860,
  height: 520
};

const fmt = {
  integer: d3.format(","),
  signed: d3.format("+,"),
  gini: d3.format(".3f")
};

(async function init(){
  const [townsTopo, giniRows] = await Promise.all([
    d3.json(CONFIG.files.townsTopo),
    d3.csv(CONFIG.files.countyGiniCSV, d3.autoType)
  ]);

  // --- Geo
  const townsObjName = Object.keys(townsTopo.objects)[0];
  const townsGeo = topojson.feature(townsTopo, townsTopo.objects[townsObjName]);

  // Build counties by merging towns that share FIPS_STCO
  const geoms = townsTopo.objects[townsObjName].geometries;
  const byCounty = new Map();
  for (const g of geoms) {
    const fips = g.properties?.[CONFIG.countyFipsInTown];
    if (fips == null) continue;
    const key = String(fips);
    if (!byCounty.has(key)) byCounty.set(key, []);
    byCounty.get(key).push(g);
  }
  const countyFeatures = [];
  for (const [key, arr] of byCounty.entries()) {
    const merged = topojson.merge(townsTopo, arr);
    const sample = arr[0].properties || {};
    const name = (sample.COUNTYNAME || sample.COUNTY || sample.TOWN || "County").toString();
    countyFeatures.push({
      type: "Feature",
      properties: { NAME: name, FIPS: +key },
      geometry: merged
    });
  }
  const countiesGeo = { type: "FeatureCollection", features: countyFeatures };

  // --- Projection
  const proj = CONFIG.projection.fitSize([CONFIG.width, CONFIG.height], townsGeo);
  const path = d3.geoPath(proj);

  // --- Town pop (directly from properties)
  const keyTown = s => String(s).trim().toLowerCase();
  const popByTown = new Map(townsGeo.features.map(f => {
    const nm = keyTown(f.properties?.[CONFIG.columns.townName]);
    const p80 = +f.properties?.[CONFIG.columns.pop1980] || 0;
    const p10 = +f.properties?.[CONFIG.columns.pop2010] || 0;
    return [nm, { pop1980: p80, pop2010: p10 }];
  }));

  // --- Gini (LONG format): build series by county FIPS
  const giniByFIPS = new Map();
  const giniByName = new Map();
  const normName = s => String(s||"").replace(/,\s*Massachusetts$/i,"").trim();
  for (const r of giniRows) {
    const fips = +r[CONFIG.columns.countyFIPS];
    const name = normName(r[CONFIG.columns.countyName]);
    const year = +r[CONFIG.columns.giniYear];
    const value = +r[CONFIG.columns.giniValue];
    if (!Number.isFinite(year) || !Number.isFinite(value)) continue;
    if (Number.isFinite(fips)) {
      if (!giniByFIPS.has(fips)) giniByFIPS.set(fips, []);
      giniByFIPS.get(fips).push({ year, value });
    }
    if (name) {
      const k = name.toLowerCase();
      if (!giniByName.has(k)) giniByName.set(k, []);
      giniByName.get(k).push({ year, value });
    }
  }
  for (const m of [giniByFIPS, giniByName]) {
    for (const [k, arr] of m.entries()) arr.sort((a,b)=>a.year-b.year);
  }

  // --- Color scales
  const pop1980Vals = townsGeo.features.map(f => +f.properties?.[CONFIG.columns.pop1980] || 0);
  const colorA = d3.scaleQuantize().domain(d3.extent(pop1980Vals)).range(d3.schemeBlues[7]);

  const changeVals = townsGeo.features.map(f => {
    const p80 = +f.properties?.[CONFIG.columns.pop1980] || 0;
    const p10 = +f.properties?.[CONFIG.columns.pop2010] || 0;
    return p10 - p80;
  });
  const maxAbs = d3.max(changeVals, v => Math.abs(v)) || 1;
  const colorB = d3.scaleDiverging().domain([-maxAbs,0,maxAbs]).interpolator(d3.interpolateRdBu);

  const gini2019 = [];
  for (const f of countiesGeo.features) {
    const fips = +f.properties.FIPS;
    const v = giniByFIPS.get(fips)?.find(d=>d.year===2019)?.value;
    if (Number.isFinite(v)) gini2019.push(v);
  }
  const colorC = d3.scaleSequential()
    .domain(d3.extent(gini2019))
    .interpolator(d3.interpolateSinebow);

  // --- Tooltips
  const ttTown = d3.select("#tt-town");
  const ttCounty = d3.select("#tt-county");

  // --- MAP A
  const svgA = d3.select("#mapA");
  svgA.append("g").selectAll("path")
    .data(townsGeo.features).join("path")
    .attr("class","town")
    .attr("d", path)
    .attr("fill", d => colorA(+d.properties?.[CONFIG.columns.pop1980] || 0))
    .on("mouseenter", (ev,d) => {
      const name = d.properties?.[CONFIG.columns.townName] || "Unknown";
      const p = +d.properties?.[CONFIG.columns.pop1980] || 0;
      ttTown.html(`<strong>${name}</strong><br/>1980 population: <b>${fmt.integer(p)}</b>`)
        .attr("hidden", null).style("left",(ev.clientX+14)+"px").style("top",(ev.clientY+14)+"px");
    })
    .on("mousemove", ev => ttTown.style("left",(ev.clientX+14)+"px").style("top",(ev.clientY+14)+"px"))
    .on("mouseleave", () => ttTown.attr("hidden", true));
  legendQuantize("#legendA", colorA, "Lower 1980 pop", "Higher 1980 pop");

  // --- MAP B
  const svgB = d3.select("#mapB");
  svgB.append("g").selectAll("path")
    .data(townsGeo.features).join("path")
    .attr("class","town")
    .attr("d", path)
    .attr("fill", d => {
      const p80 = +d.properties?.[CONFIG.columns.pop1980] || 0;
      const p10 = +d.properties?.[CONFIG.columns.pop2010] || 0;
      return colorB(p10 - p80);
    })
    .on("mouseenter", (ev,d) => {
      const name = d.properties?.[CONFIG.columns.townName] || "Unknown";
      const p80 = +d.properties?.[CONFIG.columns.pop1980] || 0;
      const p10 = +d.properties?.[CONFIG.columns.pop2010] || 0;
      const delta = p10 - p80;
      ttTown.html(
        `<strong>${name}</strong><br/>Change 2010–1980: <b>${fmt.signed(delta)}</b><br/>1980: ${fmt.integer(p80)} | 2010: ${fmt.integer(p10)}`
      ).attr("hidden", null).style("left",(ev.clientX+14)+"px").style("top",(ev.clientY+14)+"px");
    })
    .on("mousemove", ev => ttTown.style("left",(ev.clientX+14)+"px").style("top",(ev.clientY+14)+"px"))
    .on("mouseleave", () => ttTown.attr("hidden", true));
  legendDiverging("#legendB", colorB, "Loss", "No change", "Gain");

  // --- MAP C
  const svgC = d3.select("#mapC");
  svgC.append("g").selectAll("path")
    .data(countiesGeo.features).join("path")
    .attr("class","county")
    .attr("d", path)
    .attr("fill", d => {
      const fips = +d.properties.FIPS;
      let series = giniByFIPS.get(fips);
      if (!series) {
        const nm = (d.properties.NAME || "").toLowerCase();
        series = giniByName.get(nm) || null;
      }
      const g2019 = series?.find(s=>s.year===2019)?.value;
      return Number.isFinite(g2019) ? colorC(g2019) : "#303b78";
    })
    .on("mouseenter", (ev,d) => {
      const fips = +d.properties.FIPS;
      const nm = d.properties.NAME || "County";
      let series = giniByFIPS.get(fips) || giniByName.get((nm||"").toLowerCase()) || [];
      const curr = series.find(s=>s.year===2019);
      ttCounty.select(".tt-title").text(nm);
      ttCounty.select(".tt-value").text(curr ? `2019 Gini: ${fmt.gini(curr.value)}` : "No 2019 data");
      drawSparkline(ttCounty.select("svg.sparkline"), series);
      ttCounty.attr("hidden", null).style("left",(ev.clientX+14)+"px").style("top",(ev.clientY+14)+"px");
    })
    .on("mousemove", ev => ttCounty.style("left",(ev.clientX+14)+"px").style("top",(ev.clientY+14)+"px"))
    .on("mouseleave", () => ttCounty.attr("hidden", true));
  legendSequential("#legendC", colorC, "Lower Gini", "Higher Gini");

  // --- Legends
  function legendQuantize(sel, scale, leftLab, rightLab){
    const g = d3.select(sel).html("");
    const sw = g.append("div").attr("class","swatches");
    scale.range().forEach(c => sw.append("div").attr("class","swatch").style("background", c));
    const [min,max] = scale.domain();
    g.append("div").attr("class","labels").html(`<span>${fmt.integer(min)}</span><span>${rightLab}</span>`);
    g.insert("div",".labels").attr("class","labels").html(`<span>${leftLab}</span><span>${fmt.integer(max)}</span>`);
  }
  function legendDiverging(sel, scale, leftLab, midLab, rightLab){
    const g = d3.select(sel).html("");
    const sw = g.append("div").attr("class","swatches");
    d3.range(9).forEach(i => {
      const t = i/8;
      sw.append("div").attr("class","swatch").style("background", scale(d3.interpolate(-1,1)(t)));
    });
    g.append("div").attr("class","labels").html(`<span>${leftLab}</span><span>${midLab}</span><span>${rightLab}</span>`);
  }
  function legendSequential(sel, scale, leftLab, rightLab){
    const g = d3.select(sel).html("");
    const sw = g.append("div").attr("class","swatches");
    const [d0,d1] = scale.domain();
    d3.range(12).forEach(i => {
      const t = i/11, v = d0 + t*(d1-d0);
      sw.append("div").attr("class","swatch").style("background", scale(v));
    });
    const [min,max] = scale.domain();
    g.append("div").attr("class","labels").html(`<span>${leftLab} (${fmt.gini(min)})</span><span>${rightLab} (${fmt.gini(max)})</span>`);
  }

  // --- Sparkline for Map C tooltip
  function drawSparkline(svg, series){
    const w = +svg.attr("width"), h = +svg.attr("height");
    svg.selectAll("*").remove();
    if(!series || !series.length){
      svg.append("text").attr("x",8).attr("y",22).attr("fill","#cbd5ff").text("No Gini timeseries");
      return;
    }
    const x = d3.scaleLinear().domain(d3.extent(series, d=>d.year)).range([28, w-10]);
    const y = d3.scaleLinear().domain(d3.extent(series, d=>d.value)).nice().range([h-18, 12]);
    const line = d3.line().x(d=>x(d.year)).y(d=>y(d.value)).curve(d3.curveMonotoneX);
    const xa = d3.axisBottom(x).ticks(5).tickFormat(d3.format("d"));
    const ya = d3.axisLeft(y).ticks(4);
    svg.append("g").attr("transform",`translate(0,${h-18})`).call(xa).attr("font-size","10px").attr("color","#a9b8e8");
    svg.append("g").attr("transform","translate(28,0)").call(ya).attr("font-size","10px").attr("color","#a9b8e8");
    svg.append("path").datum(series).attr("fill","none").attr("stroke","white").attr("stroke-width",1.6).attr("d",line);
    const last = series[series.length-1];
    svg.append("circle").attr("cx",x(last.year)).attr("cy",y(last.value)).attr("r",2.6).attr("fill","white");
  }
})();
