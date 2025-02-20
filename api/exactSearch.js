export default async function handler(req, res) {
    const { chemical } = req.query;
    
    if (!chemical) {
      return res.status(400).json({ error: "Missing chemical parameter" });
    }
    
    const pubChemUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(chemical)}/cids/JSON`;
    
    try {
      const response = await fetch(pubChemUrl);
      if (!response.ok) {
        throw new Error(`PubChem API responded with status ${response.status}`);
      }
      const data = await response.json();
      return res.status(200).json(data);
    } catch (error) {
      console.error("Error fetching exact search results:", error);
      return res.status(500).json({ error: "Error fetching exact search results" });
    }
  }