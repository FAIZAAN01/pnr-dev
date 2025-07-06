let developerModeActiveOnClient = false;
const OPTIONS_STORAGE_KEY = 'pnrConverterOptions';

// --- NEW POPUP NOTIFICATION FUNCTION ---
function showPopup(message, duration = 3000) {
    const container = document.getElementById('popupContainer');
    if (!container) return;

    const popup = document.createElement('div');
    popup.className = 'popup-notification';
    popup.textContent = message;

    container.appendChild(popup);

    // Trigger the slide-in animation
    setTimeout(() => {
        popup.classList.add('show');
    }, 10); // A tiny delay to allow the element to be in the DOM before animating

    // Set a timer to remove the popup
    setTimeout(() => {
        popup.classList.remove('show');
        // Wait for the slide-out animation to finish before removing from DOM
        popup.addEventListener('transitionend', () => {
            if (popup.parentElement) {
                container.removeChild(popup);
            }
        });
    }, duration);
}


// Function to save current options to localStorage
function saveOptions() {
    try {
        const optionsToSave = {
            showItineraryLogo: document.getElementById('showItineraryLogo').checked,
            showAirline: document.getElementById('showAirline').checked,
            showAircraft: document.getElementById('showAircraft').checked,
            showOperatedBy: document.getElementById('showOperatedBy').checked,
            showClass: document.getElementById('showClass').checked,
            showMeal: document.getElementById('showMeal').checked,
            showNotes: document.getElementById('showNotes').checked,
            showTransit: document.getElementById('showTransit').checked,
            use24HourFormat: document.getElementById('use24HourFormat').checked,
            currency: document.getElementById('currencySelect').value,
        };
        localStorage.setItem(OPTIONS_STORAGE_KEY, JSON.stringify(optionsToSave));
    } catch (e) {
        console.error("Failed to save options to localStorage:", e);
    }
}

// Function to load options from localStorage and apply them to the UI
function loadOptions() {
    try {
        const savedOptionsJSON = localStorage.getItem(OPTIONS_STORAGE_KEY);
        if (!savedOptionsJSON) return;

        const savedOptions = JSON.parse(savedOptionsJSON);

        document.getElementById('showItineraryLogo').checked = savedOptions.showItineraryLogo ?? true;
        document.getElementById('showAirline').checked = savedOptions.showAirline ?? true;
        document.getElementById('showAircraft').checked = savedOptions.showAircraft ?? true;
        document.getElementById('showOperatedBy').checked = savedOptions.showOperatedBy ?? true;
        document.getElementById('showClass').checked = savedOptions.showClass ?? false;
        document.getElementById('showMeal').checked = savedOptions.showMeal ?? false;
        document.getElementById('showNotes').checked = savedOptions.showNotes ?? false;
        document.getElementById('showTransit').checked = savedOptions.showTransit ?? true;
        document.getElementById('use24HourFormat').checked = savedOptions.use24HourFormat ?? true;

        if (savedOptions.currency) document.getElementById('currencySelect').value = savedOptions.currency;
        
    } catch (e) {
        console.error("Failed to load/parse options from localStorage:", e);
        localStorage.removeItem(OPTIONS_STORAGE_KEY);
    }
}


function debounce(func, wait) {
    let timeout;
    return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
    };
}
function getCurrencySymbol(currencyCode) {
    const symbols = { USD: '$', EUR: '€', INR: '₹' };
    return symbols[currencyCode] || currencyCode || '';
}

