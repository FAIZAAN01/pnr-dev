const OPTIONS_STORAGE_KEY = 'pnrConverterOptions';

//------------logog and custom text ---
const CUSTOM_LOGO_KEY = 'pnrConverterCustomLogo';
const CUSTOM_TEXT_KEY = 'pnrConverterCustomText';
// --- NEW HISTORY KEY ---
const HISTORY_KEY = 'pnrConversionHistory';
let allBrands = [];
let conversionHistory = [];

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

/**
 * Saves a new entry to the history. Now includes raw text and optional screenshot data.
 * @param {object} resultObject - The result from the API.
 * @param {string} rawPnrText - The original PNR text input by the user.
 * @param {string|null} screenshotDataUrl - A compressed Data URL of the screenshot, or null.
 */

function saveToHistory(resultObject, rawPnrText, screenshotDataUrl = null) {
    if (!resultObject?.flights?.length) return;

    const historyEntry = {
        id: Date.now(), // Unique ID for each entry
        timestamp: new Date().toISOString(),
        data: resultObject,
        rawText: rawPnrText,
        screenshot: screenshotDataUrl // Can be null
    };

    conversionHistory.unshift(historyEntry);
    if (conversionHistory.length > 30) { // Increased history limit
        conversionHistory = conversionHistory.slice(0, 30);
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(conversionHistory));
}


/**
 * Updates an existing history entry, specifically to add a screenshot after the fact.
 * @param {number} entryId - The unique ID of the history entry.
 * @param {string} screenshotDataUrl - The compressed Data URL of the screenshot.
 */
function updateHistoryWithScreenshot(entryId, screenshotDataUrl) {
    const entryIndex = conversionHistory.findIndex(entry => entry.id === entryId);
    if (entryIndex > -1) {
        conversionHistory[entryIndex].screenshot = screenshotDataUrl;
        localStorage.setItem(HISTORY_KEY, JSON.stringify(conversionHistory));
        showPopup("Screenshot saved to this history entry.");
    }
}

/**
 * Loads the history from localStorage into the global variable.
 */
function loadHistory() {
    const savedHistory = localStorage.getItem(HISTORY_KEY);
    if (savedHistory) {
        try {
            conversionHistory = JSON.parse(savedHistory);
        } catch (e) {
            console.error("Could not parse history, resetting.", e);
            conversionHistory = [];
        }
    }
}

/**
 * Renders the history items into the modal list.
 */
function renderHistory() {
    const historyList = document.getElementById('historyList');
    const searchTerm = document.getElementById('historySearchInput').value.toLowerCase();
    const sortOrder = document.getElementById('historySortSelect').value;
    historyList.innerHTML = '';

    let filteredHistory = [...conversionHistory];

    // Apply search filter
    if (searchTerm) {
        filteredHistory = filteredHistory.filter(entry => {
            const pax = (entry.data.passengers[0] || '').toLowerCase();
            const route = entry.data.flights.map(f => f.departure.airport).join('-').toLowerCase();
            return pax.includes(searchTerm) || route.includes(searchTerm);
        });
    }

    // Apply sorting
    filteredHistory.sort((a, b) => {
        if (sortOrder === 'oldest') {
            return new Date(a.timestamp) - new Date(b.timestamp);
        }
        return new Date(b.timestamp) - new Date(a.timestamp); // Newest first (default)
    });

    if (filteredHistory.length === 0) {
        historyList.innerHTML = '<p style="text-align:center; color:#888;">No matching history found.</p>';
        return;
    }

    filteredHistory.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'history-item';
        
        const paxName = entry.data.passengers[0] || 'N/A';
        const route = entry.data.flights.map(f => f.departure.airport).concat(entry.data.flights.slice(-1).map(f => f.arrival.airport)).join(' - ');
        const flightDate = new Date(entry.timestamp);

        item.innerHTML = `
            <div class="history-item-info">
                <div class="history-item-pax">${paxName}</div>
                <div class="history-item-details">
                    <span>Route: <strong>${route}</strong></span>
                    <span>Saved: ${flightDate.toLocaleDateString()}</span>
                </div>
            </div>
            <div class="history-item-actions">
                <button class="load-btn">Load</button>
            </div>
        `;

        item.querySelector('.history-item-info').addEventListener('click', () => showHistoryPreview(entry));
        item.querySelector('.load-btn').addEventListener('click', () => loadFromHistory(entry));

        historyList.appendChild(item);
    });
}

