// --- GLOBAL STATE & CONSTANTS ---
const OPTIONS_STORAGE_KEY = 'pnrConverterOptions';
const LAST_BRAND_KEY = 'pnrLastSelectedBrand';
const HISTORY_KEY = 'pnrConversionHistory';

let allBrands = [];
let conversionHistory = [];
let developerModeActiveOnClient = false;

// --- CORE UI & HELPER FUNCTIONS ---

function showPopup(message, duration = 3000) {
    const container = document.getElementById('popupContainer');
    if (!container) return;
    const popup = document.createElement('div');
    popup.className = 'popup-notification';
    popup.textContent = message;
    container.appendChild(popup);
    setTimeout(() => { popup.classList.add('show'); }, 10);
    setTimeout(() => {
        popup.classList.remove('show');
        popup.addEventListener('transitionend', () => popup.remove());
    }, duration);
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

function getMealDescription(mealCode) {
    const mealMap = {
        'B': 'Breakfast', 'L': 'Lunch', 'D': 'Dinner', 'S': 'Snack', 'M': 'Meal',
        'H': 'Hot Meal', 'C': 'Cold Meal', 'R': 'Refreshment', 'K': 'Kosher Meal',
        'V': 'Vegetarian Meal', 'F': 'Food for Purchase', 'O': 'No Meal Service'
    };
    return mealMap[mealCode] || `Code ${mealCode}`;
}

// --- LOCAL OPTIONS & BRANDING MANAGEMENT ---

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
    } catch (e) { console.error("Failed to save options to localStorage:", e); }
}

function loadOptions() {
    try {
        const savedOptionsJSON = localStorage.getItem(OPTIONS_STORAGE_KEY);
        if (savedOptionsJSON) {
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
        }
        toggleCustomBrandingSection();
    } catch (e) { console.error("Failed to load/parse options from localStorage:", e); }
}

function toggleCustomBrandingSection() {
    const showLogoCheckbox = document.getElementById('showItineraryLogo');
    const brandingSection = document.getElementById('customBrandingSection');
    brandingSection.classList.toggle('hidden', !showLogoCheckbox.checked);
}

// --- SHARED BRAND MANAGEMENT (VIA API) ---

async function loadBrands() {
    try {
        const response = await fetch('/api/brands');
        const data = await response.json();
        if (!data.success) throw new Error(data.error);
        allBrands = data.brands || [];
        const selector = document.getElementById('brandSelector');
        selector.innerHTML = '<option value="default">-- Select a Brand --</option>';
        allBrands.forEach((brand, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = brand.name;
            selector.appendChild(option);
        });
        const lastBrandIndex = localStorage.getItem(LAST_BRAND_KEY);
        if (lastBrandIndex && lastBrandIndex < allBrands.length) {
            selector.value = lastBrandIndex;
            applySelectedBrand();
        }
    } catch (error) {
        console.error("Failed to load brands:", error);
        showPopup("Could not load brand presets.");
    }
}

function applySelectedBrand() {
    const selector = document.getElementById('brandSelector');
    const selectedIndex = selector.value;
    localStorage.setItem(LAST_BRAND_KEY, selectedIndex);
    const logoPreview = document.getElementById('customLogoPreview');
    const textInput = document.getElementById('customTextInput');
    if (selectedIndex === 'default' || !allBrands[selectedIndex]) {
        logoPreview.style.display = 'none';
        logoPreview.src = '';
        textInput.value = '';
    } else {
        const selectedBrand = allBrands[selectedIndex];
        logoPreview.src = selectedBrand.logo;
        logoPreview.style.display = 'block';
        textInput.value = selectedBrand.text;
    }
    debouncedConvert();
}

async function saveNewBrand() {
    const brandName = prompt("Enter a name for this new brand:");
    if (!brandName || !brandName.trim()) {
        showPopup("Brand name cannot be empty.");
        return;
    }
    const logoDataUrl = document.getElementById('customLogoPreview').src;
    const textData = document.getElementById('customTextInput').value;
    if (!logoDataUrl.startsWith('data:image') || !textData) {
        showPopup("Please upload a logo and add text before saving.");
        return;
    }
    showPopup("Saving brand...");
    try {
        const response = await fetch('/api/save-brand', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: brandName.trim(), logo: logoDataUrl, text: textData })
        });
        const result = await response.json();
        if (!result.success) throw new Error(result.error);
        showPopup(result.message);
        await loadBrands();
        const newBrandIndex = allBrands.findIndex(b => b.name === brandName.trim());
        if(newBrandIndex > -1) {
            document.getElementById('brandSelector').value = newBrandIndex;
            applySelectedBrand();
        }
    } catch (error) {
        console.error("Failed to save brand:", error);
        showPopup(`Error: ${error.message}`);
    }
}