async function convertPNR() {
    const output = document.getElementById('output');
    const loadingSpinner = document.getElementById('loadingSpinner');
    const screenshotBtn = document.getElementById('screenshotBtn');
    const copyTextBtn = document.getElementById('copyTextBtn');
    let rawInput = document.getElementById('pnrInput').value;
    
    let pnrTextForServer = rawInput;
    let developerModeTrigger = "none";
    let payload = {};

    loadingSpinner.style.display = 'block';
    screenshotBtn.style.display = 'none';
    copyTextBtn.style.display = 'none';
    
    output.innerHTML = ''; 
  
    if (rawInput.toLowerCase().includes("developermarja")) {
        developerModeTrigger = "developermarja";
        pnrTextForServer = rawInput.replace(/developermarja/gi, '').trim(); 
        payload.updatedDatabases = serializeDevPanelData();
        developerModeActiveOnClient = true; 
    } else if (rawInput.toLowerCase().includes("developer")) {
        developerModeTrigger = "developer";
        pnrTextForServer = rawInput.replace(/developer/gi, '').trim(); 
        developerModeActiveOnClient = true; 
    } else {
        pnrTextForServer = rawInput.replace(/developer|developermarja|save_databases/gi, '').trim();
    }
    
    const clientPnrDisplayOptions = {
        showItineraryLogo: document.getElementById('showItineraryLogo').checked,
        showAirline: document.getElementById('showAirline').checked,
        showAircraft: document.getElementById('showAircraft').checked,
        showOperatedBy: document.getElementById('showOperatedBy').checked,
        showClass: document.getElementById('showClass').checked,
        showMeal: document.getElementById('showMeal').checked,
        showNotes: document.getElementById('showNotes').checked,
        showTransit: document.getElementById('showTransit').checked,
        use24HourFormat: document.getElementById('use24HourFormat').checked,
        developerMode: developerModeActiveOnClient
    };

    payload.pnrText = pnrTextForServer; 
    payload.options = clientPnrDisplayOptions;
    payload.fareDetails = {
        fare: document.getElementById('fareInput').value,
        tax: document.getElementById('taxInput').value,
        fee: document.getElementById('feeInput').value,
        adult: document.getElementById('adultInput').value,
        currency: document.getElementById('currencySelect').value
    };
    payload.developerModeTrigger = developerModeTrigger;

    try {
        const response = await fetch('/api/convert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        let data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || `Server error: ${response.status} ${response.statusText}`);
        }
        
        const pnrDisplayDevMode = data.pnrDeveloperModeActive || false;
    
        if (data.pnrProcessingAttempted || data.databases) {
            displayResults(data, {...clientPnrDisplayOptions, developerMode: pnrDisplayDevMode });
        }
    
        if (data.databases) {
            renderDeveloperPanel(data.databases);
            document.getElementById('developerModePanel').style.display = 'block';
            developerModeActiveOnClient = true;
        } else if (developerModeTrigger !== "developer" && developerModeTrigger !== "developermarja") {
            document.getElementById('developerModePanel').style.display = 'none';
            developerModeActiveOnClient = false;
        }
    
    } catch (error) {
        console.error('Conversion error:', error);
        output.innerHTML = `<div class="error">Failed to process request: ${error.message}</div>`;
    } finally {
        loadingSpinner.style.display = 'none';
    }
}

