const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

app.get("/api/geocode", async (req, res) => {
  try {
    const q = String(req.query.q || "");
    if (!q) return res.status(400).json({ error: "missing q" });

    const url =
  "https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&countrycodes=at&accept-language=de&q=" +
  encodeURIComponent(q);

    const r = await fetch(url, {
      headers: {
        "User-Agent": "NazarDispatch/1.0 (local demo)"
      }
    });

    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.listen(5055, () => {
  console.log("✅ Proxy running on http://127.0.0.1:5055");
});