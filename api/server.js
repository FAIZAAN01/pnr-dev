const express = require('express');
const bodyParser = require('body-parser');
const moment = require('moment-timezone');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
// Assuming you've integrated Vercel KV from the previous step
const { kv } = require('@vercel/kv');

const app = express();

app.use(express.json());

let airlineDatabase = {};
let aircraftTypes = {};
let airportDatabase = {};

// --- Using Vercel KV for Data Loading ---
async function loadAllDatabases() {
  try {
    [
      airlineDatabase,
      aircraftTypes,
      airportDatabase,
    ] = await Promise.all([
      kv.get('airlines'),
      kv.get('aircraftTypes'),
      kv.get('airportDatabase'),
    ]);
    console.log("Databases loaded from Vercel KV.");
    // Fallback if KV is empty (e.g., first run before seeding)
    if (!airlineDatabase) airlineDatabase = {};
    if (!aircraftTypes) aircraftTypes = {};
    if (!airportDatabase) airportDatabase = {};
  } catch (error) {
     console.error("Failed to load databases from Vercel KV:", error);
  }
}

// Load databases when the function starts
loadAllDatabases();

app.use(morgan('dev'));
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(helmet({ contentSecurityPolicy: false }));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: "Too many requests, please try again later.", result: { flights: [] } }
});

// Endpoint for saving developer mode changes to the database
app.post('/api/save-databases', async (req, res) => {
    const { airlineDatabase, aircraftTypes, airportDatabase } = req.body;
    if (!airlineDatabase || !aircraftTypes || !airportDatabase) {
        return res.status(400).json({ success: false, error: 'Missing database data.' });
    }
    try {
        await Promise.all([
            kv.set('airlines', airlineDatabase),
            kv.set('aircraftTypes', aircraftTypes),
            kv.set('airportDatabase', airportDatabase)
        ]);
        await loadAllDatabases();
        return res.status(200).json({ success: true, message: 'Databases updated successfully!' });
    } catch (error) {
        console.error('Error saving to Vercel KV:', error);
        return res.status(500).json({ success: false, error: 'Failed to save data.' });
    }
});

// Main conversion endpoint
app.post('/api/convert', async (req, res) => {
    if (Object.keys(airlineDatabase).length === 0) {
        await loadAllDatabases();
    }
    try {
        const { pnrText, options, fareDetails, developerModeTrigger } = req.body;
        let pnrTextForProcessing = pnrText || '';
        let serverOptions = options || {};
        
        const result = pnrTextForProcessing ? parseGalileoEnhanced(pnrTextForProcessing, serverOptions) : { flights: [], passengers: [] };

        const responsePayload = {
            success: true, result, fareDetails, message: null,
            pnrProcessingAttempted: !!pnrTextForProcessing
        };
        
        if (developerModeTrigger === 'developer' || developerModeTrigger === 'developermarja') {
            responsePayload.pnrDeveloperModeActive = true;
            responsePayload.databases = { airlineDatabase, aircraftTypes, airportDatabase };
        }

        return res.status(200).json(responsePayload);
    } catch (err) {
        console.error("Error during PNR conversion:", err.stack);
        return res.status(400).json({ success: false, error: err.message, result: { flights: [] } });
    }
});

app.post('/api/upload-logo', limiter, async (req, res) => {
    console.error("Logo upload is not supported on Vercel's read-only filesystem.");
    return res.status(400).json({ success: false, error: "This feature is disabled on the live deployment." });
});

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
            if (flights.length === 0) {
                // --- THIS IS THE UPDATED NAME PARSING LOGIC ---
                const fullNamePart = passengerMatch[1].trim();
                const nameParts = fullNamePart.split('/');

                if (nameParts.length >= 2) {
                    const lastName = nameParts[0].trim();
                    let givenNamesRaw = nameParts[1].trim();

                    const titles = ['MR', 'MRS', 'MS', 'MSTR', 'MISS', 'CHD', 'INF'];
                    const words = givenNamesRaw.split(/\s+/);
                    const lastWord = words[words.length - 1].toUpperCase();

                    if (titles.includes(lastWord)) {
                        words.pop(); // Remove the title
                    }

                    const firstName = words.join(' '); // Re-join remaining parts (first and middle names)

                    if (lastName && firstName) {
                        const formattedName = `${lastName.toUpperCase()}/${firstName.toUpperCase()}`;
                        if (!passengers.includes(formattedName)) {
                            passengers.push(formattedName);
                        }
                    }
                }
                // --- END OF UPDATED NAME PARSING LOGIC ---
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
                flightNumber: `${airlineCode}${flightNum}`,
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

module.exports = app;