function showHistoryPreview(entry) {
    const previewPanel = document.getElementById('historyPreviewPanel');
    const previewContent = document.getElementById('previewContent');
    previewContent.innerHTML = '';

    if (entry.screenshot) {
        const img = document.createElement('img');
        img.src = entry.screenshot;
        previewContent.appendChild(img);
    } else {
        const pre = document.createElement('pre');
        pre.textContent = entry.rawText;
        previewContent.appendChild(pre);
    }

    previewPanel.classList.remove('hidden');
}

function closeHistoryPreview() {
    document.getElementById('historyPreviewPanel').classList.add('hidden');
}

function loadFromHistory(entry) {
    const mockResponse = { success: true, result: entry.data };
    const currentOptions = getDisplayOptions();
    displayResults(mockResponse, currentOptions);
    // Also load the original text back into the input box
    document.getElementById('pnrInput').value = entry.rawText;
    showPopup("Loaded itinerary from history.");
    closeHistoryModal();
}

// --- MODAL CONTROL ---
function openHistoryModal() {
    renderHistory();
    document.getElementById('historyModal').classList.remove('hidden');
}
function closeHistoryModal() {
    closeHistoryPreview(); // Ensure preview is closed too
    document.getElementById('historyModal').classList.add('hidden');
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
        if (savedOptionsJSON) {
            const savedOptions = JSON.parse(savedOptionsJSON);
            document.getElementById('showItineraryLogo').checked = savedOptions.showItineraryLogo ?? true;
            document.getElementById('showAirline').checked = savedOptions.showAirline ?? true;
            document.getElementById('showAircraft').checked = savedOptions.showAircraft ?? true;
            document.getElementById('showClass').checked = savedOptions.showClass ?? false;
            document.getElementById('showMeal').checked = savedOptions.showMeal ?? false;
            document.getElementById('showNotes').checked = savedOptions.showNotes ?? false;
            document.getElementById('showTransit').checked = savedOptions.showTransit ?? true;
            document.getElementById('use24HourFormat').checked = savedOptions.use24HourFormat ?? true;
            if (savedOptions.currency) document.getElementById('currencySelect').value = savedOptions.currency;
        }

        // Load custom branding
        const customLogoData = localStorage.getItem(CUSTOM_LOGO_KEY);
        const customTextData = localStorage.getItem(CUSTOM_TEXT_KEY);
        const logoPreview = document.getElementById('customLogoPreview');
        if (customLogoData && logoPreview) {
            logoPreview.src = customLogoData;
            logoPreview.style.display = 'block';
        }
        if (customTextData) {
            document.getElementById('customTextInput').value = customTextData;
        }

        toggleCustomBrandingSection(); // Set initial visibility
    } catch (e) {
        console.error("Failed to load/parse options from localStorage:", e);
    }
}