// --- HISTORY MANAGEMENT ---

function saveToHistory(resultObject, rawPnrText, screenshotDataUrl = null) {
    if (!resultObject?.flights?.length) return;
    const historyEntry = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        data: resultObject,
        rawText: rawPnrText,
        screenshot: screenshotDataUrl
    };
    conversionHistory.unshift(historyEntry);
    if (conversionHistory.length > 30) {
        conversionHistory = conversionHistory.slice(0, 30);
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(conversionHistory));
}

function updateHistoryWithScreenshot(entryId, screenshotDataUrl) {
    const entryIndex = conversionHistory.findIndex(entry => entry.id === entryId);
    if (entryIndex > -1) {
        conversionHistory[entryIndex].screenshot = screenshotDataUrl;
        localStorage.setItem(HISTORY_KEY, JSON.stringify(conversionHistory));
        showPopup("Screenshot saved to this history entry.");
    }
}

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

function renderHistory() {
    const historyList = document.getElementById('historyList');
    const searchTerm = document.getElementById('historySearchInput').value.toLowerCase();
    const sortOrder = document.getElementById('historySortSelect').value;
    historyList.innerHTML = '';
    let filteredHistory = [...conversionHistory];
    if (searchTerm) {
        filteredHistory = filteredHistory.filter(entry => {
            const pax = (entry.data.passengers[0] || '').toLowerCase();
            const route = entry.data.flights.map(f => f.departure.airport).join('-').toLowerCase();
            return pax.includes(searchTerm) || route.includes(searchTerm);
        });
    }
    filteredHistory.sort((a, b) => sortOrder === 'oldest' ? new Date(a.timestamp) - new Date(b.timestamp) : new Date(b.timestamp) - new Date(a.timestamp));
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
        item.innerHTML = `<div class="history-item-info"><div class="history-item-pax">${paxName}</div><div class="history-item-details"><span>Route: <strong>${route}</strong></span><span>Saved: ${flightDate.toLocaleDateString()}</span></div></div><div class="history-item-actions"><button class="load-btn">Load</button></div>`;
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

function closeHistoryPreview() { document.getElementById('historyPreviewPanel').classList.add('hidden'); }
function openHistoryModal() { renderHistory(); document.getElementById('historyModal').classList.remove('hidden'); }
function closeHistoryModal() { closeHistoryPreview(); document.getElementById('historyModal').classList.add('hidden'); }

function loadFromHistory(entry) {
    const mockResponse = { success: true, result: entry.data };
    displayResults(mockResponse, getDisplayOptions(), entry.id);
    document.getElementById('pnrInput').value = entry.rawText;
    showPopup("Loaded itinerary from history.");
    closeHistoryModal();
}

function getDisplayOptions() {
    return {
        showItineraryLogo: document.getElementById('showItineraryLogo').checked,
        showAirline: document.getElementById('showAirline').checked,
        showAircraft: document.getElementById('showAircraft').checked,
        showOperatedBy: document.getElementById('showOperatedBy').checked,
        showClass: document.getElementById('showClass').checked,
        showMeal: document.getElementById('showMeal').checked,
        showNotes: document.getElementById('showNotes').checked,
        showTransit: document.getElementById('showTransit').checked,
        use24HourFormat: document.getElementById('use24HourFormat').checked,
    };
}

// --- MAIN PNR CONVERSION & DISPLAY LOGIC ---

const debouncedConvert = debounce(convertPNR, 300);

async function convertPNR() {
    const output = document.getElementById('output');
    const loadingSpinner = document.getElementById('loadingSpinner');
    const screenshotBtn = document.getElementById('screenshotBtn');
    const copyTextBtn = document.getElementById('copyTextBtn');
    const rawInput = document.getElementById('pnrInput').value;
    
    loadingSpinner.style.display = 'block';
    screenshotBtn.style.display = 'none';
    copyTextBtn.style.display = 'none';
    output.innerHTML = ''; 

    const developerModeTrigger = rawInput.toLowerCase().includes("developer") ? "developer" : "none";
    
    const payload = {
        pnrText: rawInput.replace(/developer/gi, '').trim(),
        options: getDisplayOptions(),
        fareDetails: {
            fare: document.getElementById('fareInput').value,
            tax: document.getElementById('taxInput').value,
            fee: document.getElementById('feeInput').value,
            adult: document.getElementById('adultInput').value,
            currency: document.getElementById('currencySelect').value
        },
        developerModeTrigger
    };

    try {
        const response = await fetch('/api/convert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Server error`);
        
        // Save to history on successful conversion
        if (data.success && data.result?.flights?.length > 0) {
            saveToHistory(data.result, rawInput);
        }
        
        displayResults(data, payload.options, Date.now());

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
    window.currentEntryId = entryId;

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

    const outputContainer = document.createElement('div');
    outputContainer.className = 'output-container';

    if (flights.length > 0 && displayPnrOptions.showItineraryLogo) {
        const logoContainer = document.createElement('div');
        logoContainer.className = 'itinerary-main-logo-container';
        const logoImg = document.createElement('img');
        logoImg.className = 'itinerary-main-logo';
        const customLogoSrc = document.getElementById('customLogoPreview').src;
        logoImg.src = (customLogoSrc && customLogoSrc.startsWith('data:')) ? customLogoSrc : '/simbavoyages.png';
        logoContainer.appendChild(logoImg);
        const logoText = document.createElement('div');
        logoText.className = 'itinerary-logo-text';
        const customText = document.getElementById('customTextInput').value;
        logoText.innerHTML = customText ? customText.replace(/\n/g, '<br>') : "KN2 Ave 26, Nyarugenge Dist, Muhima<br>Kigali Rwanda";
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
        if (passengers.length > 1) {
            count.textContent = `Total Passengers: ${passengers.length}`;
        }
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
            const createDetailRow = (label, value, customClass = '') => {
                if (!value) return null;
                const detailDiv = document.createElement('div');
                detailDiv.className = `flight-detail ${customClass}`;
                const strong = document.createElement('strong');
                strong.textContent = label + ':';
                detailDiv.appendChild(strong);
                const textValue = (label === 'Notes') ? value.join('\n') : value;
                detailDiv.appendChild(document.createTextNode(` ${textValue}`));
                return detailDiv;
            };
            const flightContentDiv = document.createElement('div');
            flightContentDiv.className = 'flight-content';
            if (displayPnrOptions.showAirline) {
                const logo = document.createElement('img');
                logo.src = `/logos/${(flight.airline?.code || 'xx').toLowerCase()}.png`;
                logo.className = 'airline-logo';
                logo.alt = `${flight.airline?.name} logo`;
                logo.onerror = function() { this.onerror = null; this.src = '/logos/default-airline.svg'; };
                flightContentDiv.appendChild(logo);
            }
            const detailsContainer = document.createElement('div');
            const headerDiv = document.createElement('div');
            headerDiv.className = 'flight-header';
            let headerText = `${flight.date} - ${displayPnrOptions.showAirline ? (flight.airline?.name || 'Unknown') : ''} ${flight.flightNumber} - ${flight.duration}`;
            if (displayPnrOptions.showAircraft && flight.aircraft) headerText += ` - ${flight.aircraft}`;
            if (displayPnrOptions.showClass && flight.travelClass?.name) headerText += ` - ${flight.travelClass.name}`;
            headerDiv.textContent = headerText;
            detailsContainer.appendChild(headerDiv);
            [
                createDetailRow('Departing ', `${flight.departure?.airport} - ${flight.departure?.name} at ${flight.departure?.time}`),
                createDetailRow('Arriving    ', `${flight.arrival?.airport} - ${flight.arrival?.name} at ${flight.arrival?.time}`),
                displayPnrOptions.showOperatedBy && flight.operatedBy ? createDetailRow('Operated by', flight.operatedBy) : null,
                displayPnrOptions.showMeal ? createDetailRow('Meal', getMealDescription(flight.meal)) : null,
                displayPnrOptions.showNotes && flight.notes?.length ? createDetailRow('Notes', flight.notes, 'notes-detail') : null,
            ].forEach(el => { if (el) detailsContainer.appendChild(el); });
            flightContentDiv.appendChild(detailsContainer);
            flightItem.appendChild(flightContentDiv);
            itineraryBlock.appendChild(flightItem);
        }
        const { fare, tax, fee, adult, currency } = response.fareDetails || {};
        if (fare || tax || fee) {
            const fareValue = parseFloat(fare) || 0, taxValue = parseFloat(tax) || 0, feeValue = parseFloat(fee) || 0;
            const adultCount = parseInt(adult) || 1, currencySymbol = getCurrencySymbol(currency);
            let fareLines = [];
            if (fareValue > 1) fareLines.push(`Fare: ${currencySymbol} ${fareValue.toFixed(2)}`);
            if (taxValue > 0) fareLines.push(`Taxes: ${currencySymbol} ${taxValue.toFixed(2)}`);
            if (feeValue > 0) fareLines.push(`Fees: ${currencySymbol} ${feeValue.toFixed(2)}`);
            const perAdultTotal = fareValue + taxValue + feeValue;
            if (adultCount > 1) fareLines.push(`Total for ${adultCount} Pax: ${currencySymbol} ${(perAdultTotal * adultCount).toFixed(2)}`);
            if (fareLines.length > 0) {
                const fareDiv = document.createElement('div');
                fareDiv.className = 'fare-summary';
                fareDiv.textContent = fareLines.join('\n');
                itineraryBlock.appendChild(fareDiv);
            }
        }
        outputContainer.appendChild(itineraryBlock);
    } 
    else if (response.pnrProcessingAttempted) {
        const infoDiv = document.createElement('div');
        infoDiv.className = 'info';
        infoDiv.style.margin = '15px';
        infoDiv.textContent = 'No flight segments found or PNR format not recognized.';
        outputContainer.appendChild(infoDiv);
    }
    
    if (outputContainer.hasChildNodes()) {
        output.appendChild(outputContainer);
    } else if (!response.pnrProcessingAttempted) {
         output.innerHTML = '<div class="info">Enter PNR data and click "Convert PNR".</div>';
    }
}


// --- EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
    loadOptions();
    loadHistory();
    // Intentionally not calling loadBrands() as it is not part of the old functionality
});

