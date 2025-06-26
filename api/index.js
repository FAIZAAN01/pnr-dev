// ==== api/index.js (Vercel-compatible Version) ====
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const moment = require('moment-timezone');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');

const app = express();

// --- Data Persistence Setup (Vercel Compatible) ---
// NOTE: Vercel has a read-only filesystem. Writes will not persist across deployments.
// Data should be updated by committing changes to the JSON files and redeploying.
const DATA_DIR = path.join(process.cwd(), 'data');
const AIRLINES_FILE = path.join(DATA_DIR, 'airlines.json');
const AIRCRAFT_TYPES_FILE = path.join(DATA_DIR, 'aircraftTypes.json');
const AIRPORT_DATABASE_FILE = path.join(DATA_DIR, 'airportDatabase.json');

// Ensure data directory exists (for local dev)
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Default Databases (will be overridden by files if they exist)
let airlineDatabase = {};
let aircraftTypes = {};
let airportDatabase = {};

function loadDbFromFile(filePath, defaultDb) {
  try {
    if (fs.existsSync(filePath)) {
      const fileData = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(fileData);
    }
  } catch (error) {
    console.error(`Error loading ${path.basename(filePath)}:`, error.message);
  }
  return defaultDb;
}

function loadAllDatabases() {
  airlineDatabase = loadDbFromFile(AIRLINES_FILE, airlineDatabase);
  aircraftTypes = loadDbFromFile(AIRCRAFT_TYPES_FILE, aircraftTypes);
  airportDatabase = loadDbFromFile(AIRPORT_DATABASE_FILE, airportDatabase);
}

function saveDatabasesToFile(databasesToSave) {
    console.warn("NOTE: Filesystem is read-only on Vercel. Saved data will not persist.");
    const saveIfNeeded = (filePath, data, dbName) => {
        let existingDataString = "{}";
        if (fs.existsSync(filePath)) {
            try {
                existingDataString = fs.readFileSync(filePath, 'utf-8');
            } catch (readError) {
                console.error(`Error reading ${dbName} for comparison:`, readError.message);
            }
        }
        const newDataString = JSON.stringify(data, null, 2);
        if (newDataString !== existingDataString) {
            try {
                fs.writeFileSync(filePath, newDataString, 'utf-8');
                console.log(`${dbName} database saved to ${filePath} (ephemeral)`);
            } catch (error) {
                console.error(`Error saving ${dbName} to ${filePath}:`, error.message);
            }
        }
    };
    if (databasesToSave.airlineDatabase) saveIfNeeded(AIRLINES_FILE, databasesToSave.airlineDatabase, 'Airlines');
    if (databasesToSave.aircraftTypes) saveIfNeeded(AIRCRAFT_TYPES_FILE, databasesToSave.aircraftTypes, 'Aircraft Types');
    if (databasesToSave.airportDatabase) saveIfNeeded(AIRPORT_DATABASE_FILE, databasesToSave.airportDatabase, 'Airport');
}

const LOGO_DIR = path.join(process.cwd(), 'logos');
if (!fs.existsSync(LOGO_DIR)) {
    fs.mkdirSync(LOGO_DIR, { recursive: true });
}

loadAllDatabases();

// Middleware
app.use(morgan('dev'));
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
// Serve static files from the 'public' directory
app.use(express.static(path.join(process.cwd(), 'public')));
app.use('/logos', express.static(LOGO_DIR));

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "script-src": ["'self'", "https://cdn.jsdelivr.net"],
            "img-src": ["'self'", "data:", "blob:"],
            "style-src": ["'self'", "'unsafe-inline'"],
        }
    }
}));
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: "Too many requests, please try again later.", result: { flights: [] } }
});
app.use('/convert', limiter);

function formatMomentTime(momentObj, use24 = false) {
    if (!momentObj || !momentObj.isValid()) return '';
    return momentObj.format(use24 ? 'HH:mm' : 'hh:mm A');
}

function calculateAndFormatDuration(depMoment, arrMoment) {
    if (!depMoment || !depMoment.isValid() || !arrMoment || !arrMoment.isValid()) {
        return 'Invalid time';
    }
    const durationMinutes = arrMoment.diff(depMoment, 'minutes');
    if (durationMinutes < 0) {
        return 'Invalid duration';
    }
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;
    return `${hours}h ${minutes < 10 ? '0' : ''}${minutes}m`;
}

function getTravelClassName(classCode) {
    if (!classCode) return 'Unknown';
    const code = classCode.toUpperCase();
    const firstCodes = ['F', 'A', 'P'];
    const businessCodes = ['J', 'C', 'D', 'I', 'Z', 'R'];
    const premiumEconomyCodes = ['W', 'E', 'T'];
    const economyCodes = ['Y', 'B', 'H', 'K', 'L', 'M', 'N', 'O', 'Q', 'S', 'U', 'V', 'X', 'G'];

    if (firstCodes.includes(code)) return 'First';
    if (businessCodes.includes(code)) return 'Business';
    if (premiumEconomyCodes.includes(code)) return 'Premium Economy';
    if (economyCodes.includes(code)) return 'Economy';
    return `Class ${code}`;
}