// --- NEW: Function to toggle visibility of the custom branding section ---
function toggleCustomBrandingSection() {
    const showLogoCheckbox = document.getElementById('showItineraryLogo');
    const brandingSection = document.getElementById('customBrandingSection');
    if (showLogoCheckbox.checked) {
        brandingSection.classList.remove('hidden');
    } else {
        brandingSection.classList.add('hidden');
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
    const symbols = { USD: 'USD', EUR: 'EUR', INR: 'INR' };
    return symbols[currencyCode] || currencyCode || '';
}

// --- TO (The new, simplified function) ---
async function convertPNR() {
    const output = document.getElementById('output');
    const loadingSpinner = document.getElementById('loadingSpinner');
    const screenshotBtn = document.getElementById('screenshotBtn');
    const copyTextBtn = document.getElementById('copyTextBtn');
    
    loadingSpinner.style.display = 'block';
    screenshotBtn.style.display = 'none';
    copyTextBtn.style.display = 'none';
    output.innerHTML = ''; 

    const payload = {
        pnrText: document.getElementById('pnrInput').value,
        options: {
            showItineraryLogo: document.getElementById('showItineraryLogo').checked,
            showAirline: document.getElementById('showAirline').checked,
            showAircraft: document.getElementById('showAircraft').checked,
            showOperatedBy: document.getElementById('showOperatedBy').checked,
            showClass: document.getElementById('showClass').checked,
            showMeal: document.getElementById('showMeal').checked,
            showNotes: document.getElementById('showNotes').checked,
            showTransit: document.getElementById('showTransit').checked,
            use24HourFormat: document.getElementById('use24HourFormat').checked,
        },
        fareDetails: {
            fare: document.getElementById('fareInput').value,
            tax: document.getElementById('taxInput').value,
            fee: document.getElementById('feeInput').value,
            adult: document.getElementById('adultInput').value,
            currency: document.getElementById('currencySelect').value
        }
    };

    try {
        const response = await fetch('/api/convert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || `Server error: ${response.status}`);
        }
        
        if (data.pnrProcessingAttempted) {
            displayResults(data, payload.options, Date.now());
        }

        if (data.success && data.result?.flights?.length > 0) {
            // We save it here without a screenshot initially.
            // The screenshot will be added later if the user clicks the button.
            saveToHistory(data.result, rawPnrText); 
        }
    
    } catch (error) {
        console.error('Conversion error:', error);
        output.innerHTML = `<div class="error">Failed to process request: ${error.message}</div>`;
    } finally {
        loadingSpinner.style.display = 'none';
    }
}

function displayResults(response, displayPnrOptions, entryId = null) {
    const output = document.getElementById('output');
    const screenshotBtn = document.getElementById('screenshotBtn');
    const copyTextBtn = document.getElementById('copyTextBtn');
    output.innerHTML = '';
    window.currentEntryId = entryId; // Store it globally for the screenshot button

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

    // UPDATED LOGIC TO USE SAVED/DEFAULT LOGO AND TEXT
    if (flights.length > 0 && displayPnrOptions.showItineraryLogo) {
        const logoContainer = document.createElement('div');
        logoContainer.className = 'itinerary-main-logo-container';

        const logoImg = document.createElement('img');
        logoImg.className = 'itinerary-main-logo';
        // Use custom logo from localStorage, or fall back to default
        logoImg.src = localStorage.getItem(CUSTOM_LOGO_KEY) || '/simbavoyages.png';
        logoImg.alt = 'Itinerary Logo';
        logoContainer.appendChild(logoImg);

        const logoText = document.createElement('div');
        logoText.className = 'itinerary-logo-text';
        // Use custom text from localStorage, or fall back to default
        const customText = localStorage.getItem(CUSTOM_TEXT_KEY);
        logoText.innerHTML = customText ? customText.replace(/\n/g, '<br>') : "KN2 Ave 26, Nyarugenge Dist, Muhima<BR>Kigali Rwanda";        
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
        (passengers.length > 1) ? count.textContent = `Total Passengers: ${passengers.length}`: null;
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
                createDetailRow('Departing ', `${flight.departure?.airport} - ${flight.departure?.name} at ${flight.departure?.time}`),
                createDetailRow('Arriving \u00A0\u00A0\u00A0', `${flight.arrival?.airport} - ${flight.arrival?.name} at ${flight.arrival?.time}`),
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
            if (fareValue > 1) fareLines.push(`Total(${currencySymbol}): ${fareValue.toFixed(2)}`);
            if (taxValue > 0) fareLines.push(`Taxes(${currencySymbol}): ${taxValue.toFixed(2)}`);
            if (feeValue > 0) fareLines.push(`Fees(${currencySymbol}): ${feeValue.toFixed(2)}`);
            const perAdultTotal = fareValue + taxValue + feeValue;
            if (adultCount > 1) fareLines.push(`Total(${currencySymbol}) for ${adultCount}: ${(perAdultTotal * adultCount).toFixed(2)}`);
            
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

// NEW: Event listener for the main logo toggle
document.getElementById('showItineraryLogo')?.addEventListener('change', () => {
    toggleCustomBrandingSection();
    saveOptions(); // Save the state of the checkbox
});

// NEW: Event listener for the custom logo file input
document.getElementById('customLogoInput')?.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = e.target.result;
        localStorage.setItem(CUSTOM_LOGO_KEY, dataUrl);
        const logoPreview = document.getElementById('customLogoPreview');
        logoPreview.src = dataUrl;
        logoPreview.style.display = 'block';
        showPopup('Custom logo saved!');
        debouncedConvert(false); // Auto-refresh the itinerary
    };
    reader.readAsDataURL(file);
});