function displayResults(response, displayPnrOptions) {
    const output = document.getElementById('output');
    const screenshotBtn = document.getElementById('screenshotBtn');
    const copyTextBtn = document.getElementById('copyTextBtn');
    output.innerHTML = '';

    if (displayPnrOptions.developerMode) {
        output.appendChild(createDevBanner("PNR Processed in Dev Context"));
    }

    if (!response.success) {
        output.innerHTML += `<div class="error">${response.error || 'Conversion failed.'}</div>`;
        return;
    }

    if (response.result?.flights?.length > 0) {
        screenshotBtn.style.display = 'inline-block';
        copyTextBtn.style.display = 'inline-block';
    } else {
        screenshotBtn.style.display = 'none';
        copyTextBtn.style.display = 'none';
    }

    const flights = response.result?.flights || [];
    const passengers = response.result?.passengers || [];
    const pnrProcessingAttempted = response.pnrProcessingAttempted;

    const outputContainer = document.createElement('div');
    outputContainer.className = 'output-container';

    if (flights.length > 0 && displayPnrOptions.showItineraryLogo) {
        const logoContainer = document.createElement('div');
        logoContainer.className = 'itinerary-main-logo-container';
        const logoImg = document.createElement('img');
        logoImg.className = 'itinerary-main-logo';
        logoImg.src = '/simbavoyages.png';
        logoImg.alt = 'Itinerary Logo';
        logoContainer.appendChild(logoImg);
        const logoText = document.createElement('div');
        logoText.className = 'itinerary-logo-text';
        logoText.innerHTML = "KN2 Ave 26, Nyarugenge Dist, Muhima <br>Kigali Rwanda";
        logoContainer.appendChild(logoText);
        outputContainer.appendChild(logoContainer);
    }
    
    if (passengers.length > 0) {
        const headerDiv = document.createElement('div');
        headerDiv.className = 'itinerary-header';
        const title = document.createElement('h4');
        title.textContent = 'Itinerary for:';
        headerDiv.appendChild(title);
        const names = document.createElement('p');
        names.innerHTML = passengers.join('<br>');
        headerDiv.appendChild(names);
        const count = document.createElement('p');
        count.style.marginTop = '8px';
        count.style.fontStyle = 'italic';
        count.textContent = `Total Passengers: ${passengers.length}`;
        headerDiv.appendChild(count);
        outputContainer.appendChild(headerDiv);
    }
    
    if (flights.length > 0) {
        const itineraryBlock = document.createElement('div');
        itineraryBlock.className = 'itinerary-block';

        for (let i = 0; i < flights.length; i++) {
            const flight = flights[i];
            
            if (displayPnrOptions.showTransit && i > 0 && flight.transitTime) {
                const transitDiv = document.createElement('div');
                transitDiv.className = 'transit-item';
                transitDiv.textContent = `------ Transit: ${flight.transitTime} at ${flights[i - 1].arrival?.city || ''} (${flights[i - 1].arrival?.airport || ''}) ------`;
                itineraryBlock.appendChild(transitDiv);
            }

            const flightItem = document.createElement('div');
            flightItem.className = 'flight-item';

            function createDetailRow(label, value) {
                if (!value) return null;
                const detailDiv = document.createElement('div');
                detailDiv.className = 'flight-detail';
                const strong = document.createElement('strong');
                strong.textContent = label + ':';
                detailDiv.appendChild(strong);
                detailDiv.appendChild(document.createTextNode(` ${value}`));
                return detailDiv;
            }

            const flightContentDiv = document.createElement('div');
            flightContentDiv.className = 'flight-content';

            if (displayPnrOptions.showAirline) {
                const logo = document.createElement('img');
                const airlineLogoCode = (flight.airline?.code || 'xx').toLowerCase();
                const defaultLogoPath = '/logos/default-airline.svg';
                logo.src = `/logos/${airlineLogoCode}.png`;
                logo.className = 'airline-logo';
                logo.alt = `${flight.airline?.name} logo`;
                logo.onerror = function() {
                    this.onerror = null;
                    this.src = defaultLogoPath;
                };
                flightContentDiv.appendChild(logo);
            }

            const detailsContainer = document.createElement('div');
            const headerDiv = document.createElement('div');
            headerDiv.className = 'flight-header';
            let headerText = `${flight.date} - ${displayPnrOptions.showAirline ? (flight.airline?.name || 'Unknown Airline') : ''} ${flight.flightNumber} - ${flight.duration}`;
            if (displayPnrOptions.showAircraft && flight.aircraft) headerText += ` - ${flight.aircraft}`;
            if (displayPnrOptions.showClass && flight.travelClass?.name) headerText += ` - ${flight.travelClass.name}`;
            headerDiv.textContent = headerText;
            detailsContainer.appendChild(headerDiv);

            [
                createDetailRow('Departing', `${flight.departure?.airport} - ${flight.departure?.name} at ${flight.departure?.time}`),
                createDetailRow('Arriving', `${flight.arrival?.airport} - ${flight.arrival?.name} at ${flight.arrival?.time}`),
                flight.operatedBy ? createDetailRow('Operated by', flight.operatedBy) : null,
                displayPnrOptions.showOperatedBy && flight.operatedBy ? createDetailRow('Operated by', flight.operatedBy) : null,
                displayPnrOptions.showMeal ? createDetailRow('Meal', getMealDescription(flight.meal)) : null,
                displayPnrOptions.showNotes && flight.notes?.length ? createDetailRow('Notes', flight.notes.join('; ')) : null,
            ].forEach(el => {
                if (el) detailsContainer.appendChild(el);
            });

            flightContentDiv.appendChild(detailsContainer);
            flightItem.appendChild(flightContentDiv);
            itineraryBlock.appendChild(flightItem);
        }
        
        const { fare, tax, fee, adult, currency } = response.fareDetails || {};
        if (fare || tax || fee) {
            const fareValue = parseFloat(fare) || 0, taxValue = parseFloat(tax) || 0, feeValue = parseFloat(fee) || 0;
            const adultCount = parseInt(adult) || 1, currencySymbol = getCurrencySymbol(currency);
            let fareLines = [];
            if (fareValue > 1) fareLines.push(`Total: ${currencySymbol}${fareValue.toFixed(2)}`);
            if (taxValue > 0) fareLines.push(`Taxes: ${currencySymbol}${taxValue.toFixed(2)}`);
            if (feeValue > 0) fareLines.push(`Fees: ${currencySymbol}${feeValue.toFixed(2)}`);
            const perAdultTotal = fareValue + taxValue + feeValue;
            if (adultCount > 1) fareLines.push(`Total X ${adultCount}: ${currencySymbol}${(perAdultTotal * adultCount).toFixed(2)}`);
            
            if (fareLines.length > 0) {
                const fareDiv = document.createElement('div');
                fareDiv.className = 'fare-summary';
                fareDiv.textContent = fareLines.join('\n');
                itineraryBlock.appendChild(fareDiv);
            }
        }
        outputContainer.appendChild(itineraryBlock);
    } 
    else if (pnrProcessingAttempted) {
        const infoDiv = document.createElement('div');
        infoDiv.className = 'info';
        infoDiv.style.margin = '15px';
        infoDiv.textContent = 'No flight segments found or PNR format not recognized.';
        outputContainer.appendChild(infoDiv);
    }
    
    if (outputContainer.hasChildNodes()) {
        output.appendChild(outputContainer);
    } else if (!pnrProcessingAttempted) {
         output.innerHTML = '<div class="info">Enter PNR data and click "Convert PNR".</div>';
    }
}