document.getElementById('showItineraryLogo')?.addEventListener('change', toggleCustomBrandingSection);

document.getElementById('customLogoInput')?.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = e.target.result;
        // Save to localStorage for old functionality
        localStorage.setItem('pnrConverterCustomLogo', dataUrl);
        const logoPreview = document.getElementById('customLogoPreview');
        logoPreview.src = dataUrl;
        logoPreview.style.display = 'block';
        showPopup('Custom logo saved locally!');
        debouncedConvert();
    };
    reader.readAsDataURL(file);
});

document.getElementById('customTextInput')?.addEventListener('input', (event) => {
    localStorage.setItem('pnrConverterCustomText', event.target.value);
    debouncedConvert();
});

document.getElementById('clearCustomBrandingBtn')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear your saved logo and text?')) {
        localStorage.removeItem('pnrConverterCustomLogo');
        localStorage.removeItem('pnrConverterCustomText');
        document.getElementById('customLogoInput').value = '';
        document.getElementById('customTextInput').value = '';
        document.getElementById('customLogoPreview').style.display = 'none';
        showPopup('Custom branding cleared.');
        debouncedConvert();
    }
});

document.getElementById('pasteBtn')?.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    const pnrInput = document.getElementById('pnrInput');
    if (!text || text.trim() === '') { pnrInput.focus(); return; }
    pnrInput.value = text;
    pnrInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    pnrInput.focus();
  } catch (err) {
    console.error('Failed to read clipboard contents: ', err);
    showPopup('Could not paste from clipboard.');
  }
});

