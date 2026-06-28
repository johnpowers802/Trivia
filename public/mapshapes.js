/* ============================================================
   public/mapshapes.js — geographic territory shapes for the map.
   Each territory is a filled polygon (low-poly landmass). Same-
   continent neighbors share borders; true sea crossings are drawn
   as dotted routes. Badge centers are the polygon centroids.
   viewBox: 0 0 1700 950.
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TriviaRiskShapes = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // Polygon vertices per territory (clockwise).
  const POLY = {
    // ---- North America ----
    alaska: [[40, 175], [165, 95], [178, 235], [45, 315]],
    northwest_territory: [[165, 95], [300, 95], [300, 240], [178, 235]],
    greenland: [[470, 90], [600, 82], [620, 190], [495, 210]],
    alberta: [[178, 235], [300, 240], [248, 360], [110, 375]],
    ontario: [[300, 240], [420, 255], [382, 372], [248, 360]],
    quebec: [[420, 255], [505, 250], [460, 372], [382, 372]],
    western_us: [[110, 375], [248, 360], [332, 490], [215, 495]],
    eastern_us: [[248, 360], [382, 372], [460, 372], [332, 490]],
    central_america: [[215, 495], [332, 490], [360, 560], [270, 575]],

    // ---- South America ----
    venezuela: [[330, 560], [470, 548], [475, 650], [360, 668]],
    peru: [[360, 668], [455, 655], [430, 805], [325, 795]],
    brazil: [[455, 655], [580, 665], [555, 800], [430, 805]],
    argentina: [[345, 805], [450, 805], [440, 915], [360, 915]],

    // ---- Europe ----
    iceland: [[660, 205], [725, 200], [730, 268], [665, 272]],
    great_britain: [[650, 305], [748, 305], [750, 408], [652, 405]],
    scandinavia: [[815, 110], [940, 110], [930, 235], [810, 232]],
    northern_europe: [[810, 235], [930, 238], [925, 360], [805, 356]],
    western_europe: [[745, 362], [860, 362], [850, 475], [748, 465]],
    southern_europe: [[865, 360], [928, 360], [962, 475], [858, 475]],
    ukraine: [[945, 118], [1085, 150], [1065, 368], [932, 360]],

    // ---- Africa ----
    north_africa: [[728, 505], [875, 505], [860, 652], [748, 642]],
    egypt: [[882, 500], [958, 505], [948, 645], [866, 652]],
    east_africa: [[868, 656], [978, 650], [1002, 782], [902, 772]],
    congo: [[748, 648], [862, 656], [888, 792], [762, 782]],
    south_africa: [[782, 795], [895, 792], [872, 902], [802, 902]],
    madagascar: [[1010, 762], [1062, 757], [1066, 858], [1016, 862]],

    // ---- Asia ----
    ural: [[1090, 160], [1182, 160], [1176, 360], [1086, 355]],
    siberia: [[1186, 112], [1322, 112], [1316, 250], [1180, 250]],
    yakutsk: [[1326, 96], [1452, 96], [1448, 212], [1320, 212]],
    kamchatka: [[1458, 102], [1602, 112], [1592, 312], [1452, 292]],
    irkutsk: [[1322, 255], [1448, 250], [1444, 335], [1318, 338]],
    mongolia: [[1318, 342], [1446, 338], [1440, 468], [1312, 462]],
    japan: [[1612, 330], [1666, 335], [1660, 448], [1606, 442]],
    afghanistan: [[1090, 362], [1186, 362], [1180, 500], [1086, 492]],
    china: [[1255, 405], [1385, 405], [1372, 545], [1252, 535]],
    middle_east: [[1086, 495], [1190, 495], [1186, 628], [1082, 618]],
    india: [[1194, 500], [1295, 505], [1286, 632], [1190, 622]],
    siam: [[1390, 470], [1452, 475], [1444, 602], [1380, 598]],

    // ---- Australia ----
    indonesia: [[1392, 665], [1492, 665], [1482, 762], [1388, 756]],
    new_guinea: [[1520, 660], [1620, 665], [1610, 758], [1515, 752]],
    western_australia: [[1410, 792], [1512, 792], [1502, 895], [1416, 890]],
    eastern_australia: [[1542, 792], [1642, 792], [1632, 898], [1547, 892]],
  };

  // True sea crossings (drawn as dotted routes between centroids).
  const SEA_ROUTES = [
    ["alaska", "kamchatka"],
    ["greenland", "northwest_territory"],
    ["greenland", "quebec"],
    ["greenland", "iceland"],
    ["iceland", "great_britain"],
    ["iceland", "scandinavia"],
    ["great_britain", "scandinavia"],
    ["great_britain", "northern_europe"],
    ["great_britain", "western_europe"],
    ["central_america", "venezuela"],
    ["brazil", "north_africa"],
    ["western_europe", "north_africa"],
    ["southern_europe", "north_africa"],
    ["southern_europe", "egypt"],
    ["egypt", "middle_east"],
    ["east_africa", "middle_east"],
    ["east_africa", "madagascar"],
    ["south_africa", "madagascar"],
    ["siam", "indonesia"],
    ["indonesia", "new_guinea"],
    ["indonesia", "western_australia"],
    ["new_guinea", "eastern_australia"],
    ["new_guinea", "western_australia"],
    ["japan", "kamchatka"],
    ["japan", "mongolia"],
  ];

  const PATHS = {};
  const LABELS = {};
  for (const id in POLY) {
    const pts = POLY[id];
    PATHS[id] = "M" + pts.map((p) => p[0] + "," + p[1]).join(" L") + " Z";
    const sum = pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
    LABELS[id] = [Math.round(sum[0] / pts.length), Math.round(sum[1] / pts.length)];
  }

  return { POLY, PATHS, LABELS, SEA_ROUTES, VIEWBOX: [1700, 950] };
});
