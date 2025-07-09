const OPTIONS_STORAGE_KEY = 'pnrConverterOptions';
const CUSTOM_LOGO_KEY = 'pnrConverterCustomLogo';
const CUSTOM_TEXT_KEY = 'pnrConverterCustomText';
const HISTORY_STORAGE_KEY = 'pnrConversionHistory';

// --- UTILITY FUNCTIONS ---
function showPopup(message, duration = 3000) {
    const container = document.getElementById('popupContainer');
    if (!container) return;
    const popup = document.createElement('div');
    popup.className = 'popup-notification';
    popup.textContent = message;
    container.appendChild(popup);
    setTimeout(() => popup.classList.add('show'), 10);
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

// --- OPTIONS & BRANDING MANAGEMENT ---
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
    } catch (e) { console.error("Failed to save options:", e); }
}

function loadOptions() {
    try {
        const savedOptions = JSON.parse(localStorage.getItem(OPTIONS_STORAGE_KEY) || '{}');
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
        toggleCustomBrandingSection();
    } catch (e) { console.error("Failed to load options:", e); }
}

function toggleCustomBrandingSection() {
    document.getElementById('customBrandingSection').classList.toggle(
        'hidden', !document.getElementById('showItineraryLogo').checked
    );
}

// --- CORE CONVERSION LOGIC ---
async function convertPNR() {
    const output = document.getElementById('output');
    const loadingSpinner = document.getElementById('loadingSpinner');
    const screenshotBtn = document.getElementById('screenshotBtn');
    const copyTextBtn = document.getElementById('copyTextBtn');
    
    loadingSpinner.style.display = 'block';
    screenshotBtn.style.display = 'none';
    copyTextBtn.style.display = 'none';
    output.innerHTML = ''; 

    const baggageOption = document.querySelector('input[name="baggageOption"]:checked').value;

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
        },
        baggageDetails: {
            option: baggageOption,
            amount: baggageOption !== 'none' ? document.getElementById('baggageAmountInput').value : '',
            unit: baggageOption !== 'none' ? document.getElementById('baggageUnitSelect').value : ''
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
            displayResults(data, payload.options);
            if (data.success && data.result?.flights?.length > 0) {
                historyManager.add(data);
            }
        }
    
    } catch (error) {
        console.error('Conversion error:', error);
        output.innerHTML = `<div class="error">Failed to process request: ${error.message}</div>`;
    } finally {
        loadingSpinner.style.display = 'none';
    }
}

