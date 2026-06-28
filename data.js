/* ============================================================
   data.js — Classic Risk map: continents, territories,
   adjacencies, and SVG layout positions.
   Exposed as globals (no modules) so the game runs from file://.
   ============================================================ */

// Continents: name, army bonus, and CSS color used to tint their region.
const CONTINENTS = {
  "North America": { bonus: 5, color: "#e8b04b" },
  "South America": { bonus: 2, color: "#5fae7a" },
  "Europe":        { bonus: 5, color: "#6f9bd1" },
  "Africa":        { bonus: 3, color: "#cf7d4e" },
  "Asia":          { bonus: 7, color: "#9b6fb3" },
  "Australia":     { bonus: 2, color: "#c75f74" },
};

/* Each territory: continent, [x,y] position on a 1000x600 SVG, and
   the list of adjacent territory ids. Adjacency is symmetric — defined
   once each way for clarity and validated at load. */
const TERRITORIES = {
  // ---- North America ----
  alaska:        { name: "Alaska",            continent: "North America", pos: [60, 95],  adj: ["northwest_territory", "alberta", "kamchatka"] },
  northwest_territory: { name: "NW Territory", continent: "North America", pos: [150, 90], adj: ["alaska", "alberta", "ontario", "greenland"] },
  greenland:     { name: "Greenland",         continent: "North America", pos: [300, 55],  adj: ["northwest_territory", "ontario", "quebec", "iceland"] },
  alberta:       { name: "Alberta",           continent: "North America", pos: [135, 160], adj: ["alaska", "northwest_territory", "ontario", "western_us"] },
  ontario:       { name: "Ontario",           continent: "North America", pos: [215, 160], adj: ["northwest_territory", "alberta", "greenland", "quebec", "western_us", "eastern_us"] },
  quebec:        { name: "Quebec",            continent: "North America", pos: [295, 160], adj: ["greenland", "ontario", "eastern_us"] },
  western_us:    { name: "Western US",        continent: "North America", pos: [150, 235], adj: ["alberta", "ontario", "eastern_us", "central_america"] },
  eastern_us:    { name: "Eastern US",        continent: "North America", pos: [235, 240], adj: ["ontario", "quebec", "western_us", "central_america"] },
  central_america: { name: "Central America", continent: "North America", pos: [160, 315], adj: ["western_us", "eastern_us", "venezuela"] },

  // ---- South America ----
  venezuela:     { name: "Venezuela",         continent: "South America", pos: [235, 375], adj: ["central_america", "peru", "brazil"] },
  peru:          { name: "Peru",              continent: "South America", pos: [235, 455], adj: ["venezuela", "brazil", "argentina"] },
  brazil:        { name: "Brazil",            continent: "South America", pos: [310, 440], adj: ["venezuela", "peru", "argentina", "north_africa"] },
  argentina:     { name: "Argentina",         continent: "South America", pos: [255, 535], adj: ["peru", "brazil"] },

  // ---- Europe ----
  iceland:       { name: "Iceland",           continent: "Europe", pos: [420, 110], adj: ["greenland", "great_britain", "scandinavia"] },
  great_britain: { name: "Great Britain",     continent: "Europe", pos: [415, 190], adj: ["iceland", "scandinavia", "northern_europe", "western_europe"] },
  scandinavia:   { name: "Scandinavia",       continent: "Europe", pos: [505, 95],  adj: ["iceland", "great_britain", "northern_europe", "ukraine"] },
  northern_europe: { name: "Northern Europe", continent: "Europe", pos: [505, 175], adj: ["scandinavia", "great_britain", "western_europe", "southern_europe", "ukraine"] },
  western_europe: { name: "Western Europe",   continent: "Europe", pos: [445, 260], adj: ["great_britain", "northern_europe", "southern_europe", "north_africa"] },
  southern_europe: { name: "Southern Europe", continent: "Europe", pos: [535, 245], adj: ["northern_europe", "western_europe", "ukraine", "north_africa", "egypt", "middle_east"] },
  ukraine:       { name: "Ukraine",           continent: "Europe", pos: [600, 150], adj: ["scandinavia", "northern_europe", "southern_europe", "ural", "afghanistan", "middle_east"] },

  // ---- Africa ----
  north_africa:  { name: "North Africa",      continent: "Africa", pos: [470, 350], adj: ["brazil", "western_europe", "southern_europe", "egypt", "east_africa", "congo"] },
  egypt:         { name: "Egypt",             continent: "Africa", pos: [545, 335], adj: ["southern_europe", "north_africa", "east_africa", "middle_east"] },
  east_africa:   { name: "East Africa",       continent: "Africa", pos: [585, 410], adj: ["north_africa", "egypt", "congo", "south_africa", "madagascar", "middle_east"] },
  congo:         { name: "Congo",             continent: "Africa", pos: [540, 460], adj: ["north_africa", "east_africa", "south_africa"] },
  south_africa:  { name: "South Africa",      continent: "Africa", pos: [545, 540], adj: ["congo", "east_africa", "madagascar"] },
  madagascar:    { name: "Madagascar",        continent: "Africa", pos: [625, 520], adj: ["east_africa", "south_africa"] },

  // ---- Asia ----
  ural:          { name: "Ural",              continent: "Asia", pos: [690, 135], adj: ["ukraine", "siberia", "china", "afghanistan"] },
  siberia:       { name: "Siberia",           continent: "Asia", pos: [765, 100], adj: ["ural", "yakutsk", "irkutsk", "mongolia", "china"] },
  yakutsk:       { name: "Yakutsk",           continent: "Asia", pos: [855, 80],  adj: ["siberia", "irkutsk", "kamchatka"] },
  kamchatka:     { name: "Kamchatka",         continent: "Asia", pos: [935, 105], adj: ["yakutsk", "irkutsk", "mongolia", "japan", "alaska"] },
  irkutsk:       { name: "Irkutsk",           continent: "Asia", pos: [825, 155], adj: ["siberia", "yakutsk", "kamchatka", "mongolia"] },
  mongolia:      { name: "Mongolia",          continent: "Asia", pos: [820, 220], adj: ["siberia", "kamchatka", "irkutsk", "japan", "china"] },
  japan:         { name: "Japan",             continent: "Asia", pos: [925, 210], adj: ["kamchatka", "mongolia"] },
  afghanistan:   { name: "Afghanistan",       continent: "Asia", pos: [690, 225], adj: ["ukraine", "ural", "china", "middle_east", "india"] },
  china:         { name: "China",             continent: "Asia", pos: [785, 280], adj: ["ural", "siberia", "mongolia", "afghanistan", "india", "siam"] },
  middle_east:   { name: "Middle East",       continent: "Asia", pos: [625, 300], adj: ["southern_europe", "ukraine", "egypt", "east_africa", "afghanistan", "india"] },
  india:         { name: "India",             continent: "Asia", pos: [730, 345], adj: ["afghanistan", "china", "middle_east", "siam"] },
  siam:          { name: "Siam",              continent: "Asia", pos: [820, 350], adj: ["china", "india", "indonesia"] },

  // ---- Australia ----
  indonesia:        { name: "Indonesia",        continent: "Australia", pos: [830, 440], adj: ["siam", "new_guinea", "western_australia"] },
  new_guinea:       { name: "New Guinea",       continent: "Australia", pos: [925, 435], adj: ["indonesia", "western_australia", "eastern_australia"] },
  western_australia:{ name: "Western Australia",continent: "Australia", pos: [850, 525], adj: ["indonesia", "new_guinea", "eastern_australia"] },
  eastern_australia:{ name: "Eastern Australia",continent: "Australia", pos: [935, 525], adj: ["new_guinea", "western_australia"] },
};

// "Wrap-around" sea links drawn as dashed lines so the long edges read as intentional.
const WRAP_LINKS = [["alaska", "kamchatka"], ["brazil", "north_africa"]];

// Player colors (index 0..5).
const PLAYER_COLORS = ["#e54b4b", "#4b7fe5", "#46b06a", "#e5c84b", "#9b59b6", "#e58a3a"];
const PLAYER_NAMES_DEFAULT = ["Red", "Blue", "Green", "Gold", "Purple", "Orange"];

// Starting armies by player count (classic rules).
const START_ARMIES = { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 };

// Validate adjacency symmetry once at load (helps catch typos during edits).
(function validateAdjacency() {
  for (const id in TERRITORIES) {
    for (const n of TERRITORIES[id].adj) {
      if (!TERRITORIES[n]) { console.error(`Unknown neighbor "${n}" referenced by "${id}"`); continue; }
      if (!TERRITORIES[n].adj.includes(id)) {
        console.error(`Asymmetric adjacency: ${id} -> ${n} but not back`);
      }
    }
  }
})();
