// /api/generalSearch.js
const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');

module.exports = async (req, res) => {
  const { chemical } = req.query;
  if (!chemical) {
    return res.status(400).json({ error: 'Missing chemical parameter' });
  }
  try {
    // Convert chemical name to lowercase and replace spaces with plus signs.
    const chemForURL = chemical.toLowerCase().replace(/ /g, '+');
    const url = `https://www.ncbi.nlm.nih.gov/pccompound/?term=${chemForURL}`;
    const response = await fetch(url);
    const htmlText = await response.text();

    const dom = new JSDOM(htmlText);
    const document = dom.window.document;

    // Extract data using DOM selectors.
    const titleElements = document.querySelectorAll("p.title");
    const dlElements = document.querySelectorAll("dl.rprtid");
    let results = [];
    const count = Math.min(titleElements.length, dlElements.length);
    for (let i = 0; i < count; i++) {
      const aTag = titleElements[i].querySelector("a");
      const name = aTag ? aTag.textContent.trim() : "N/A";
      const dd = dlElements[i].querySelector("dd");
      const cid = dd ? dd.textContent.trim() : "N/A";
      results.push({ cid, name });
    }
    res.json({ results });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error fetching general search results' });
  }
};