// --- DISPLAY & RENDERING ---
function displayResults(response, displayPnrOptions) {
    const output = document.getElementById('output');
    const screenshotBtn = document.getElementById('screenshotBtn');
    const copyTextBtn = document.getElementById('copyTextBtn');
    output.innerHTML = '';

    if (!response.success) {
        output.innerHTML = `<div class="error">${response.error || 'Conversion failed.'}</div>`;
        return;
    }

    const { flights = [], passengers = [] } = response.result || {};
    
    if (flights.length > 0) {
        screenshotBtn.style.display = 'inline-block';
        copyTextBtn.style.display = 'inline-block';
    } else {
        screenshotBtn.style.display = 'none';
        copyTextBtn.style.display = 'none';
    }

    const outputContainer = document.createElement('div');
    outputContainer.className = 'output-container';

    if (flights.length > 0 && displayPnrOptions.showItineraryLogo) {
        const logoContainer = document.createElement('div');
        logoContainer.className = 'itinerary-main-logo-container';
        const logoImg = document.createElement('img');
        logoImg.className = 'itinerary-main-logo';
        logoImg.src = localStorage.getItem(CUSTOM_LOGO_KEY) || '/simbavoyages.png';
        logoContainer.appendChild(logoImg);
        const logoText = document.createElement('div');
        logoText.className = 'itinerary-logo-text';
        logoText.innerHTML = (localStorage.getItem(CUSTOM_TEXT_KEY) || "KN2 Ave 26, Nyarugenge Dist, Muhima<BR>Kigali Rwanda").replace(/\n/g, '<br>');
        logoContainer.appendChild(logoText);
        outputContainer.appendChild(logoContainer);
    }
    
    if (passengers.length > 0) {
        const headerDiv = document.createElement('div');
        headerDiv.className = 'itinerary-header';
        headerDiv.innerHTML = `<h4>Itinerary for:</h4><p>${passengers.join('<br>')}</p>${passengers.length > 1 ? `<p style="margin-top: 8px; font-style: italic;">Total Passengers: ${passengers.length}</p>` : ''}`;
        outputContainer.appendChild(headerDiv);
    }
    
    if (flights.length > 0) {
        const itineraryBlock = document.createElement('div');
        itineraryBlock.className = 'itinerary-block';
        flights.forEach((flight, i) => {
            if (displayPnrOptions.showTransit && i > 0 && flight.transitTime) {
                const transitDiv = document.createElement('div');
                transitDiv.className = 'transit-item';
                transitDiv.textContent = `------ Transit: ${flight.transitTime} at ${flights[i-1].arrival.city} (${flights[i-1].arrival.airport}) ------`;
                itineraryBlock.appendChild(transitDiv);
            }
            const flightItem = document.createElement('div');
            flightItem.className = 'flight-item';
            
            let detailsHtml = '';
            const { baggageDetails } = response;
            let baggageText = '';
            if (baggageDetails.option !== 'none' && baggageDetails.amount) {
                const text = `${baggageDetails.amount}${baggageDetails.unit}`;
                if (baggageDetails.option === 'alltheway' && i === 0) {
                    baggageText = ` (Checked through)`;
                } else if (baggageDetails.option === 'particular') {
                    baggageText = ` (Per segment)`;
                }
            }
            
            const detailRows = [
                { label: 'Departing ', value: `${flight.departure.airport} - ${flight.departure.name} at ${flight.departure.time}` },
                { label: 'Arriving \u00A0\u00A0\u00A0', value: `${flight.arrival.airport} - ${flight.arrival.name} at ${flight.arrival.time}` },
                { label: 'Baggage', value: (baggageText ? `${baggageDetails.amount}${baggageDetails.unit}${baggageText}` : null) },
                { label: 'Operated by', value: (displayPnrOptions.showOperatedBy && flight.operatedBy) ? flight.operatedBy : null },
                { label: 'Meal', value: (displayPnrOptions.showMeal && flight.meal) ? getMealDescription(flight.meal) : null },
                { label: 'Notes', value: (displayPnrOptions.showNotes && flight.notes?.length) ? flight.notes.join('; ') : null, isNote: true }
            ];

            detailRows.forEach(({label, value, isNote}) => {
                if(value) {
                    detailsHtml += `<div class="flight-detail ${isNote ? 'notes-detail' : ''}"><strong>${label}:</strong> <span>${value}</span></div>`;
                }
            });

            const headerText = [
                flight.date,
                displayPnrOptions.showAirline ? (flight.airline.name || 'Unknown Airline') : '',
                flight.flightNumber,
                flight.duration,
                displayPnrOptions.showAircraft && flight.aircraft ? flight.aircraft : '',
                displayPnrOptions.showClass && flight.travelClass.name ? flight.travelClass.name : ''
            ].filter(Boolean).join(' - ');

            flightItem.innerHTML = `
                <div class="flight-content">
                    ${displayPnrOptions.showAirline ? `<img src="/logos/${(flight.airline.code || 'xx').toLowerCase()}.png" class="airline-logo" alt="${flight.airline.name} logo" onerror="this.onerror=null; this.src='/logos/default-airline.svg';">` : ''}
                    <div>
                        <div class="flight-header">${headerText}</div>
                        ${detailsHtml}
                    </div>
                </div>
            `;
            itineraryBlock.appendChild(flightItem);
        });

        const { fare, tax, fee, adult, currency } = response.fareDetails || {};
        if (fare || tax || fee) {
            const fareValue = parseFloat(fare) || 0, taxValue = parseFloat(tax) || 0, feeValue = parseFloat(fee) || 0;
            const adultCount = parseInt(adult) || 1, currencySymbol = currency || 'USD';
            let fareLines = [];
            if (fareValue > 1) fareLines.push(`Fare(${currencySymbol}): ${fareValue.toFixed(2)}`);
            if (taxValue > 0) fareLines.push(`Taxes(${currencySymbol}): ${taxValue.toFixed(2)}`);
            if (feeValue > 0) fareLines.push(`Fees(${currencySymbol}): ${feeValue.toFixed(2)}`);
            if (adultCount > 1) fareLines.push(`Total(${currencySymbol}) for ${adultCount}: ${((fareValue + taxValue + feeValue) * adultCount).toFixed(2)}`);
            
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
        outputContainer.innerHTML = '<div class="info">No flight segments found or PNR format not recognized.</div>';
    }
    
    if (outputContainer.hasChildNodes()) {
        output.appendChild(outputContainer);
    } else if (!response.pnrProcessingAttempted) {
         output.innerHTML = '<div class="info">Enter PNR data to begin.</div>';
    }
}

function getMealDescription(mealCode) {
    const mealMap = { B: 'Breakfast', L: 'Lunch', D: 'Dinner', S: 'Snack', M: 'Meal', H: 'Hot Meal', C: 'Cold Meal', R: 'Refreshment', V: 'Vegetarian' };
    return mealMap[mealCode] || `Code ${mealCode}`;
}

// --- HISTORY MANAGER ---
const historyManager = {
    get: () => JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]'),
    save: (history) => localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history)),
    add: async function(data) {
        if (!data.success || !data.result?.flights?.length) return;
        const outputEl = document.getElementById('output').querySelector('.output-container');
        if (!outputEl) return;
        try {
            const canvas = await html2canvas(outputEl, { backgroundColor: '#ffffff', scale: 1 });
            const screenshot = canvas.toDataURL('image/jpeg', 0.8);
            
            const history = this.get();
            const newEntry = {
                id: Date.now(),
                pax: data.result.passengers.length ? data.result.passengers[0].split('/')[0] : 'Unknown Passenger',
                route: `${data.result.flights[0].departure.airport} - ${data.result.flights[data.result.flights.length - 1].arrival.airport}`,
                date: new Date().toISOString(),
                pnrText: data.pnrText || document.getElementById('pnrInput').value,
                screenshot: screenshot
            };
            history.unshift(newEntry);
            if (history.length > 50) history.pop(); // Limit history to 50 entries
            this.save(history);
        } catch (err) {
            console.error('Failed to save history item:', err);
        }
    },
    render: function() {
        const listEl = document.getElementById('historyList');
        const search = document.getElementById('historySearchInput').value.toLowerCase();
        const sort = document.getElementById('historySortSelect').value;
        if (!listEl) return;

        let history = this.get();

        if (sort === 'oldest') history.reverse();

        if (search) {
            history = history.filter(item => 
                item.pax.toLowerCase().includes(search) || item.route.toLowerCase().includes(search)
            );
        }
        
        if (history.length === 0) {
            listEl.innerHTML = '<div class="info" style="margin: 10px;">No history found.</div>';
            return;
        }

        listEl.innerHTML = history.map(item => `
            <div class="history-item" data-id="${item.id}">
                <div class="history-item-info">
                    <div class="history-item-pax">${item.pax}</div>
                    <div class="history-item-details">
                        <span>${item.route}</span>
                        <span>${new Date(item.date).toLocaleString()}</span>
                    </div>
                </div>
                <div class="history-item-actions">
                    <button class="use-history-btn">Use This</button>
                </div>
            </div>
        `).join('');
    },
    init: function() {
        document.getElementById('historyBtn')?.addEventListener('click', () => {
            this.render();
            document.getElementById('historyModal')?.classList.remove('hidden');
        });
        document.getElementById('closeHistoryBtn')?.addEventListener('click', () => {
            document.getElementById('historyModal')?.classList.add('hidden');
            document.getElementById('historyPreviewPanel')?.classList.add('hidden');
        });
        document.getElementById('historySearchInput')?.addEventListener('input', () => this.render());
        document.getElementById('historySortSelect')?.addEventListener('change', () => this.render());
        document.getElementById('historyList')?.addEventListener('click', (e) => {
            const itemEl = e.target.closest('.history-item');
            if (!itemEl) return;
            const id = Number(itemEl.dataset.id);
            const history = this.get();
            const entry = history.find(item => item.id === id);
            if (!entry) return;

            if (e.target.classList.contains('use-history-btn')) {
                document.getElementById('pnrInput').value = entry.pnrText;
                document.getElementById('historyModal').classList.add('hidden');
                debouncedConvert();
            } else { // Clicked on the info part to preview
                const previewContent = document.getElementById('previewContent');
                previewContent.innerHTML = `<h4>Screenshot</h4><img src="${entry.screenshot}" alt="Itinerary Screenshot"><hr><h4>Raw PNR Data</h4><pre>${entry.pnrText}</pre>`;
                document.getElementById('historyPreviewPanel').classList.remove('hidden');
            }
        });
        document.getElementById('closePreviewBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('historyPreviewPanel').classList.add('hidden');
        });
    }
};

