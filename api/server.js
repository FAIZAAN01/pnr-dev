const express = require('express');
const bodyParser = require('body-parser');
const moment = require('moment-timezone');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const { kv } = require('@vercel/kv'); // Using Vercel KV for brands

const app = express();

// --- DATABASE KEYS & PATHS ---
const DB_BRANDS_KEY = 'pnr-brands';
const DATA_DIR = path.join(process.cwd(), 'data');
const AIRLINES_FILE = path.join(DATA_DIR, 'airlines.json');
const AIRCRAFT_TYPES_FILE = path.join(DATA_DIR, 'aircraftTypes.json');
const AIRPORT_DATABASE_FILE = path.join(DATA_DIR, 'airportDatabase.json');

// --- MIDDLEWARE ---
app.use(express.json({ limit: '2mb' })); // Increased limit for logo data
app.use(bodyParser.urlencoded({ extended: true, limit: '2mb' }));
app.use(cors());
app.use(morgan('dev'));
app.use(helmet({ contentSecurityPolicy: false }));
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });

// --- DATA LOADING ---
let airlineDatabase = {};
let aircraftTypes = {};
let airportDatabase = {};

// This function loads the PNR data from local files, as you intended.
function loadPnrDataFromFiles() {
  try {
    if (fs.existsSync(AIRLINES_FILE)) airlineDatabase = JSON.parse(fs.readFileSync(AIRLINES_FILE, 'utf-8'));
    if (fs.existsSync(AIRCRAFT_TYPES_FILE)) aircraftTypes = JSON.parse(fs.readFileSync(AIRCRAFT_TYPES_FILE, 'utf-8'));
    if (fs.existsSync(AIRPORT_DATABASE_FILE)) airportDatabase = JSON.parse(fs.readFileSync(AIRPORT_DATABASE_FILE, 'utf-8'));
    console.log("PNR data (Airlines, Airports, Aircraft) loaded from local files.");
  } catch (error) {
    console.error("Error loading PNR data from files:", error);
  }
}

// Load the local file data when the serverless function starts.
loadPnrDataFromFiles();


// --- API ENDPOINTS ---

/**
 * Endpoint to fetch all saved brands from Vercel KV.
 */
app.get('/api/brands', async (req, res) => {
    try {
        const brands = await kv.lrange(DB_BRANDS_KEY, 0, -1);
        res.status(200).json({ success: true, brands: brands || [] });
    } catch (error) {
        console.error("Error fetching brands from KV:", error);
        res.status(500).json({ success: false, error: "Could not fetch brands." });
    }
});

/**
 * Endpoint to save a new brand to Vercel KV.
 */
app.post('/api/save-brand', limiter, async (req, res) => {
    const { name, logo, text } = req.body;
    if (!name || !logo || !text) {
        return res.status(400).json({ success: false, error: 'Brand name, logo, and text are required.' });
    }

    try {
        const newBrand = { name, logo, text };
        await kv.lpush(DB_BRANDS_KEY, newBrand);
        res.status(200).json({ success: true, message: `Brand "${name}" saved successfully!` });
    } catch (error) {
        console.error("Error saving brand to KV:", error);
        res.status(500).json({ success: false, error: "Could not save the brand." });
    }
});

/**
 * Your original PNR conversion endpoint. It uses the data loaded from local files.
 */
app.post('/api/convert', limiter, (req, res) => {
    try {
        const { pnrText, options, fareDetails, developerModeTrigger } = req.body;
        let pnrTextForProcessing = pnrText || '';
        let serverOptions = options || {};
        
        // This endpoint no longer handles saving data, just parsing.
        const result = pnrTextForProcessing ? parseGalileoEnhanced(pnrTextForProcessing, serverOptions) : { flights: [], passengers: [] };

        const responsePayload = {
            success: true, result, fareDetails,
            pnrProcessingAttempted: !!pnrTextForProcessing
        };
        
        // Developer mode still reads from the local files to show the data.
        if (developerModeTrigger === 'developer') {
            responsePayload.pnrDeveloperModeActive = true;
            // The databases for the dev panel are the ones from the local files.
            responsePayload.databases = { airlineDatabase, aircraftTypes, airportDatabase };
        }

        return res.status(200).json(responsePayload);
    } catch (err) {
        console.error("Error during PNR conversion:", err.stack);
        return res.status(400).json({ success: false, error: err.message, result: { flights: [] } });
    }
});

