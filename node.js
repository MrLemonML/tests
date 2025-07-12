const WebSocket = require('ws');
const { google } = require('googleapis');
const readline = require('readline');

// Configurazione Google Sheets API
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
const SPREADSHEET_ID = '2PACX-1vTCXD87DMn-CD-b9fpi3g7WU-iwAbow7ifsukwSRNY2CdubFqTw7czPtPJ__VqNodLwIqgsS4AG6hEd';
const RANGE = 'Sheet1!A:B';

const server = new WebSocket.Server({ port: 8080 });
const clients = new Set();

// Cache valori
let cachedValues = {};

async function authorize() {
  const auth = new google.auth.GoogleAuth({
    keyFile: 'credentials.json',
    scopes: SCOPES
  });
  return auth.getClient();
}

async function getSheetData(auth) {
  const sheets = google.sheets({ version: 'v4', auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: RANGE,
  });
  return response.data.values;
}

function parseSheetData(data) {
  const values = {};
  for (const row of data) {
    if (row.length >= 2) {
      const itemName = row[0].trim();
      const value = parseFloat(row[1].replace(',', '.'));
      if (!isNaN(value)) {
        values[itemName] = value;
      }
    }
  }
  return values;
}

async function refreshData() {
  try {
    const auth = await authorize();
    const data = await getSheetData(auth);
    const newValues = parseSheetData(data);
    
    // Controlla differenze
    const changes = findChanges(cachedValues, newValues);
    
    if (Object.keys(changes).length > 0) {
      cachedValues = newValues;
      broadcast({ type: 'update', data: changes });
    }
  } catch (error) {
    console.error('Error refreshing data:', error);
  }
}

function findChanges(oldValues, newValues) {
  const changes = {};
  
  // Controlla modifiche e aggiunte
  for (const [key, newValue] of Object.entries(newValues)) {
    if (oldValues[key] !== newValue) {
      changes[key] = newValue;
    }
  }
  
  // Controlla rimozioni
  for (const key of Object.keys(oldValues)) {
    if (!(key in newValues)) {
      changes[key] = null; // Segnala rimozione
    }
  }
  
  return changes;
}

function broadcast(message) {
  const json = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}

server.on('connection', (ws) => {
  clients.add(ws);
  console.log('New client connected');
  
  // Invia tutti i dati iniziali
  ws.send(JSON.stringify({ type: 'full', data: cachedValues }));
  
  ws.on('close', () => {
    clients.delete(ws);
    console.log('Client disconnected');
  });
});

// Avvia il server e il polling iniziale
(async () => {
  await refreshData();
  
  // Controlla modifiche ogni 30 secondi
  setInterval(refreshData, 30000);
  
  console.log('WebSocket server running on port 8080');
})();