// NEW: Event listener for the custom text input
document.getElementById('customTextInput')?.addEventListener('input', (event) => {
    localStorage.setItem(CUSTOM_TEXT_KEY, event.target.value);
    // No need to call convert here, we can let the debounce handle it
});

// NEW: Event listener to clear custom branding
document.getElementById('clearCustomBrandingBtn')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear your saved logo and text?')) {
        localStorage.removeItem(CUSTOM_LOGO_KEY);
        localStorage.removeItem(CUSTOM_TEXT_KEY);
        document.getElementById('customLogoInput').value = '';
        document.getElementById('customTextInput').value = '';
        document.getElementById('customLogoPreview').style.display = 'none';
        showPopup('Custom branding cleared.');
        debouncedConvert(false);
    }
});

function getMealDescription(mealCode) {
    const mealMap = {
        'B': 'Breakfast', 'L': 'Lunch', 'D': 'Dinner', 'S': 'Snack', 'M': 'Meal',
        'H': 'Hot Meal', 'C': 'Cold Meal', 'R': 'Refreshment', 'K': 'Kosher Meal',
        'V': 'Vegetarian Meal', 'F': 'Food for Purchase', 'O': 'No Meal Service'
        // Add other relevant codes as needed
    };
    return mealMap[mealCode] || `Code ${mealCode}`;
}

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

// UPDATE screenshotBtn listener
document.getElementById('screenshotBtn')?.addEventListener('click', async () => {
    const outputEl = document.getElementById('output');
    if (typeof html2canvas === 'undefined') {
        showPopup('Screenshot library not loaded.');
        return;
    }
    try {
        const canvas = await html2canvas(outputEl, {
            backgroundColor: '#ffffff',
            scale: 2,
            scrollX: -window.scrollX,
            scrollY: -window.scrollY,
            windowWidth: outputEl.scrollWidth,
            windowHeight: outputEl.scrollHeight
        });
        
        // --- NEW LOGIC ---
        // 1. Copy the high-quality image to clipboard
        canvas.toBlob(blob => {
            navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
            showPopup('Screenshot copied to clipboard!');
        });

        // 2. Create a compressed version to save in history
        // Quality set to 0.5 (50%) to reduce size for localStorage
        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.5);

        // 3. Update the history entry if we have an ID for it
        if (window.currentEntryId) {
            updateHistoryWithScreenshot(window.currentEntryId, compressedDataUrl);
        }
        // --- END OF NEW LOGIC ---

    } catch (err) {
        console.error('Screenshot failed:', err);
        showPopup('Could not copy screenshot.');
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

// Add listeners for the new history modal
document.getElementById('historyBtn')?.addEventListener('click', openHistoryModal);
document.getElementById('closeHistoryBtn')?.addEventListener('click', closeHistoryModal);
document.getElementById('historyModal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeHistoryModal();
});
document.getElementById('historySearchInput')?.addEventListener('input', renderHistory);
document.getElementById('historySortSelect')?.addEventListener('change', renderHistory);
document.getElementById('closePreviewBtn')?.addEventListener('click', closeHistoryPreview);

document.addEventListener('DOMContentLoaded', () => {
    loadOptions();
    loadHistory();
});