// --- EVENT LISTENERS ---
const debouncedConvert = debounce(convertPNR, 400);

document.addEventListener('DOMContentLoaded', () => {
    loadOptions();
    historyManager.init();

    // Input area listeners
    document.getElementById('pnrInput').addEventListener('input', debouncedConvert);
    document.getElementById('clearBtn').addEventListener('click', () => {
        document.getElementById('pnrInput').value = '';
        document.getElementById('output').innerHTML = '<div class="info">Enter PNR data to begin.</div>';
        document.getElementById('screenshotBtn').style.display = 'none';
        document.getElementById('copyTextBtn').style.display = 'none';
    });
    document.getElementById('pasteBtn').addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            document.getElementById('pnrInput').value = text;
            debouncedConvert();
        } catch (err) {
            showPopup('Could not paste from clipboard.');
        }
    });

    // Options listeners
    [...document.querySelectorAll('.options input, #currencySelect, .fare-options input, .baggage-options input, #baggageAmountInput, #baggageUnitSelect')].forEach(el => {
        el.addEventListener('change', () => {
            if (el.type === 'checkbox' || el.id === 'currencySelect') saveOptions();
            debouncedConvert();
        });
    });

    // Baggage UI toggle
    document.querySelectorAll('input[name="baggageOption"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const showInputs = radio.value === 'alltheway' || radio.value === 'particular';
            document.getElementById('allTheWayInputs').classList.toggle('visible', showInputs);
        });
    });

    // Branding listeners
    document.getElementById('showItineraryLogo').addEventListener('change', () => {
        toggleCustomBrandingSection();
        saveOptions();
        debouncedConvert();
    });
    document.getElementById('customLogoInput').addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            localStorage.setItem(CUSTOM_LOGO_KEY, e.target.result);
            document.getElementById('customLogoPreview').src = e.target.result;
            document.getElementById('customLogoPreview').style.display = 'block';
            showPopup('Custom logo saved!');
            debouncedConvert();
        };
        reader.readAsDataURL(file);
    });
    document.getElementById('customTextInput').addEventListener('input', debounce((event) => {
        localStorage.setItem(CUSTOM_TEXT_KEY, event.target.value);
        debouncedConvert();
    }, 400));
    document.getElementById('clearCustomBrandingBtn').addEventListener('click', () => {
        if (confirm('Are you sure you want to clear your saved logo and text?')) {
            localStorage.removeItem(CUSTOM_LOGO_KEY);
            localStorage.removeItem(CUSTOM_TEXT_KEY);
            document.getElementById('customLogoInput').value = '';
            document.getElementById('customTextInput').value = '';
            document.getElementById('customLogoPreview').style.display = 'none';
            showPopup('Custom branding cleared.');
            debouncedConvert();
        }
    });

    // Output action buttons
    document.getElementById('screenshotBtn').addEventListener('click', async () => {
        const outputEl = document.getElementById('output');
        try {
            const canvas = await html2canvas(outputEl.querySelector('.output-container'), { backgroundColor: '#ffffff', scale: 2 });
            canvas.toBlob(blob => navigator.clipboard.write([new ClipboardItem({'image/png': blob})]));
            showPopup('Screenshot copied to clipboard!');
        } catch (err) {
            showPopup('Could not copy screenshot.');
        }
    });
    document.getElementById('copyTextBtn').addEventListener('click', () => {
        const text = document.getElementById('output').innerText;
        navigator.clipboard.writeText(text).then(() => {
            showPopup('Itinerary copied as text!');
        }).catch(() => showPopup('Failed to copy text.'));
    });
});