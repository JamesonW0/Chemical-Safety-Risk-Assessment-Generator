// /api/processGHSData.js

const express = require("express");
const fs = require("fs");
const path = require("path");
const docx4js = require("docx4js");
const { cloneDeep } = require("lodash");

const app = express();
app.use(express.json());

// Define file paths (ensure the folder name is correct; here we assume "resources")
const FORM_TEMPLATE_PATH = path.join(__dirname, "", "COSHH_Form_Template.docx");
const TICKS_TEMPLATE_PATH = path.join(__dirname, "", "COSHH_Ticks_Template.docx");

// Helper: Load a DOCX document from a Buffer using docx4js.
async function loadDocument(buffer) {
  // docx4js.load returns a promise that resolves to a document object.
  return await docx4js.load(buffer);
}

// ----------------- MAPPINGS -----------------
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

// Computes exposure routes and control measures from a newline‑separated string of hazard codes.
function getRoutesAndMeasures(hazardStatements) {
  if (!hazardStatements || hazardStatements[0] === "N") {
    return { expRoutes: [0, 0, 0, 0], ctrlMeasures: [0, 0, 1, 0, 0, 0, 0, 0, 0] };
  }
  const lines = hazardStatements.split("\n");
  const hazardCodes = new Set();
  lines.forEach(line => {
    line = line.trim();
    if (!line) return;
    let code = parseInt(line);
    if (isNaN(code)) {
      // Try extracting characters 1-3 as in the Python version.
      code = parseInt(line.substring(1, 4));
    }
    if (!isNaN(code)) hazardCodes.add(code);
  });

  const expRoutes = [0, 0, 0, 0];
  // Default: control measure index 2 is set to 1.
  const ctrlMeasures = [0, 0, 1, 0, 0, 0, 0, 0, 0];

  for (const [key, mappingSet] of Object.entries(hazardMappings)) {
    for (const code of hazardCodes) {
      if (mappingSet.has(code)) {
        const idx = { spill: 0, flame: 3, Tcontrol: 4, pregnant: 5, water: 6, dropwise: 7, air: 8 }[key];
        if (idx !== undefined) ctrlMeasures[idx] = 1;
        break;
      }
    }
  }
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

// ----------------- DOCX MANIPULATION FUNCTIONS -----------------

// Prepare a new COSHH form by loading the form template from hard drive and updating the date.
async function prepareNewForm() {
  // Load the form template directly from disk
  const formTemplateBuffer = fs.readFileSync(FORM_TEMPLATE_PATH);
  const doc = await loadDocument(formTemplateBuffer);
  // Assuming the template has at least one table and the desired cell is accessible:
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

// Helper: Deep-clone a table row.
function cloneRow(row) {
  return cloneDeep(row);
}

// Helper: Clear cell content.
function clearCell(cell) {
  cell.text = "";
}

// Helper: Append cloned content to a cell (this is a simplified implementation).
function appendToCell(cell, content) {
  // Here, we assume that 'content' is an object with a 'text' property.
  cell.text += content.text || "";
}

// Helper: Clone an element.
function cloneElement(element) {
  return cloneDeep(element);
}

// Add a new row to the COSHH table with tick marks for exposure routes and control measures.
async function addCOSHHRow(doc, chemName, amount, hazardStatements, expRoutes, ctrlMeasures) {
  // Load a fresh ticks document from disk each time.
  const ticksTemplateBuffer = fs.readFileSync(TICKS_TEMPLATE_PATH);
  const tickDoc = await loadDocument(ticksTemplateBuffer);
  const table = doc.tables[2];
  // Clone the template row (row index 1) as our base.
  const clonedRow = cloneRow(table.rows[1]);
  // Append the cloned row.
  table.rows.push(clonedRow);
  const newRow = table.rows[table.rows.length - 1];

  newRow.cells[0].text = chemName;
  newRow.cells[1].text = amount;
  newRow.cells[2].text = hazardStatements;

  // Set exposure routes using ticks from tickDoc.tables[0]
  clearCell(newRow.cells[3]);
  for (let i = 0; i < 4; i++) {
    const sourceCell = tickDoc.tables[0].rows[i].cells[expRoutes[i]];
    const cellContent = cloneElement(sourceCell);
    appendToCell(newRow.cells[3], cellContent);
  }

  // Set control measures using ticks from tickDoc.tables[1]
  clearCell(newRow.cells[4]);
  for (let i = 0; i < 9; i++) {
    const sourceCell = tickDoc.tables[1].rows[i].cells[ctrlMeasures[i]];
    const cellContent = cloneElement(sourceCell);
    appendToCell(newRow.cells[4], cellContent);
  }
  return doc;
}

// ----------------- ROUTE HANDLER -----------------
app.post("/api/processGHSData", async (req, res) => {
  try {
    // Expected structure: an array of objects, each with keys:
    // { name: string, amount: string, hazards: string[] }
    const data = req.body;
    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: "No data received" });
    }

    // Prepare the base document.
    let doc = await prepareNewForm();

    // Process the first chemical.
    const first = data[0];
    const hazardStr = (first.hazards || []).join("\n");
    let { expRoutes, ctrlMeasures } = getRoutesAndMeasures(hazardStr);
    doc = changeCOSHHRowOne(doc, first.name || "", first.amount || "", hazardStr);

    // Process subsequent chemicals.
    for (let i = 1; i < data.length; i++) {
      const chem = data[i];
      const hazardStr = (chem.hazards || []).join("\n");
      ({ expRoutes, ctrlMeasures } = getRoutesAndMeasures(hazardStr));
      doc = await addCOSHHRow(doc, chem.name || "", chem.amount || "", hazardStr, expRoutes, ctrlMeasures);
    }

    // Save the modified document to an in-memory buffer.
    // Here we assume docx4js provides a save() method that returns a Buffer.
    const buffer = await doc.save();
    const filename = `COSHH_${new Date().toISOString().replace(/[:\-T]/g, "").slice(0, 14)}.docx`;
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
