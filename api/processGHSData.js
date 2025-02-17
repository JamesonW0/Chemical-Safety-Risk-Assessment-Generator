// /api/processGHSData.js

const express = require("express");
const fs = require("fs");
const { Document, Packer } = require("docx"); 
// Note: The "docx" library here is assumed to be extended (or replaced) by helper functions 
// that allow loading an existing DOCX from a Buffer and modifying its tables similar to python‑docx.
const { cloneDeep } = require("lodash");

const app = express();
app.use(express.json());

// Define file paths (adjust as needed)
const FORM_TEMPLATE_PATH = "/api/COSHH_Form_Template.docx";
const TICKS_TEMPLATE_PATH = "/api/COSHH_Ticks_Template.docx";

// Preload template files into memory (for efficiency)
const formTemplateBuffer = fs.readFileSync(FORM_TEMPLATE_PATH);
const ticksTemplateBuffer = fs.readFileSync(TICKS_TEMPLATE_PATH);

// Hypothetical helper function that loads a DOCX document from a Buffer.
// (You’d use a library that supports this.)
function loadDocument(buffer) {
  // For example, if your library provided Document.load, you’d call it here.
  return Document.load(buffer); // This API is assumed for demonstration.
}

// Preload the ticks document for cloning tick data.
const ticksDoc = loadDocument(ticksTemplateBuffer);

// Define hazard and exposure mappings as Sets
const hazardMappings = {
  spill: new Set([200, 201, 202, 203, 204, 205, 206, 207, 208, 230, 231, 232, 250, 251, 300, 304, 310, 330, 340, 301, 311, 331]),
  flame: new Set([200, 201, 202, 203, 204, 205, 206, 207, 208, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232,
                   240, 241, 242, 251, 252, 270, 271, 272, 280]),
  Tcontrol: new Set([200, 201, 202, 203, 204, 205, 206, 207, 208, 225, 226, 227, 228, 230, 231, 270, 271, 272]),
  pregnant: new Set([360, 361, 362]),
  water: new Set([261, 262]),
  dropwise: new Set([261, 262, 270, 271, 272]),
  air: new Set([230, 231, 232, 250]),
};

const exposureMappings = {
  eye: new Set([314, 318, 319]),
  skin: new Set([310, 311, 312, 314, 315, 317]),
  inhalation: new Set([304, 330, 331, 332, 334, 335, 336]),
  ingestion: new Set([300, 301, 302, 304]),
};

// Function to compute exposure routes and control measures from hazard statements.
function getRoutesAndMeasures(hazardStatements) {
  if (!hazardStatements || hazardStatements[0] === "N") {
    return { expRoutes: [0, 0, 0, 0], ctrlMeasures: [0, 0, 0, 0, 0, 0, 0, 0, 0] };
  }
  const lines = hazardStatements.split("\n");
  const hazardCodes = new Set();
  lines.forEach((line) => {
    line = line.trim();
    if (!line) return;
    let code = parseInt(line);
    if (isNaN(code)) {
      // Try extracting characters 1-3 (as in the Python version)
      code = parseInt(line.substring(1, 4));
    }
    if (!isNaN(code)) hazardCodes.add(code);
  });

  const expRoutes = [0, 0, 0, 0];
  // Default: control measure index 2 is set to 1.
  const ctrlMeasures = [0, 0, 1, 0, 0, 0, 0, 0, 0];

  // Update control measures based on hazardMappings
  for (const [key, mappingSet] of Object.entries(hazardMappings)) {
    for (const code of hazardCodes) {
      if (mappingSet.has(code)) {
        const idx = { spill: 0, flame: 3, Tcontrol: 4, pregnant: 5, water: 6, dropwise: 7, air: 8 }[key];
        if (idx !== undefined) ctrlMeasures[idx] = 1;
        break;
      }
    }
  }
  // Update exposure routes based on exposureMappings
  for (const [key, mappingSet] of Object.entries(exposureMappings)) {
    for (const code of hazardCodes) {
      if (mappingSet.has(code)) {
        const idx = { eye: 0, skin: 1, inhalation: 2, ingestion: 3 }[key];
        if (idx !== undefined) expRoutes[idx] = 1;
        break;
      }
    }
  }
  return { expRoutes, ctrlMeasures };
}

