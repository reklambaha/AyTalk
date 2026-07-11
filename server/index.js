const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("AyTalk Server is Running 🚀");
});

app.listen(3000, () => {
    console.log("AyTalk Server Started");
    console.log("http://localhost:3000");
});