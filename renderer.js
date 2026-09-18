const { ipcRenderer } = require('electron');
const path = require('path');

// Load saved form data from localStorage
function loadFormData() {
    const savedData = localStorage.getItem('supportDeskFormData');
    if (savedData) {
        try {
            const formData = JSON.parse(savedData);
            if (formData.fullName) document.getElementById('full-name').value = formData.fullName;
            if (formData.companyName) document.getElementById('company-name').value = formData.companyName;
            if (formData.province) document.getElementById('province').value = formData.province;
            if (formData.email) document.getElementById('email').value = formData.email;
            if (formData.phone) document.getElementById('phone-input').value = formData.phone;
            console.log('Loaded saved form data');
        } catch (e) {
            console.error('Error loading saved form data:', e);
        }
    }
}

// Save form data to localStorage
function saveFormData(formData) {
    try {
        const dataToSave = {
            fullName: formData.fullName,
            companyName: formData.companyName,
            province: formData.province,
            email: formData.email,
            phone: formData.phone
        };
        localStorage.setItem('supportDeskFormData', JSON.stringify(dataToSave));
        console.log('Form data saved to localStorage');
    } catch (e) {
        console.error('Error saving form data:', e);
    }
}

// Clear saved form data
function clearSavedData() {
    localStorage.removeItem('supportDeskFormData');
    document.getElementById('full-name').value = '';
    document.getElementById('company-name').value = '';
    document.getElementById('province').value = '';
    document.getElementById('email').value = '';
    document.getElementById('phone-input').value = '';
    
    // Show confirmation message
    const statusElement = document.getElementById('ticket-status');
    if (statusElement) {
        const originalContent = statusElement.innerHTML;
        statusElement.innerHTML = `
            <div class="alert alert-info" style="margin-top: 10px;">
                Saved form data has been cleared.
            </div>
        `;
        
        // Restore original content after 3 seconds
        setTimeout(() => {
            statusElement.innerHTML = originalContent;
        }, 3000);
    }
}

// Add clear button functionality
function initClearButton() {
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn-sm btn-outline-secondary mt-2';
    clearBtn.style.width = '100%';
    clearBtn.innerHTML = '<i class="bi bi-x-circle"></i> Clear Saved Details';
    clearBtn.onclick = clearSavedData;
    
    const formGroup = document.querySelector('.form-group:last-child');
    if (formGroup) {
        formGroup.parentNode.insertBefore(clearBtn, formGroup.nextSibling);
    }
}