// Prepare a new COSHH form by loading the form template and updating the date.
function prepareNewForm() {
  const doc = loadDocument(formTemplateBuffer);
  // Assume the document’s table structure mirrors python‑docx:
  // Update table[0].rows[1].cells[3] with today’s date.
  const dateCell = doc.tables[0].rows[1].cells[3];
  const today = new Date();
  dateCell.text = today.toLocaleDateString("en-GB"); // Format: dd/mm/yyyy
  return doc;
}

// Modify the first row of the COSHH table.
function changeCOSHHRowOne(doc, chemName, amount, hazardStatements) {
  const table = doc.tables[2];
  table.rows[1].cells[0].text = chemName;
  table.rows[1].cells[1].text = amount;
  table.rows[1].cells[2].text = hazardStatements;
  return doc;
}

// Add a new row to the COSHH table with tick marks for exposure routes and control measures.
function addCOSHHRow(doc, chemName, amount, hazardStatements, expRoutes, ctrlMeasures) {
  // Load a fresh ticks document from the preloaded buffer.
  const tickDoc = loadDocument(ticksTemplateBuffer);
  const table = doc.tables[2];
  // Clone the template row (row index 1) from the COSHH table.
  const clonedRow = cloneRow(table.rows[1]); // helper function to deep-clone a row
  table.addRow(clonedRow); // helper function that appends a row to the table
  const newRow = table.rows[table.rows.length - 1];

  newRow.cells[0].text = chemName;
  newRow.cells[1].text = amount;
  newRow.cells[2].text = hazardStatements;

  // Set exposure routes using ticks from tickDoc.tables[0]
  const ticksTable0 = tickDoc.tables[0];
  newRow.cells[3].clear(); // helper: clears cell contents
  for (let i = 0; i < 4; i++) {
    // Append a deep copy of the cell corresponding to expRoutes[i]
    const cellContent = cloneElement(ticksTable0.rows[i].cells[expRoutes[i]]);
    newRow.cells[3].append(cellContent); // helper: appends content to the cell
  }

  // Set control measures using ticks from tickDoc.tables[1]
  const ticksTable1 = tickDoc.tables[1];
  newRow.cells[4].clear();
  for (let i = 0; i < 9; i++) {
    const cellContent = cloneElement(ticksTable1.rows[i].cells[ctrlMeasures[i]]);
    newRow.cells[4].append(cellContent);
  }
  return doc;
}

// --- Hypothetical helper functions ---
// In a real implementation, you’d use proper methods provided by your DOCX manipulation library.
function cloneRow(row) {
  // Deep-clone the row object (this is a simplified example)
  return cloneDeep(row);
}

function cloneElement(element) {
  // Deep-clone an element (simplified)
  return cloneDeep(element);
}

// Express route handler for POST /api/submitGHSData
app.post("/api/submitGHSData", async (req, res) => {
  try {
    // 1. Receive JSON data from the frontend.
    // Expected structure: an array of objects, each with keys:
    //    { name: string, amount: string, hazards: string[] }
    const data = req.body;
    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: "No data received" });
    }

    // 2. Prepare a new COSHH form document.
    let doc = prepareNewForm();

    // 3. Process the first chemical using the dedicated function.
    const first = data[0];
    const hazardStr = (first.hazards || []).join("\n");
    let { expRoutes, ctrlMeasures } = getRoutesAndMeasures(hazardStr);
    doc = changeCOSHHRowOne(doc, first.name || "", first.amount || "", hazardStr);

    // 4. Process subsequent chemicals by adding new rows.
    for (let i = 1; i < data.length; i++) {
      const chem = data[i];
      const hazardStr = (chem.hazards || []).join("\n");
      ({ expRoutes, ctrlMeasures } = getRoutesAndMeasures(hazardStr));
      doc = addCOSHHRow(doc, chem.name || "", chem.amount || "", hazardStr, expRoutes, ctrlMeasures);
    }

    // 5. Generate the DOCX file as an in-memory buffer.
    const buffer = await Packer.toBuffer(doc);
    const filename = `COSHH_${new Date().toISOString().replace(/[:\-T]/g, "").slice(0, 14)}.docx`;
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Export the Express app (Vercel will use this as your serverless function)
module.exports = app;
