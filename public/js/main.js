// --- LOCALSTORAGE KEYS ---
const OPTIONS_STORAGE_KEY = 'pnrConverterOptions';
const BRAND_LIST_KEY = 'pnrConverterBrandList'; // Stores the array of all custom brands
const LAST_BRAND_KEY = 'pnrLastSelectedBrand'; // Stores the NAME of the last used brand

// --- GLOBAL STATE ---
let allBrands = []; // Will hold the list of brands loaded from localStorage

// --- CORE UI FUNCTIONS ---

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
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
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
    } catch (e) {
        console.error("Failed to save options to localStorage:", e);
    }
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
    } catch (e) {
        console.error("Failed to load/parse options from localStorage:", e);
    }
}

function toggleCustomBrandingSection() {
    const showLogoCheckbox = document.getElementById('showItineraryLogo');
    const brandingSection = document.getElementById('customBrandingSection');
    brandingSection.classList.toggle('hidden', !showLogoCheckbox.checked);
}

// --- LOCAL BRAND MANAGEMENT ---

function loadBrands() {
    const brandsJSON = localStorage.getItem(BRAND_LIST_KEY);
    allBrands = brandsJSON ? JSON.parse(brandsJSON) : [];
    
    const selector = document.getElementById('brandSelector');
    selector.innerHTML = '<option value="custom">-- Custom Branding --</option>'; // Default non-saved option

    allBrands.forEach(brand => {
        const option = document.createElement('option');
        option.value = brand.name;
        option.textContent = brand.name;
        selector.appendChild(option);
    });

    const lastBrandName = localStorage.getItem(LAST_BRAND_KEY);
    if (lastBrandName && allBrands.some(b => b.name === lastBrandName)) {
        selector.value = lastBrandName;
    }
    applySelectedBrand();
}

function applySelectedBrand() {
    const selector = document.getElementById('brandSelector');
    const selectedBrandName = selector.value;
    localStorage.setItem(LAST_BRAND_KEY, selectedBrandName);

    const logoPreview = document.getElementById('customLogoPreview');
    const textInput = document.getElementById('customTextInput');
    const logoInput = document.getElementById('customLogoInput');

    if (selectedBrandName === 'custom') {
        // In "Custom" mode, the inputs are independent.
        // We don't change them, allowing the user to create a new unsaved brand.
    } else {
        const selectedBrand = allBrands.find(b => b.name === selectedBrandName);
        if (selectedBrand) {
            logoPreview.src = selectedBrand.logo;
            logoPreview.style.display = 'block';
            textInput.value = selectedBrand.text;
        }
    }
    logoInput.value = ''; // Always clear file input on selection change
    debouncedConvert();
}

function saveNewBrand() {
    const brandName = prompt("Enter a name for this new brand:");
    if (!brandName || !brandName.trim()) {
        showPopup("Brand name cannot be empty.");
        return;
    }

    if (allBrands.some(b => b.name.toLowerCase() === brandName.trim().toLowerCase())) {
        showPopup(`A brand named "${brandName}" already exists.`);
        return;
    }

    const logoDataUrl = document.getElementById('customLogoPreview').src;
    const textData = document.getElementById('customTextInput').value;

    if (!logoDataUrl.startsWith('data:image') || !textData) {
        showPopup("Please upload a logo and add text before saving.");
        return;
    }

    const newBrand = { name: brandName.trim(), logo: logoDataUrl, text: textData };
    allBrands.push(newBrand);
    localStorage.setItem(BRAND_LIST_KEY, JSON.stringify(allBrands));

    showPopup(`Brand "${brandName}" saved successfully!`);
    loadBrands();
    
    document.getElementById('brandSelector').value = newBrand.name;
    applySelectedBrand();
}

