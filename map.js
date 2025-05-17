import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1IjoianV5MDM3IiwiYSI6ImNtYXEzdmtucjA1emYyam9lcHlrNDdoYmgifQ.4FnKnzNHMTpKTntPwuIFBA';

// ✅ Use the correct custom style URL (no .html, no preview params)
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});


function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
    const { x, y } = map.project(point); // Project to pixel coordinates
    return { cx: x, cy: y }; // Return as object for use in SVG attributes
}

// Converts minutes since midnight (or –1) into "h:mm AM/PM"
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
  return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

function computeStationTraffic(stations, trips) {
  // roll up departures
  const departures = d3.rollup(
    trips,
    v => v.length,
    d => d.start_station_id
  );

  // roll up arrivals
  const arrivals = d3.rollup(
    trips,
    v => v.length,
    d => d.end_station_id
  );

  // annotate each station & return the new array
  return stations.map(station => {
    const id = station.short_name;      // e.g. "A32000"
    station.arrivals     = arrivals.get(id)    ?? 0;
    station.departures   = departures.get(id)  ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}


map.on('load', async () => { 
    let timeFilter = -1;
    console.log('Map has loaded');
  
    // Add Boston bike lane source & layer
    map.addSource('boston_route', {
      type: 'geojson',
      data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
    });
  
    map.addLayer({
      id: 'bike-lane-dots-boston',
      type: 'line',
      source: 'boston_route',
      paint: {
        'line-width': 3,
        'line-color': '#00ff00', 
        'line-opacity': 0.5,
      },
    });
  
    // Add Cambridge bike lane source & layer
    map.addSource('cambridge_route', {
      type: 'geojson',
      data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
    });
  
    map.addLayer({
      id: 'bike-lane-dots-cambridge',
      type: 'line',
      source: 'cambridge_route',
      paint: {
        'line-width': 3,
        'line-color': '#ff00ff', 
        'line-opacity': 0.5,
      },
    });
    console.log('highligh bike lane');

    //DO NOT MODIFY loda station
    const raw    = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
    const trips = await d3.csv(
        'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
        (trip) => {
          trip.started_at = new Date(trip.started_at);
          trip.ended_at = new Date(trip.ended_at);
          return trip;
        },
      );
    
    let stations = computeStationTraffic(raw.data.stations, trips);
    console.log('station loaded:', stations.length);
    console.log('Trips loaded:', trips.length);

    const departures = d3.rollup(
        trips,
        (v) => v.length,
        (d) => d.start_station_id,
      );
    
    const arrivals = d3.rollup(
        trips,
        (v) => v.length,
        (d) => d.end_station_id
    );

    stations = stations.map((station) => {
        let id = station.short_name;
        station.arrivals = arrivals.get(id) ?? 0;
        station.departures = departures.get(id) ?? 0;
        station.totalTraffic = station.arrivals + station.departures;
        return station;
    
    });
    let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);


    const svg = d3
      .select(map.getCanvasContainer())  // Mapbox’s built-in overlay layer
      .append('svg')
      .attr('id', 'overlay')
      .style('position','absolute')
      .style('top', 0)
      .style('left',0)
      .style('width','100%')
      .style('height','100%')
      .style('pointer-events','none');

    const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

    const circles = svg
    .selectAll('circle')
    .data(stations, d => d.short_name)
    .enter()
    .append('circle')
      .attr('r',           d => radiusScale(d.totalTraffic))
      .attr('fill',        'steelblue')
      .attr('stroke',      'white')
      .attr('stroke-width', 1)
      .attr('opacity',     0.8)
    .each(function(d) {
      const sel = d3.select(this);
      // 1) append <title>
      sel.append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
      // 2) set departure-ratio CSS custom property
      sel.style('--departure-ratio', stationFlow(d.departures / d.totalTraffic));
    });


    const timeSlider    = document.getElementById('minute-slider');
    const selectedTime  = document.getElementById('selected-time');
    const anyTimeLabel  = document.getElementById('any-time-label');   
    

    function updateScatterPlot(timeFilter) {
      // 1) filter trips
      const filteredTrips    = filterTripsbyTime(trips, timeFilter);
    
      // 2) recompute station traffic
      const filteredStations = computeStationTraffic(stations, filteredTrips);
    
      // 3) bump up/down your size range
      if (timeFilter === -1) {
        radiusScale.range([0, 25]);
      } else {
        radiusScale.range([3, 50]);
      }
    
      // 4) rebind & update circles – keep the chain continuous
      svg.selectAll('circle')
        .data(filteredStations, d => d.short_name)
        .join('circle')
          .attr('r', d => radiusScale(d.totalTraffic))      // no semicolon here!
          .style(
            '--departure-ratio',
            d => stationFlow(d.departures / d.totalTraffic)
          );
    }
    

    function updateTimeDisplay() {
      timeFilter = Number(timeSlider.value);
    
      if (timeFilter === -1) {
        selectedTime.textContent   = '';
        anyTimeLabel.style.display = 'inline';
      } else {
        selectedTime.textContent   = formatTime(timeFilter);
        anyTimeLabel.style.display = 'none';
      }
    
      updateScatterPlot(timeFilter)
    }
    function minutesSinceMidnight(date) {
      return date.getHours() * 60 + date.getMinutes();
    }
    function filterTripsbyTime(trips, timeFilter) {
      return timeFilter === -1
        ? trips // If no filter is applied (-1), return all trips
        : trips.filter((trip) => {
            // Convert trip start and end times to minutes since midnight
            const startedMinutes = minutesSinceMidnight(trip.started_at);
            const endedMinutes = minutesSinceMidnight(trip.ended_at);
    
            // Include trips that started or ended within 60 minutes of the selected time
            return (
              Math.abs(startedMinutes - timeFilter) <= 60 ||
              Math.abs(endedMinutes - timeFilter) <= 60
            );
          });
    }

    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay();

    console.log('declare');



    function updatePositions() {
        circles
          .attr('cx', (d) => getCoords(d).cx) // Set the x-position using projected coordinates
          .attr('cy', (d) => getCoords(d).cy); // Set the y-position using projected coordinates
      }
      
      // Initial position update when map loads
    updatePositions();
    
    map.on('move', updatePositions); // Update during map movement
    map.on('zoom', updatePositions); // Update during zooming
    map.on('resize', updatePositions); // Update on window resize
    map.on('moveend', updatePositions); // Final adjustment after movement ends

});  