document.getElementById('pnrInput').addEventListener('input', debouncedConvert);
// NEW: Event listener for the Clear button
document.getElementById('clearBtn')?.addEventListener('click', () => {
    document.getElementById('pnrInput').value = '';
    document.getElementById('output').innerHTML = '<div class="info">Enter PNR data to begin.</div>';
    // Also hide the screenshot/copy buttons
    document.getElementById('screenshotBtn').style.display = 'none';
    document.getElementById('copyTextBtn').style.display = 'none';
    showPopup("Input cleared.");
});
[...document.querySelectorAll('.options input, #currencySelect, #adultInput, #fareInput, #taxInput, #feeInput')].forEach(el => {
    if (el.id === 'showItineraryLogo') return;
    el.addEventListener('change', () => {
        saveOptions();
        debouncedConvert();
    });
});

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
        
        canvas.toBlob(blob => {
            navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
            showPopup('Screenshot copied to clipboard!');
        });

        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.5);
        if (window.currentEntryId) {
            updateHistoryWithScreenshot(window.currentEntryId, compressedDataUrl);
        }

    } catch (err) {
        console.error('Screenshot failed:', err);
        showPopup('Could not copy screenshot.');
    }
});

document.getElementById('copyTextBtn')?.addEventListener('click', () => {
    const outputContainer = document.querySelector('.output-container');
    if (!outputContainer) return;
    const textToCopy = outputContainer.innerText; 
    navigator.clipboard.writeText(textToCopy).then(() => {
        showPopup('Itinerary copied to clipboard as text!');
    }).catch(err => {
        console.error('Could not copy text: ', err);
        showPopup('Failed to copy text.');
    });
});

document.getElementById('historyBtn')?.addEventListener('click', openHistoryModal);
document.getElementById('closeHistoryBtn')?.addEventListener('click', closeHistoryModal);
document.getElementById('historyModal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeHistoryModal();
});
document.getElementById('historySearchInput')?.addEventListener('input', renderHistory);
document.getElementById('historySortSelect')?.addEventListener('change', renderHistory);
document.getElementById('closePreviewBtn')?.addEventListener('click', closeHistoryPreview);