function parseGalileoEnhanced(pnrText, options) {
    const flights = [];
    const passengers = [];
    const lines = pnrText.split('\n').map(line => line.trimEnd());

    let currentFlight = null;
    let flightIndex = 0;
    let previousArrivalMoment = null;

    const flightSegmentRegex = /^\s*(\d+)\s+([A-Z0-9]{2})\s*(\d{1,4}[A-Z]?)\s+([A-Z])\s+([0-3]\d[A-Z]{3})\s+\S*\s*([A-Z]{3})([A-Z]{3})\s+\S*\s+(\d{4})\s+(\d{4})(?:\s+([0-3]\d[A-Z]{3}|\+\d))?/;
    const operatedByRegex = /OPERATED BY\s+(.+)/i;
    const passengerNameRegex = /^\s*\d+\.\s*([A-Z\s/.'-]+)/;

    for (const line of lines) {
        if (!line.trim()) continue;

        const flightMatch = line.match(flightSegmentRegex);
        const operatedByMatch = line.match(operatedByRegex);
        const passengerMatch = line.match(passengerNameRegex);

        if (passengerMatch) {
            // Only process passenger lines if no flights have been found yet.
            if (flights.length === 0) {
                const fullNamePart = passengerMatch[1].trim();
                const nameParts = fullNamePart.split('/');
                
                if (nameParts.length >= 2) {
                    const lastName = nameParts[0].trim();
                    const firstName = nameParts[1].split(' ')[0].trim();
                    
                    if (lastName && firstName) {
                        const formattedName = `${lastName.toUpperCase()}/${firstName.toUpperCase()}`;
                        if (!passengers.includes(formattedName)) {
                            passengers.push(formattedName);
                        }
                    }
                }
            }
        }
        else if (flightMatch) {
            if (currentFlight) flights.push(currentFlight);
            flightIndex++;
            let precedingTransitTimeForThisSegment = null;

            const [, segmentNumStr, airlineCode, flightNumRaw, travelClass, depDateStr, depAirport, arrAirport, depTimeStr, arrTimeStr, arrDateStrOrNextDayIndicator] = flightMatch;
            const flightNum = flightNumRaw;
            const flightDetailsPart = line.substring(flightMatch[0].length).trim();
            const detailsParts = flightDetailsPart.split(/\s+/);
            const aircraftCodeKey = detailsParts.find(p => p.toUpperCase() in aircraftTypes);
            const mealCode = detailsParts.find(p => p.length === 1 && /[BLDSMFHCVKOPRWYNG]/.test(p.toUpperCase()));
            
            const depAirportInfo = airportDatabase[depAirport] || { city: `Unknown`, name: `Airport (${depAirport})`, timezone: 'UTC' };
            const arrAirportInfo = airportDatabase[arrAirport] || { city: `Unknown`, name: `Airport (${arrAirport})`, timezone: 'UTC' };
            
            if (!moment.tz.zone(depAirportInfo.timezone)) depAirportInfo.timezone = 'UTC';
            if (!moment.tz.zone(arrAirportInfo.timezone)) arrAirportInfo.timezone = 'UTC';

            const departureMoment = moment.tz(`${depDateStr} ${depTimeStr}`, "DDMMM HHmm", true, depAirportInfo.timezone);
            let arrivalMoment;
            if (arrDateStrOrNextDayIndicator) {
                if (arrDateStrOrNextDayIndicator.startsWith('+')) {
                    const daysToAdd = parseInt(arrDateStrOrNextDayIndicator.substring(1), 10);
                    arrivalMoment = moment.tz(`${depDateStr} ${arrTimeStr}`, "DDMMM HHmm", true, arrAirportInfo.timezone).add(daysToAdd, 'day');
                } else {
                    arrivalMoment = moment.tz(`${arrDateStrOrNextDayIndicator} ${arrTimeStr}`, "DDMMM HHmm", true, arrAirportInfo.timezone);
                }
            } else {
                arrivalMoment = moment.tz(`${depDateStr} ${arrTimeStr}`, "DDMMM HHmm", true, arrAirportInfo.timezone);
                if (departureMoment.isValid() && arrivalMoment.isValid() && arrivalMoment.isBefore(departureMoment)) {
                    arrivalMoment.add(1, 'day');
                }
            }
            
            if (previousArrivalMoment && previousArrivalMoment.isValid() && departureMoment && departureMoment.isValid()) {
                const transitDuration = moment.duration(departureMoment.diff(previousArrivalMoment));
                 if (transitDuration.asMinutes() > 0 && transitDuration.asHours() <= 48) {
                    const hours = Math.floor(transitDuration.asHours());
                    const minutes = transitDuration.minutes();
                    precedingTransitTimeForThisSegment = `${hours}h ${minutes < 10 ? '0' : ''}${minutes}m`;
                }
            }

            currentFlight = {
                segment: parseInt(segmentNumStr, 10) || flightIndex,
                airline: { code: airlineCode, name: airlineDatabase[airlineCode] || `Unknown Airline (${airlineCode})` },
                flightNumber: `${airlineCode}${flightNum}`,
                travelClass: { code: travelClass || '', name: getTravelClassName(travelClass) },
                date: departureMoment.isValid() ? departureMoment.format('DD MMM YYYY') : '',
                departure: {
                    airport: depAirport, city: depAirportInfo.city,
                    time: formatMomentTime(departureMoment, options.use24HourFormat),
                },
                arrival: {
                    airport: arrAirport, city: arrAirportInfo.city,
                    time: formatMomentTime(arrivalMoment, options.use24HourFormat),
                },
                duration: calculateAndFormatDuration(departureMoment, arrivalMoment),
                aircraft: aircraftTypes[aircraftCodeKey] || aircraftCodeKey || '',
                meal: mealCode, notes: [], operatedBy: null,
                transitTime: precedingTransitTimeForThisSegment
            };
            previousArrivalMoment = arrivalMoment.clone();
        } else if (currentFlight && operatedByMatch) {
            currentFlight.operatedBy = operatedByMatch[1].trim();
        } else if (currentFlight && line.trim().length > 0) {
            currentFlight.notes.push(line.trim());
        }
    }
    if (currentFlight) flights.push(currentFlight);
    
    return { flights, passengers };
}

// API endpoint
app.post('/convert', (req, res) => {
    try {
        const { pnrText, options, fareDetails, developerModeTrigger, updatedDatabases } = req.body;
        let pnrTextForProcessing = pnrText || '';
        let serverOptions = options || {};
        let developerSave = false;

        if ((developerModeTrigger === "save_databases" || developerModeTrigger === "developermarja") && updatedDatabases) {
            if (updatedDatabases) {
                console.log("Saving databases triggered by developer command.");
                saveDatabasesToFile(updatedDatabases);
                loadAllDatabases(); // Reload them right away
                developerSave = true;
            }
        }
        
        const result = pnrTextForProcessing ? parseGalileoEnhanced(pnrTextForProcessing, serverOptions) : { flights: [], passengers: [] };

        const responsePayload = {
            success: true, result, fareDetails,
            message: developerSave ? "Databases saved successfully (changes are ephemeral)." : null,
            pnrProcessingAttempted: !!pnrTextForProcessing
        };
        
        if (developerModeTrigger === 'developer' || developerModeTrigger === 'developermarja' || developerSave) {
            responsePayload.pnrDeveloperModeActive = true;
            responsePayload.databases = { airlineDatabase, aircraftTypes, airportDatabase };
        }

        res.json(responsePayload);
    } catch (err) {
        console.error("Error during PNR conversion:", err.stack);
        res.status(400).json({ success: false, error: err.message, result: { flights: [] } });
    }
});


app.post('/upload-logo', async (req, res) => {
    const { airlineCode, imageDataUrl, originalFileType } = req.body;
    if (!airlineCode || !imageDataUrl) return res.status(400).json({ success: false, error: 'Missing airline code or image data.' });
    
    console.warn("NOTE: Filesystem is read-only on Vercel. Uploaded logo will not persist.");

    try {
        let extension = originalFileType === 'image/svg+xml' ? '.svg' : '.png';
        const logoFilePath = path.join(LOGO_DIR, `${airlineCode.toUpperCase()}${extension}`);
        let buffer;
        
        if (imageDataUrl.startsWith('data:image/svg+xml') && !imageDataUrl.includes(';base64,')) {
            const svgString = decodeURIComponent(imageDataUrl.substring(imageDataUrl.indexOf(',') + 1));
            buffer = Buffer.from(svgString, 'utf-8');
        } else {
            const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, "").replace(/^data:image\/svg\+xml;base64,/, "");
            buffer = Buffer.from(base64Data, 'base64');
        }
        fs.writeFileSync(logoFilePath, buffer);
        console.log(`Logo saved: ${logoFilePath} (ephemeral)`);
        res.json({ success: true, message: `Logo for ${airlineCode.toUpperCase()} saved (ephemeral).` });
    } catch (error) {
        console.error('Error saving logo:', error);
        res.status(500).json({ success: false, error: 'Server error while saving logo.' });
    }
});

// Export the app for Vercel
module.exports = app;