// Ticket Form Submission
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded and parsed');

    // Hide DBS Toolbox on macOS (Windows-only utilities)
    if (process.platform === 'darwin') {
        const toolboxToggle = document.getElementById('toolbox-toggle');
        if (toolboxToggle) toolboxToggle.style.display = 'none';
        const toolboxPopup = document.getElementById('toolbox-popup');
        if (toolboxPopup) toolboxPopup.style.display = 'none';
    }

    // Get form and critical elements
    const ticketForm = document.getElementById('ticket-form');
    const fullNameInput = document.getElementById('full-name');
    const companyNameInput = document.getElementById('company-name');
    const provinceInput = document.getElementById('province');
    const emailInput = document.getElementById('email');
    const phoneInput = document.getElementById('phone-input');
    const descriptionInput = document.getElementById('description');
    const ticketStatus = document.getElementById('ticket-status');
    const submitButton = ticketForm ? ticketForm.querySelector('button[type="submit"]') : null;
    
    // Load saved form data and initialize clear button
    loadFormData();
    initClearButton();

    // Log element existence
    console.log('Critical Elements Check:', {
        ticketForm: !!ticketForm,
        fullNameInput: !!fullNameInput,
        emailInput: !!emailInput,
        phoneInput: !!phoneInput,
        descriptionInput: !!descriptionInput,
        ticketStatus: !!ticketStatus,
        submitButton: !!submitButton
    });

    let isSubmitting = false;

    // --- Modal for sending status ---
    function showSendingModal() {
        let modal = document.getElementById('sending-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'sending-modal';
            modal.style.position = 'fixed';
            modal.style.top = '0';
            modal.style.left = '0';
            modal.style.width = '100vw';
            modal.style.height = '100vh';
            modal.style.background = 'rgba(0,0,0,0.3)';
            modal.style.display = 'flex';
            modal.style.justifyContent = 'center';
            modal.style.alignItems = 'center';
            modal.style.zIndex = '2000';
            modal.innerHTML = `
                <div style="background: #fff; padding: 24px 32px; border-radius: 10px; box-shadow: 0 2px 12px rgba(0,0,0,0.15); min-width: 300px; text-align: center;">
                    <div style="font-size: 1.2em; margin-bottom: 12px;">Sending ticket...</div>
                    <div class="progress" style="height: 18px; margin-bottom: 4px;">
                        <div class="progress-bar progress-bar-striped progress-bar-animated" style="width: 100%; background: #2ecc71; height: 100%;"></div>
                    </div>
                    <div style="font-size: 0.9em; color: #888;">Please wait</div>
                </div>
            `;
            document.body.appendChild(modal);
        } else {
            modal.style.display = 'flex';
        }
    }
    function hideSendingModal() {
        const modal = document.getElementById('sending-modal');
        if (modal) modal.style.display = 'none';
    }

    // Remote Support prompt modal
    function showRemoteSupportPrompt() {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.id = 'remote-support-prompt';
            modal.style.position = 'fixed';
            modal.style.top = '0';
            modal.style.left = '0';
            modal.style.width = '100vw';
            modal.style.height = '100vh';
            modal.style.background = 'rgba(0,0,0,0.4)';
            modal.style.display = 'flex';
            modal.style.justifyContent = 'center';
            modal.style.alignItems = 'center';
            modal.style.zIndex = '3000';
            modal.innerHTML = `
                <div style="background:#fff;padding:24px 32px;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,0.15);min-width:300px;max-width:400px;text-align:center;">
                    <div style="font-size:1.2em;margin-bottom:8px;">Remote Support</div>
                    <p style="margin-bottom:12px;">Would you like to open a remote support session? Your support ID and password will be included in the ticket.</p>
                    <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:10px;margin-bottom:16px;text-align:left;font-size:0.85em;color:#856404;">
                        <strong>⚠️ Please note:</strong> By opening a remote support session, a DBS Technology support agent will be able to see and control your screen. Please close any confidential or sensitive documents, emails, or applications before proceeding.
                    </div>
                    <div style="display:flex;gap:10px;justify-content:center;">
                        <button id="rs-yes" class="btn btn-primary">Yes, launch Remote Support</button>
                        <button id="rs-no" class="btn btn-outline-secondary">No, just submit ticket</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            document.getElementById('rs-yes').addEventListener('click', () => {
                document.body.removeChild(modal);
                resolve(true);
            });
            document.getElementById('rs-no').addEventListener('click', () => {
                document.body.removeChild(modal);
                resolve(false);
            });
        });
    }

    // Remote Support launching modal
    function showRemoteSupportLaunchingModal() {
        let modal = document.getElementById('rs-launching-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'rs-launching-modal';
            modal.style.position = 'fixed';
            modal.style.top = '0';
            modal.style.left = '0';
            modal.style.width = '100vw';
            modal.style.height = '100vh';
            modal.style.background = 'rgba(0,0,0,0.4)';
            modal.style.display = 'flex';
            modal.style.justifyContent = 'center';
            modal.style.alignItems = 'center';
            modal.style.zIndex = '3000';
            modal.innerHTML = `
                <div style="background:#fff;padding:24px 32px;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,0.15);min-width:300px;text-align:center;">
                    <div style="font-size:1.1em;margin-bottom:12px;">Launching Remote Support...</div>
                    <div class="progress" style="height:18px;margin-bottom:4px;">
                        <div class="progress-bar progress-bar-striped progress-bar-animated" style="width:100%;background:#2ecc71;height:100%;"></div>
                    </div>
                    <div style="font-size:0.9em;color:#888;">Capturing ID and password for ticket</div>
                </div>
            `;
            document.body.appendChild(modal);
        } else {
            modal.style.display = 'flex';
        }
    }

    function hideRemoteSupportLaunchingModal() {
        const modal = document.getElementById('rs-launching-modal');
        if (modal) modal.style.display = 'none';
    }

    // Ticket submission event listener
    const handleTicketSubmission = async (e) => {
        e.preventDefault(); // Prevent default form submission

        try {
            // Validate inputs
            showSendingModal();
            if (!fullNameInput.value.trim()) {
                throw new Error('Please enter your full name');
            }

            if (!companyNameInput.value.trim()) {
                throw new Error('Please enter your company name');
            }

            if (!provinceInput.value) {
                throw new Error('Please select your province');
            }

            if (!emailInput.value.trim() || !emailInput.value.includes('@')) {
                throw new Error('Please enter a valid email address');
            }

            // Gather system info first
            const systemInfo = await ipcRenderer.invoke('get-system-info');

            // Hide the sending modal and show remote support prompt
            hideSendingModal();

            // Ask user if they want remote support
            const wantsRemoteSupport = await showRemoteSupportPrompt();

            let remoteSupportData = null;

            if (wantsRemoteSupport) {
                // Show launching modal
                showRemoteSupportLaunchingModal();

                try {
                    // Generate a random password and launch remote support with it
                    const result = await ipcRenderer.invoke('launch-remote-support', 'generate');

                    if (result.success) {
                        remoteSupportData = {
                            id: result.remoteId || 'Could not retrieve automatically',
                            password: result.password
                        };

                        if (result.warning) {
                            console.warn('Remote support warning:', result.warning);
                        }
                    }
                } catch (rsError) {
                    console.error('Remote support launch failed:', rsError);
                    // Continue with ticket submission even if remote support fails
                }

                hideRemoteSupportLaunchingModal();
            }

            // Show sending modal again while ticket is being sent
            showSendingModal();

            // Prepare ticket data
            const ticketData = {
                fullName: fullNameInput.value.trim(),
                companyName: companyNameInput.value.trim() || 'Not Provided',
                province: provinceInput.value,
                subject: document.getElementById('subject').value.trim(),
                email: emailInput.value.trim(),
                phone: phoneInput.value.trim() || 'Not Provided',
                description: descriptionInput.value.trim(),
                systemInfo: systemInfo,
                remoteSupport: remoteSupportData
            };

            console.log('Ticket Submission Data:', ticketData);

            // Send ticket via IPC
            const result = await ipcRenderer.invoke('send-ticket', ticketData);

            console.log('Ticket submission result:', result);

            if (result.success) {
                // Save the form data for future use
                saveFormData(ticketData);
                
                hideSendingModal();
                // Confirmation popup
                showTicketConfirmation();
                if (ticketStatus) {
                    ticketStatus.innerHTML = `
                        <div style="color: green; border: 1px solid green; padding: 10px;">
                            <strong>Ticket Submitted Successfully!</strong>
                            <p>A DBS Technology support agent will review your request and revert shortly.</p>
                        </div>`;
                }
                // Reset form but keep the saved data
                ticketForm.reset();
                loadFormData(); // Reload the saved data
                isSubmitting = false;
                if (submitButton) submitButton.disabled = false;
            } else {
                throw new Error(result.message || 'Unable to submit ticket');
            }
        } catch (error) {
            hideSendingModal();
            console.error('Ticket submission error:', error);
            if (ticketStatus) {
                ticketStatus.innerHTML = `
                    <div style="color: red; border: 1px solid red; padding: 10px;">
                        <strong>Error:</strong> ${error.message}
                    </div>`;
            }
            isSubmitting = false;
            if (submitButton) submitButton.disabled = false;
        }
    };

    // Add event listener to form (once, robust)
    if (ticketForm) {
        ticketForm.addEventListener('submit', handleTicketSubmission);
    } else {
        console.error('Ticket form not found');
    }
});

// Phone Number Formatting Function
function formatPhoneNumber(phoneNumber) {
    // Remove all non-digit characters
    const cleaned = phoneNumber.replace(/\D/g, '');
    
    // Check if the number is 10 digits long and starts with 0
    if (cleaned.length === 10 && cleaned.startsWith('0')) {
        // Explicitly format as (082) 564-0943
        return `(0${cleaned.slice(1, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    
    // If the number doesn't match expected format, return original input
    return phoneNumber;
}

// Phone number input element
const phoneInput = document.getElementById('phone-input');

// Add event listener for real-time formatting
phoneInput.addEventListener('input', (e) => {
    console.log('Phone Input Debug:', {
        phoneInputElement: phoneInput,
        phoneInputValue: phoneInput.value,
        phoneInputValueTrimmed: phoneInput.value.trim(),
        phoneInputType: typeof phoneInput.value,
        phoneInputLength: phoneInput.value.length
    });

    // Store current cursor position
    const start = e.target.selectionStart;
    const end = e.target.selectionEnd;

    // Format the input
    e.target.value = formatPhoneNumber(e.target.value);

    // Restore cursor position
    e.target.setSelectionRange(start, end);
});

// Remote Support Button
const remoteSupportBtn = document.getElementById('remote-support-btn');
const remoteSupportStatus = document.getElementById('remote-support-status');

let isProcessing = false; // Flag to prevent multiple simultaneous calls

// Remote Support Status Confirmation
function showRemoteSupportStatus(message, type = 'success') {
    // Remove any existing status messages
    const existingStatus = document.getElementById('remote-support-status-modal');
    if (existingStatus) {
        document.body.removeChild(existingStatus);
    }

    // Create status container
    const statusContainer = document.createElement('div');
    statusContainer.id = 'remote-support-status-modal';
    statusContainer.className = `ticket-confirmation alert alert-${type} text-center`;
    
    // Determine icon and message based on type
    const icon = type === 'success' ? '✅' : '❌';
    
    statusContainer.innerHTML = `
        <strong>${icon} Remote Support Status</strong>
        <p>${message}</p>
        <button id="remote-support-status-ok" class="btn btn-primary mt-2">OK</button>
    `;
    
    // Style the status message (same as ticket confirmation)
    statusContainer.style.position = 'fixed';
    statusContainer.style.top = '50%';
    statusContainer.style.left = '50%';
    statusContainer.style.transform = 'translate(-50%, -50%)';
    statusContainer.style.zIndex = '1000';
    statusContainer.style.width = '90%';
    statusContainer.style.maxWidth = '400px';
    statusContainer.style.padding = '20px';
    statusContainer.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
    
    // Add to document body
    document.body.appendChild(statusContainer);
    
    // Add event listener for OK button
    const okButton = document.getElementById('remote-support-status-ok');
    okButton.addEventListener('click', () => {
        document.body.removeChild(statusContainer);
    });
}

remoteSupportBtn.addEventListener('click', async () => {
    // Prevent multiple simultaneous clicks
    if (isProcessing) {
        console.log('Remote Support process already in progress');
        return;
    }

    try {
        // Set processing flag
        isProcessing = true;

        // Disable button
        remoteSupportBtn.disabled = true;

        // Invoke Remote Support launch
        const result = await ipcRenderer.invoke('launch-remote-support');
        console.log('Remote Support launch result:', result);

        if (result.success) {
            showRemoteSupportStatus('Remote Support launched successfully');
        } else {
            // Error during launch
            console.error('Remote Support launch error:', result.error);
            showRemoteSupportStatus(result.error || 'Failed to launch Remote Support', 'danger');
        }
    } catch (error) {
        // Unexpected error
        console.error('Unexpected Remote Support launch error:', error);
        showRemoteSupportStatus('Unexpected error occurred', 'danger');
    } finally {
        // Re-enable button and reset processing flag
        remoteSupportBtn.disabled = false;
        isProcessing = false;
    }
});

// Function to update system performance metrics
async function updateSystemPerformanceMetrics() {
    try {
        const systemInfo = await ipcRenderer.invoke('get-system-info');
        
        // Disk Space
        const diskUsage = systemInfo.disks && systemInfo.disks[0] || { total: 1, used: 0, usagePercent: 0 };
        const diskUsedPercentage = Math.round(diskUsage.usagePercent || 0);
        const diskProgressBar = document.getElementById('disk-progress');
        const diskText = document.getElementById('disk-text');
        
        // Ensure the progress bar width matches the actual usage percentage
        diskProgressBar.style.width = `${diskUsedPercentage}%`;
        diskProgressBar.className = `progress-bar ${
            diskUsedPercentage < 50 ? 'bg-success' : 
            diskUsedPercentage < 70 ? 'bg-warning' : 'bg-danger'
        }`;
        
        // Display the actual values
        const usedGB = (diskUsage.used || 0) / (1024 * 1024 * 1024);
        const totalGB = (diskUsage.total || 1) / (1024 * 1024 * 1024);
        diskText.textContent = `${diskUsedPercentage}% (${usedGB.toFixed(2)}GB / ${totalGB.toFixed(2)}GB)`;

        // Memory
        const memoryUsage = systemInfo.memory;
        const memoryUsedPercentage = Math.round((memoryUsage.used / memoryUsage.total) * 100);
        const memoryProgressBar = document.getElementById('memory-progress');
        const memoryText = document.getElementById('memory-text');
        memoryProgressBar.style.width = `${memoryUsedPercentage}%`;
        memoryProgressBar.className = `progress-bar ${
            memoryUsedPercentage < 50 ? 'bg-success' : 
            memoryUsedPercentage < 70 ? 'bg-warning' : 'bg-danger'
        }`;
        memoryText.textContent = `${memoryUsedPercentage}% (${(memoryUsage.used / (1024 * 1024 * 1024)).toFixed(2)}GB / ${(memoryUsage.total / (1024 * 1024 * 1024)).toFixed(2)}GB)`;

        // CPU
        const cpuUsage = systemInfo.cpu.currentLoad;
        const cpuProgressBar = document.getElementById('cpu-progress');
        const cpuText = document.getElementById('cpu-text');
        cpuProgressBar.style.width = `${cpuUsage}%`;
        cpuProgressBar.className = `progress-bar ${
            cpuUsage < 50 ? 'bg-success' : 
            cpuUsage < 70 ? 'bg-warning' : 'bg-danger'
        }`;
        cpuText.textContent = `${Math.round(cpuUsage)}%`;
    } catch (error) {
        console.error('Error updating system performance metrics:', error);
        
        // Fallback to show error state
        ['disk', 'memory', 'cpu'].forEach(metric => {
            const progressBar = document.getElementById(`${metric}-progress`);
            const textElement = document.getElementById(`${metric}-text`);
            if (progressBar && textElement) {
                progressBar.style.width = '0%';
                progressBar.className = 'progress-bar bg-danger';
                textElement.textContent = 'Error retrieving data';
            }
        });
    }
}

// Ensure progress bars are initialized on page load
document.addEventListener('DOMContentLoaded', () => {
    ['disk', 'memory', 'cpu'].forEach(metric => {
        const progressBar = document.getElementById(`${metric}-progress`);
        const textElement = document.getElementById(`${metric}-text`);
        if (progressBar && textElement) {
            progressBar.style.width = '0%';
            progressBar.className = 'progress-bar bg-secondary';
            textElement.textContent = 'Initializing...';
        }
    });

    // Update metrics every 120 seconds (2 minutes)
    setInterval(updateSystemPerformanceMetrics, 120000);

    // Initial update
    updateSystemPerformanceMetrics();
});

// Widget Performance Monitoring
function monitorWidgetPerformance() {
    // Check memory usage
    if (window.performance && window.performance.memory) {
        const memory = window.performance.memory;
        console.group('Widget Memory Usage');
        console.log('Total JS Heap Size:', (memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + ' MB');
        console.log('Used JS Heap Size:', (memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + ' MB');
        console.log('JS Heap Size Limit:', (memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2) + ' MB');
        console.groupEnd();
    }

    // Performance timing
    const performanceEntries = performance.getEntriesByType('measure');
    if (performanceEntries.length > 0) {
        console.group('Widget Performance Measures');
        performanceEntries.forEach(entry => {
            console.log(`${entry.name}: ${entry.duration.toFixed(2)}ms`);
        });
        console.groupEnd();
    }

    // Check rendering performance
    requestAnimationFrame(() => {
        const start = performance.now();
        // Simulate a render check
        document.getElementById('disk-progress').style.width = '50%';
        const end = performance.now();
        console.log('Render Update Time:', (end - start).toFixed(2) + 'ms');
    });
}

// Add performance monitoring to system metrics update
const originalUpdateMetrics = updateSystemPerformanceMetrics;
updateSystemPerformanceMetrics = async function() {
    performance.mark('metricsUpdateStart');
    await originalUpdateMetrics();
    performance.mark('metricsUpdateEnd');
    performance.measure('Metrics Update', 'metricsUpdateStart', 'metricsUpdateEnd');
    
    monitorWidgetPerformance();
}

// Initial performance snapshot
document.addEventListener('DOMContentLoaded', () => {
    // Log initial widget load performance
    if (window.performance) {
        const loadTimes = window.performance.timing;
        console.group('Widget Load Performance');
        console.log('Total Load Time:', (loadTimes.loadEventEnd - loadTimes.navigationStart) + 'ms');
        console.log('DOM Load Time:', (loadTimes.domComplete - loadTimes.domLoading) + 'ms');
        console.groupEnd();
    }
});

// Ticket Submission Confirmation
function showTicketConfirmation() {
    // Create confirmation container
    const confirmationContainer = document.createElement('div');
    confirmationContainer.className = 'ticket-confirmation alert alert-success text-center';
    confirmationContainer.innerHTML = `
        <strong>Ticket Submitted Successfully!</strong>
        <p>Your ticket has been submitted to DBS Technology. Our team will review it shortly. Thank you for reaching out!</p>
        <button id="ticket-confirmation-ok" class="btn btn-primary mt-2">OK</button>
    `;
    
    // Style the confirmation message
    confirmationContainer.style.position = 'fixed';
    confirmationContainer.style.top = '50%';
    confirmationContainer.style.left = '50%';
    confirmationContainer.style.transform = 'translate(-50%, -50%)';
    confirmationContainer.style.zIndex = '1000';
    confirmationContainer.style.width = '90%';
    confirmationContainer.style.maxWidth = '400px';
    confirmationContainer.style.padding = '20px';
    confirmationContainer.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
    
    // Add to document body
    document.body.appendChild(confirmationContainer);
    
    // Add event listener for OK button
    const okButton = document.getElementById('ticket-confirmation-ok');
    okButton.addEventListener('click', () => {
        document.body.removeChild(confirmationContainer);
    });
}

// Update status element
const updateStatus = document.getElementById('update-status');

// Display app version
function displayAppVersion() {
  const versionElement = document.getElementById('version-display');
  if (versionElement) {
    // Get version from package.json (set in main.js)
    const version = window.appVersion || '1.0.5';
    
    // Clear any existing content and styles
    versionElement.innerHTML = '';
    versionElement.removeAttribute('style');
    
    // Style the container
    versionElement.style.position = 'fixed';
    versionElement.style.bottom = '10px';
    versionElement.style.left = '10px';
    versionElement.style.zIndex = '1000';
    versionElement.style.pointerEvents = 'none';
    
    // Create and style the version text
    const versionText = document.createElement('span');
    versionText.textContent = `v${version}`;
    versionText.style.cssText = `
      font-size: 11px;
      font-weight: 500;
      color: #2c3e50;
      background: rgba(255, 255, 255, 0.8);
      padding: 2px 8px;
      border-radius: 10px;
      border: 1px solid #e0e0e0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    `;
    
    // Add the text to the container
    versionElement.appendChild(versionText);
    
    // Ensure it's in the DOM
    if (!versionElement.parentNode) {
      document.body.appendChild(versionElement);
    }
  } else {
    console.error('Version display element not found');
  }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Wait a moment for the main process to set the version
  setTimeout(() => {
    displayAppVersion();
  }, 100);
  
  initUpdateNotification();
  
  // Check for updates after a short delay
  setTimeout(() => {
    ipcRenderer.send('check-for-updates');
  }, 2000);
});

// Initialize update notification element
function initUpdateNotification() {
  // Remove any existing update notification
  const existing = document.getElementById('update-notification');
  if (existing) existing.remove();
  
  // Create new notification
  const notification = document.createElement('div');
  notification.id = 'update-notification';
  notification.style.cssText = `
    display: none;
    position: fixed;
    bottom: 20px;
    right: 20px;
    background-color: #2c3e50;
    color: white;
    padding: 15px;
    border-radius: 5px;
    z-index: 1000;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    max-width: 300px;
    font-family: 'Segoe UI', Arial, sans-serif;
  `;
  
  notification.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
      <h3 id="update-title" style="margin: 0; color: #3498db; font-size: 16px;">Update Available</h3>
      <button id="close-update" style="background: none; border: none; color: #ecf0f1; cursor: pointer; font-size: 16px;">×</button>
    </div>
    <div id="update-progress" style="display: none; margin: 10px 0;">
      <div style="background: #2c3e50; height: 10px; border-radius: 5px; overflow: hidden; margin-bottom: 5px;">
        <div id="update-progress-bar" style="background: #3498db; height: 100%; width: 0%; transition: width 0.3s;"></div>
      </div>
      <div id="update-status-text" style="font-size: 12px; color: #bdc3c7;">Preparing download...</div>
    </div>
    <div id="update-actions" style="display: flex; gap: 8px; margin-top: 10px;">
      <button id="update-action-btn" style="flex: 1; background: #3498db; color: white; border: none; padding: 8px; border-radius: 4px; cursor: pointer;">Download</button>
    </div>
  `;
  
  document.body.appendChild(notification);
  
  // Add event listeners
  document.getElementById('close-update').addEventListener('click', () => {
    notification.style.display = 'none';
  });
  
  document.getElementById('update-action-btn').addEventListener('click', () => {
    ipcRenderer.invoke('download-and-install-update').catch(error => {
      showUpdateError(error.message || 'Failed to start download');
    });
  });
  
  return notification;
}

// Show update notification with specific state
function showUpdateNotification(state, options = {}) {
  const notification = document.getElementById('update-notification') || initUpdateNotification();
  const title = document.getElementById('update-title');
  const progress = document.getElementById('update-progress');
  const progressBar = document.getElementById('update-progress-bar');
  const statusText = document.getElementById('update-status-text');
  const actionBtn = document.getElementById('update-action-btn');
  
  switch (state) {
    case 'available':
      title.textContent = `Update v${options.version} Available`;
      statusText.textContent = 'A new version is available for download.';
      actionBtn.textContent = 'Download Update';
      actionBtn.style.display = 'block';
      progress.style.display = 'none';
      notification.style.display = 'block';
      break;
      
    case 'downloading':
      title.textContent = 'Downloading Update...';
      progress.style.display = 'block';
      actionBtn.style.display = 'none';
      notification.style.display = 'block';
      break;
      
    case 'downloaded':
      title.textContent = 'Update Ready';
      statusText.textContent = 'The update has been downloaded.';
      actionBtn.textContent = 'Restart & Install';
      actionBtn.style.display = 'block';
      notification.style.display = 'block';
      break;
      
    case 'error':
      title.textContent = 'Update Error';
      statusText.textContent = options.message || 'An error occurred during update.';
      actionBtn.textContent = 'Retry';
      actionBtn.style.display = 'block';
      notification.style.display = 'block';
      break;
  }
  
  // Update progress if provided
  if (options.progress !== undefined) {
    const percent = Math.floor(options.progress);
    progressBar.style.width = `${percent}%`;
    
    if (options.bytesPerSecond) {
      const speed = Math.round(options.bytesPerSecond / 1024);
      const downloaded = Math.round(options.transferred / 1024 / 1024 * 100) / 100;
      const total = Math.round(options.total / 1024 / 1024 * 100) / 100;
      statusText.textContent = `Downloading: ${percent}% (${downloaded}MB of ${total}MB) at ${speed}KB/s`;
    } else if (state === 'downloading') {
      statusText.textContent = `Downloading: ${percent}%`;
    }
  }
}

// IPC event handlers
ipcRenderer.on('update-available', (event, info) => {
  showUpdateNotification('available', { version: info.version });
});

ipcRenderer.on('download-progress', (event, progressObj) => {
  showUpdateNotification('downloading', {
    progress: progressObj.percent || 0,
    bytesPerSecond: progressObj.bytesPerSecond,
    transferred: progressObj.transferred,
    total: progressObj.total
  });
});

ipcRenderer.on('update-downloaded', () => {
  showUpdateNotification('downloaded');
});

ipcRenderer.on('update-error', (event, message) => {
  showUpdateNotification('error', { message });
});

ipcRenderer.on('update-not-available', () => {
  // Optionally show a small toast that you're up to date
  const notification = document.getElementById('update-notification');
  if (notification) notification.style.display = 'none';
});

// Theme Management
function initTheme() {
    // Check for saved theme preference or use system preference
    const savedTheme = localStorage.getItem('theme') || 
                      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    
    // Apply the saved theme
    setTheme(savedTheme);
    
    // Set up theme toggle button
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
        updateThemeIcon(savedTheme);
    }
}

function setTheme(theme) {
    // Apply theme to document
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    
    // Update theme icon
    updateThemeIcon(theme);
    
    // Dispatch event in case other components need to react to theme changes
    document.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
}

function updateThemeIcon(theme) {
    const themeIcon = document.querySelector('.theme-icon');
    if (!themeIcon) return;
    
    themeIcon.textContent = theme === 'dark' ? '🌞' : '🌙';
    themeIcon.setAttribute('title', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
}

// Initialize theme when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Initialize theme
    initTheme();
    
    // Set version number from package.json
    const { ipcRenderer } = require('electron');
    ipcRenderer.invoke('get-app-version').then(version => {
        const versionElement = document.getElementById('version-display');
        if (versionElement) {
            versionElement.textContent = `v${version}`;
        }
    }).catch(console.error);
    
    // Rest of your existing DOMContentLoaded code...
});

// Add this to your existing IPC handlers
ipcRenderer.on('set-theme', (event, theme) => {
    if (theme === 'toggle') {
        toggleTheme();
    } else if (['light', 'dark'].includes(theme)) {
        setTheme(theme);
    }
});

// Add this to your existing IPC handlers
ipcRenderer.on('get-theme', (event) => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    event.returnValue = currentTheme;
});

// Add this to your existing IPC handlers
ipcRenderer.on('system-theme-changed', (event, theme) => {
    // Only change theme if user hasn't set a preference
    if (!localStorage.getItem('theme')) {
        setTheme(theme);
    }
});

// Exit button functionality
const exitButton = document.getElementById('exit-btn');
if (exitButton) {
    exitButton.addEventListener('click', () => {
        ipcRenderer.send('close-app');
    });
}

// Minimize button functionality
const minimizeButton = document.getElementById('minimize-btn');
if (minimizeButton) {
    minimizeButton.addEventListener('click', () => {
        ipcRenderer.send('minimize-window');
    });
}

// DBS Toolbox Management
function initToolbox() {
    console.log('Initializing Toolbox...');
    
    const toolboxToggle = document.getElementById('toolbox-toggle');
    const toolboxPopup = document.getElementById('toolbox-popup');
    const closeToolbox = document.getElementById('close-toolbox');
    const toolboxButtons = document.querySelectorAll('.toolbox-item');

    console.log('Toolbox Elements:', {
        toolboxToggle: !!toolboxToggle,
        toolboxPopup: !!toolboxPopup,
        closeToolbox: !!closeToolbox,
        toolboxButtons: toolboxButtons.length
    });

    // Get the base path for tools based on environment
    const isDev = process.env.NODE_ENV === 'development' || (window && window.process && window.process.type);
    let toolsBasePath;
    
    if (isDev) {
        // Development path (relative to project root)
        toolsBasePath = path.join(__dirname, 'tools', 'dbs-utilities');
    } else {
        // Production path - point to app.asar.unpacked
        const appPath = process.resourcesPath;
        toolsBasePath = path.join(appPath.replace('app.asar', 'app.asar.unpacked'), 'tools', 'dbs-utilities');
    }

    console.log('Tools base path:', toolsBasePath);

    // Tool paths mapping - now using the correct base path
    const toolPaths = {
        'disk-cleanup': 'DiskCleaner.exe',
        'uninstall-manager': 'Uninstaler.exe',
        'startup-manager': 'StartupManager.exe',
        'memory-optimizer': 'memdefrag.exe',
        'check-disk': 'CheckDisk.exe',
        'software-update': 'SoftwareUpdate.exe',
        'registry-repair': 'RegistryCleaner.exe',
        'registry-defrag': 'regdefrag.exe'
    };

    console.log('Tool paths:', toolPaths);

    // Toggle toolbox popup
    if (toolboxToggle) {
        console.log('Adding click event to toolbox toggle button');
        toolboxToggle.addEventListener('click', (e) => {
            console.log('Toolbox toggle clicked');
            e.stopPropagation();
            const isVisible = toolboxPopup.style.display === 'block';
            console.log('Current popup state:', isVisible ? 'visible' : 'hidden');
            toolboxPopup.style.display = isVisible ? 'none' : 'block';
            console.log('New popup state:', isVisible ? 'hidden' : 'visible');
        });
    } else {
        console.error('Toolbox toggle button not found!');
    }

    // Close toolbox when clicking close button
    if (closeToolbox) {
        closeToolbox.addEventListener('click', (e) => {
            console.log('Close toolbox button clicked');
            e.stopPropagation();
            toolboxPopup.style.display = 'none';
        });
    }

    // Close toolbox when clicking outside
    document.addEventListener('click', (e) => {
        if (toolboxPopup && !toolboxPopup.contains(e.target) && e.target !== toolboxToggle) {
            console.log('Clicked outside toolbox, closing');
            toolboxPopup.style.display = 'none';
        }
    });

    // Handle toolbox button clicks
    if (toolboxButtons.length > 0) {
        console.log(`Found ${toolboxButtons.length} toolbox buttons`);
        toolboxButtons.forEach(button => {
            button.addEventListener('click', async (e) => {
                e.stopPropagation();
                const toolId = button.getAttribute('data-tool');
                const toolExe = toolPaths[toolId];
                const toolName = button.querySelector('span').textContent;
                
                console.log(`Tool button clicked: ${toolName} (${toolId})`);
                console.log('Tool executable:', toolExe);
                
                if (toolExe) {
                    console.log(`Attempting to launch: ${toolName}`);
                    
                    // Show loading state
                    const originalContent = button.innerHTML;
                    button.disabled = true;
                    button.innerHTML = '<i class="bi bi-hourglass-split"></i> Launching...';
                    
                    try {
                        // Get the full path to the tool
                        const fullPath = path.join(toolsBasePath, toolExe);
                        console.log('Full tool path:', fullPath);
                        
                        // Send the tool path to the main process
                        ipcRenderer.send('launch-tool', {
                            path: fullPath,
                            name: toolName
                        });
                        console.log(`Successfully requested launch of ${toolName}`);
                    } catch (error) {
                        console.error(`Error launching ${toolName}:`, error);
                        showNotification(`Error launching ${toolName}: ${error.message}`, 'error');
                    } finally {
                        // Restore button state after a short delay to show feedback
                        setTimeout(() => {
                            button.innerHTML = originalContent;
                            button.disabled = false;
                        }, 1000);
                    }
                } else {
                    console.error(`No path found for tool: ${toolId}`);
                    showNotification(`Error: Tool configuration missing for ${toolId}`, 'error');
                }
                
                // Close the toolbox after selection
                if (toolboxPopup) {
                    toolboxPopup.style.display = 'none';
                }
            });
        });
    } else {
        console.error('No toolbox buttons found!');
    }
    
    console.log('Toolbox initialization complete');
}

// Handle tool launch success
ipcRenderer.on('tool-launched', (event, { name, pid }) => {
    console.log(`Successfully launched ${name} with PID: ${pid}`);
    showNotification(`${name} launched successfully`, 'success');
});

// Handle tool launch errors
ipcRenderer.on('tool-error', (event, { name, error }) => {
    console.error(`Failed to launch ${name}:`, error);
    showNotification(`Failed to launch ${name}: ${error}`, 'error');
});

// Helper function to show notifications
function showNotification(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `alert alert-${type} alert-dismissible fade show`;
    notification.role = 'alert';
    notification.style.position = 'fixed';
    notification.style.top = '20px';
    notification.style.right = '20px';
    notification.style.zIndex = '2000';
    notification.style.minWidth = '300px';
    notification.style.maxWidth = '90%';
    notification.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    
    document.body.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

// Single DOMContentLoaded event listener to rule them all
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded, initializing app...');
    
    // Initialize theme
    console.log('Initializing theme...');
    initTheme();
    
    // Initialize toolbox
    console.log('Initializing toolbox...');
    initToolbox();
    
    // Initialize other components
    console.log('Initializing other components...');
    
    // Check if Bootstrap is loaded for tooltips and popovers
    if (typeof bootstrap !== 'undefined') {
        console.log('Bootstrap is available, initializing components...');
        
        // Enable tooltips
        const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
        tooltipTriggerList.forEach(tooltipTriggerEl => {
            new bootstrap.Tooltip(tooltipTriggerEl);
        });
        
        // Enable popovers
        const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
        popoverTriggerList.forEach(popoverTriggerEl => {
            new bootstrap.Popover(popoverTriggerEl);
        });
    } else {
        console.warn('Bootstrap is not available, some UI components may not work correctly');
    }
    
    console.log('App initialization complete');
});

// Add event listener to enable right-click on form fields
document.addEventListener('DOMContentLoaded', () => {
    // Enable right-click on subject and description fields
    const subjectField = document.getElementById('subject');
    const descriptionField = document.getElementById('description');
    
    if (subjectField) {
        subjectField.addEventListener('contextmenu', (e) => {
            e.stopPropagation();
            return true;
        });
    }
    
    if (descriptionField) {
        descriptionField.addEventListener('contextmenu', (e) => {
            e.stopPropagation();
            return true;
        });
    }
    
    console.log('Right-click enabled for form fields');
});