// Setup and Event Listeners
function createDevBanner(message) {
    const banner = document.createElement('div');
    banner.className = 'dev-banner';
    banner.textContent = message;
    return banner;
}
function getMealDescription(mealCode) {
    const mealMap = {'B':'Breakfast','L':'Lunch','D':'Dinner','S':'Snack','M':'Meal'};
    return mealMap[mealCode] || `Code ${mealCode}`;
}

// Developer Panel rendering and data serialization
let currentDevDBs = {};
function renderDeveloperPanel(databases) {
    // ... (rest of function is unchanged)
}
function renderSimpleDbTable(tableId, data, columns) {
    // ... (rest of function is unchanged)
}
function renderAirportDbTable(tableId, data) {
    // ... (rest of function is unchanged)
}
function serializeDevPanelData() {
    // ... (rest of function is unchanged)
}
function addGenericEntry(tableId, columns) {
    // ... (rest of function is unchanged)
}
document.getElementById('addAirlineBtn')?.addEventListener('click', () => addGenericEntry('airlinesTable', ['code', 'name']));
document.getElementById('addAircraftBtn')?.addEventListener('click', () => addGenericEntry('aircraftTypesTable', ['code', 'name']));
document.getElementById('addAirportBtn')?.addEventListener('click', () => addGenericEntry('airportDatabaseTable', ['code', 'city', 'name', 'timezone']));

async function saveAllChanges() {
    const loadingSpinner = document.getElementById('loadingSpinner');
    loadingSpinner.style.display = 'block';
    const payload = serializeDevPanelData();
    try {
        const response = await fetch('/api/save-databases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Server error');
        showPopup(data.message); // Use popup instead of alert
    } catch (error) {
        console.error('Save error:', error);
        showPopup(`Failed to save changes: ${error.message}`); // Use popup for errors too
    } finally {
        loadingSpinner.style.display = 'none';
    }
}


document.getElementById('saveAllDbChangesBtn').addEventListener('click', saveAllChanges);

document.getElementById('pasteBtn')?.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    const pnrInput = document.getElementById('pnrInput');
    if (!text || text.trim() === '') {
      pnrInput.focus();
      return; 
    }
    pnrInput.value = text;
    pnrInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    pnrInput.focus();
  } catch (err) {
    console.error('Failed to read clipboard contents: ', err);
    showPopup('Could not paste from clipboard.'); // Use popup
  }
});


const debouncedConvert = debounce(convertPNR, 300);
document.getElementById('pnrInput').addEventListener('input', () => debouncedConvert(false));
document.getElementById('convertBtn').addEventListener('click', () => convertPNR(false));
[...document.querySelectorAll('.options input, #currencySelect, #adultInput, #fareInput, #taxInput, #feeInput')].forEach(el => {
    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
        saveOptions();
        debouncedConvert(false);
    });
});

// --- UPDATED SCREENSHOT BUTTON ---
document.getElementById('screenshotBtn')?.addEventListener('click', async () => {
    if (typeof html2canvas === 'undefined') {
        showPopup('Screenshot library not loaded.');
        return;
    }
    const outputEl = document.getElementById('output');
    try {
        const canvas = await html2canvas(outputEl, { backgroundColor: '#ffffff', scale: 2 });
        canvas.toBlob(blob => navigator.clipboard.write([new ClipboardItem({'image/png': blob})]));
        showPopup('Screenshot copied to clipboard!'); // Use popup
    } catch (err) {
        console.error('Screenshot failed:', err);
        showPopup('Could not copy screenshot.'); // Use popup
    }
});

// --- UPDATED COPY TEXT BUTTON ---
document.getElementById('copyTextBtn')?.addEventListener('click', () => {
    const outputContainer = document.querySelector('.output-container');
    if (!outputContainer) return;
    const textToCopy = outputContainer.innerText; 
    navigator.clipboard.writeText(textToCopy).then(() => {
        showPopup('Itinerary copied to clipboard as text!'); // Use popup
    }).catch(err => {
        console.error('Could not copy text: ', err);
        showPopup('Failed to copy text.'); // Use popup
    });
});

document.addEventListener('DOMContentLoaded', () => {
    loadOptions();
});