// --- MAIN PNR CONVERSION & DISPLAY LOGIC ---

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
    };

    const payload = {
        pnrText: rawInput, 
        options: clientPnrDisplayOptions,
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
        if (!response.ok) throw new Error(data.error || `Server error: ${response.status} ${response.statusText}`);
        
        displayResults(data, clientPnrDisplayOptions);
    
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
        const customLogoSrc = document.getElementById('customLogoPreview').src;
        const customText = document.getElementById('customTextInput').value;
        
        if (customLogoSrc.startsWith('data:image')) {
            const logoContainer = document.createElement('div');
            logoContainer.className = 'itinerary-main-logo-container';
            
            const logoImg = document.createElement('img');
            logoImg.className = 'itinerary-main-logo';
            logoImg.src = customLogoSrc;
            logoContainer.appendChild(logoImg);

            const logoText = document.createElement('div');
            logoText.className = 'itinerary-logo-text';
            logoText.innerHTML = customText ? customText.replace(/\n/g, '<br>') : '';
            logoContainer.appendChild(logoText);

            outputContainer.appendChild(logoContainer);
        }
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

            function createDetailRow(label, value, customClass = '') {
                if (!value) return null;
                const detailDiv = document.createElement('div');
                detailDiv.className = `flight-detail ${customClass}`;
                const strong = document.createElement('strong');
                strong.textContent = label + ':';
                detailDiv.appendChild(strong);
                const textValue = (label === 'Notes') ? value.join('\n') : value;
                detailDiv.appendChild(document.createTextNode(` ${textValue}`));
                return detailDiv;
            }

            function getMealDescription(mealCode) {
                 const mealMap = {'B':'Breakfast','L':'Lunch','D':'Dinner','S':'Snack','M':'Meal'};
                 return mealMap[mealCode] || `Code ${mealCode}`;
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
                displayPnrOptions.showOperatedBy && flight.operatedBy ? createDetailRow('Operated by', flight.operatedBy) : null,
                displayPnrOptions.showMeal ? createDetailRow('Meal', getMealDescription(flight.meal)) : null,
                displayPnrOptions.showNotes && flight.notes?.length ? createDetailRow('Notes', flight.notes, 'notes-detail') : null,
            ].forEach(el => { if (el) detailsContainer.appendChild(el); });

            flightContentDiv.appendChild(detailsContainer);
            flightItem.appendChild(flightContentDiv);
            itineraryBlock.appendChild(flightItem);
        }
        
        const { fare, tax, fee, adult, currency } = response.fareDetails || {};
        const getCurrencySymbol = (code) => ({ USD: '$', EUR: '€', INR: '₹' }[code] || code);
        if (fare || tax || fee) {
            const fareValue = parseFloat(fare) || 0, taxValue = parseFloat(tax) || 0, feeValue = parseFloat(fee) || 0;
            const adultCount = parseInt(adult) || 1, currencySymbol = getCurrencySymbol(currency);
            let fareLines = [];
            if (fareValue > 1) fareLines.push(`Fare: ${currencySymbol}${fareValue.toFixed(2)}`);
            if (taxValue > 0) fareLines.push(`Taxes: ${currencySymbol}${taxValue.toFixed(2)}`);
            if (feeValue > 0) fareLines.push(`Fees: ${currencySymbol}${feeValue.toFixed(2)}`);
            const perAdultTotal = fareValue + taxValue + feeValue;
            if (adultCount > 1) fareLines.push(`Total for ${adultCount} Pax: ${currencySymbol}${(perAdultTotal * adultCount).toFixed(2)}`);
            
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


// --- EVENT LISTENERS ---

const debouncedConvert = debounce(convertPNR, 300);

document.addEventListener('DOMContentLoaded', () => {
    loadOptions();
    loadBrands();
});

// Brand Management
document.getElementById('brandSelector')?.addEventListener('change', applySelectedBrand);
document.getElementById('saveAsBrandBtn')?.addEventListener('click', saveNewBrand);
document.getElementById('clearCustomBrandingBtn')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear your custom branding? This will switch to "Custom" mode.')) {
        document.getElementById('brandSelector').value = 'custom';
        applySelectedBrand();
    }
});

// Custom Branding Inputs
document.getElementById('customLogoInput')?.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = e.target.result;
        document.getElementById('customLogoPreview').src = dataUrl;
        document.getElementById('customLogoPreview').style.display = 'block';
        document.getElementById('brandSelector').value = 'custom';
        localStorage.setItem(LAST_BRAND_KEY, 'custom');
        debouncedConvert();
    };
    reader.readAsDataURL(file);
});
document.getElementById('customTextInput')?.addEventListener('input', () => {
    document.getElementById('brandSelector').value = 'custom';
    localStorage.setItem(LAST_BRAND_KEY, 'custom');
    debouncedConvert();
});

// Main Action Buttons
document.getElementById('pasteBtn')?.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    document.getElementById('pnrInput').value = text || '';
    convertPNR();
  } catch (err) {
    showPopup('Could not paste from clipboard.');
  }
});
document.getElementById('pnrInput').addEventListener('input', debouncedConvert);
document.getElementById('convertBtn').addEventListener('click', convertPNR);

// Generic Listener for all display and fare options
[...document.querySelectorAll('.options input, #currencySelect, #adultInput, #fareInput, #taxInput, #feeInput')].forEach(el => {
    el.addEventListener('change', () => {
        saveOptions();
        debouncedConvert();
    });
});

// Output Action Buttons
document.getElementById('screenshotBtn')?.addEventListener('click', async () => {
    if (typeof html2canvas === 'undefined') return showPopup('Screenshot library not loaded.');
    const outputEl = document.getElementById('output');
    try {
        const canvas = await html2canvas(outputEl, { backgroundColor: '#ffffff', scale: 2 });
        canvas.toBlob(blob => navigator.clipboard.write([new ClipboardItem({'image/png': blob})]));
        showPopup('Screenshot copied to clipboard!');
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