// This endpoint remains disabled on Vercel's read-only file system.
app.post('/api/upload-logo', limiter, async (req, res) => {
    console.error("Logo upload is not supported on Vercel's read-only filesystem.");
    return res.status(400).json({ success: false, error: "This feature is disabled on the live deployment." });
});


// --- HELPER AND PARSING FUNCTIONS (Unchanged) ---

function formatMomentTime(momentObj, use24 = false) {
    if (!momentObj || !momentObj.isValid()) return '';
    return momentObj.format(use24 ? 'HH:mm' : 'hh:mm A');
}
function calculateAndFormatDuration(depMoment, arrMoment) {
    if (!depMoment || !depMoment.isValid() || !arrMoment || !arrMoment.isValid()) return 'Invalid time';
    const durationMinutes = arrMoment.diff(depMoment, 'minutes');
    if (durationMinutes < 0) return 'Invalid duration';
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
    const lines = pnrText.split('\n').map(line => line.trim());
    let currentFlight = null;
    let flightIndex = 0;
    let previousArrivalMoment = null;

    const flightSegmentRegex = /^\s*(\d+)\s+([A-Z0-9]{2})\s*(\d{1,4}[A-Z]?)\s+([A-Z])\s+([0-3]\d[A-Z]{3})\s+\S*\s*([A-Z]{3})([A-Z]{3})\s+\S*\s+(\d{4})\s+(\d{4})(?:\s+([0-3]\d[A-Z]{3}|\+\d))?/;
    const operatedByRegex = /OPERATED BY\s+(.+)/i;
    const passengerLineIdentifierRegex = /^\s*\d+\.\s*[A-Z/]/;

    for (const line of lines) {
        if (!line) continue;
        const flightMatch = line.match(flightSegmentRegex);
        const operatedByMatch = line.match(operatedByRegex);
        const isPassengerLine = passengerLineIdentifierRegex.test(line);
        
        if (isPassengerLine) {
            const cleanedLine = line.replace(/^\s*\d+\.\s*/, '');
            const nameBlocks = cleanedLine.split(/\s+\d+\.\s*/);
            for (const nameBlock of nameBlocks) {
                if (!nameBlock.trim()) continue;
                const nameParts = nameBlock.trim().split('/');
                if (nameParts.length < 2) continue;
                const lastName = nameParts[0].trim();
                const givenNamesAndTitleRaw = nameParts[1].trim();
                const titles = ['MR', 'MRS', 'MS', 'MSTR', 'MISS', 'CHD', 'INF'];
                const words = givenNamesAndTitleRaw.split(/\s+/);
                const lastWord = words[words.length - 1].toUpperCase();
                let title = '';
                if (titles.includes(lastWord)) {
                    title = words.pop();
                }
                const givenNames = words.join(' '); 
                if (lastName && givenNames) {
                    let formattedName = `${lastName.toUpperCase()}/${givenNames.toUpperCase()}`;
                    if (title) {
                        formattedName += ` ${title}`;
                    }
                    if (!passengers.includes(formattedName)) {
                        passengers.push(formattedName);
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
                if (departureMoment.isValid() && arrivalMoment.isValid() && arrivalMoment.isBefore(departureMoment)) arrivalMoment.add(1, 'day');
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
                flightNumber: flightNum,
                travelClass: { code: travelClass || '', name: getTravelClassName(travelClass) },
                date: departureMoment.isValid() ? departureMoment.format('dddd, DD MMM YYYY') : '',
                departure: { 
                    airport: depAirport, 
                    city: depAirportInfo.city, 
                    name: depAirportInfo.name,
                    time: formatMomentTime(departureMoment, options.use24HourFormat) 
                },
                arrival: { 
                    airport: arrAirport, 
                    city: arrAirportInfo.city, 
                    name: arrAirportInfo.name,
                    time: formatMomentTime(arrivalMoment, options.use24HourFormat) 
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

// Export the app for Vercel
module.exports = app;